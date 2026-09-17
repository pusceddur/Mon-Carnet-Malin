import type { Answer, Id, Question } from '@aide/shared';
import type { JSX, ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../../design/components';
import { exercises as t } from '../../../i18n/fr/exercises';
import { readerLink } from '../lib/links';
import { answerDisplay, type AnswerDisplay } from '../lib/score';
import { rightAnswerLines } from '../lib/texts';
import { ListenButton, Notice } from './common';

const f = t.player.feedback;

function headline(display: AnswerDisplay, answer: Answer): { emoji: string; text: string } {
  switch (display) {
    case 'correct':
      return { emoji: f.correctEmoji, text: f.correct };
    case 'partiel':
      return { emoji: f.partielEmoji, text: f.partiel };
    case 'incorrect':
      return { emoji: f.incorrectEmoji, text: f.incorrect };
    case 'self_check':
      return { emoji: f.selfCheckEmoji, text: f.selfCheck };
    case 'message':
      return { emoji: f.adultEmoji, text: answer.feedback ?? '' };
  }
}

function Block({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="ex-feedback__block">
      <p className="ex-feedback__label">{title}</p>
      {children}
    </div>
  );
}

export interface FeedbackPanelProps {
  question: Question;
  answer: Answer;
  documentId: Id;
  fontClass: string;
  /** Transient notice (e.g. why the correction was not available). */
  notice: string | null;
  nextLabel: string;
  onNext: () => void;
}

/** §38 feedback: never « faux » alone — a short reason, the right answer and an invitation to reread the passage. */
export function FeedbackPanel({ question, answer, documentId, fontClass, notice, nextLabel, onNext }: FeedbackPanelProps): JSX.Element {
  const navigate = useNavigate();
  const display = answerDisplay(answer);
  const head = headline(display, answer);
  const explanation = question.type === 'qcm' || question.type === 'vrai_faux' ? question.explanation.trim() : '';
  const feedbackText = display === 'message' ? '' : (answer.feedback ?? '').trim();
  const right = display === 'correct' || display === 'message' ? null : rightAnswerLines(question);
  const libre = question.type === 'reponse_libre' ? question : null;
  const showExpected = libre !== null && (display === 'self_check' || display === 'partiel' || display === 'incorrect');
  const writtenAnswer = answer.response.type === 'reponse_libre' ? answer.response.text.trim() : '';
  const rereadRef = display === 'correct' || display === 'message' ? null : (answer.rereadRef ?? question.source);

  const spoken = [
    head.text,
    feedbackText,
    explanation,
    right ? `${right.title} ${right.lines.join('. ')}` : '',
    showExpected && libre ? `${f.expected} ${libre.expectedAnswer}` : '',
  ].filter((s) => s.length > 0).join('\n');

  return (
    <section className={`ex-card ex-feedback ex-feedback--${display}`} aria-live="polite">
      <div className="ex-row ex-row--between">
        <h2 className="ex-feedback__title">
          <span aria-hidden="true">{head.emoji} </span>
          {head.text}
        </h2>
        <ListenButton text={spoken} label={f.listenFeedback} compact />
      </div>

      {notice && display === 'self_check' && <Notice tone="calm">{notice}</Notice>}
      {feedbackText.length > 0 && feedbackText !== head.text && <p className="ex-feedback__text">{feedbackText}</p>}
      {explanation.length > 0 && <p className="ex-feedback__text">{explanation}</p>}

      {libre && display === 'self_check' && (
        <Block title={f.yourAnswer}>
          {writtenAnswer.length > 0 ? <p className={`ex-feedback__quote ${fontClass}`}>{writtenAnswer}</p> : <p>{f.yourDrawing}</p>}
        </Block>
      )}
      {showExpected && libre && (
        <>
          <Block title={f.expected}>
            <p className={`ex-feedback__quote ${fontClass}`}>{libre.expectedAnswer}</p>
          </Block>
          {libre.keyPoints.length > 0 && (
            <Block title={f.keyPoints}>
              <ul className={`ex-keypoints ${fontClass}`}>
                {libre.keyPoints.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            </Block>
          )}
        </>
      )}
      {right && (
        <Block title={right.title}>
          <ul className={`ex-keypoints ${fontClass}`}>
            {right.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </Block>
      )}

      <div className="ex-actions ex-actions--split">
        {rereadRef && (
          <Button variant="secondary" icon={f.rereadEmoji} onClick={() => navigate(readerLink(documentId, rereadRef))}>
            {f.reread}
          </Button>
        )}
        <Button icon="➡️" onClick={onNext}>
          {nextLabel}
        </Button>
      </div>
    </section>
  );
}
