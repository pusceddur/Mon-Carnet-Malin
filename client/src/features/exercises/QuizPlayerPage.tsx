import type { Answer, AnswerResponse, ChildProfile, DocumentMeta, Exercise, Question } from '@aide/shared';
import { useEffect, useMemo, useState, type JSX } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Button, EmptyState, ProgressBar, useToast } from '../../design/components';
import { readingFontClass } from '../../design/reading';
import { speechEngine } from '../../tts/SpeechEngine';
import { format } from '../../i18n/fr';
import { exercises as t } from '../../i18n/fr/exercises';
import { ChildGate } from './components/ChildGate';
import { AssociationInput, OrdreInput, QcmInput, VraiFauxInput, type SubmitMeta } from './components/ClosedInputs';
import { ListenButton, useStopSpeechOnUnmount } from './components/common';
import { ExerciseLayout, LoadingBlock } from './components/ExerciseLayout';
import { FeedbackPanel } from './components/FeedbackPanel';
import { FreeAnswerInput } from './components/FreeAnswerInput';
import { useAbortable, useExerciseData, useParentSettings } from './hooks';
import { aiFeatureEnabled, handwritingRecognitionEnabled } from './lib/aiResults';
import { buildAnswer, correctResponse, loadCorrectionPages, saveAnswer } from './lib/correction';
import { duplicateExercise } from './lib/generation';
import { exercisesHomeLink, parseQuestionParam, questionParam, quizLink, readerLink } from './lib/links';
import { cheerFor, firstUnansweredIndex, latestAnswers, scoreExercise } from './lib/score';
import { scoreLine } from './lib/texts';

const TITLE = `${t.setup.emoji} ${t.setup.title}`;

export default function QuizPlayerPage(): JSX.Element {
  const { exerciseId } = useParams();
  return <ChildGate>{(child) => <QuizPlayer key={exerciseId} child={child} exerciseId={exerciseId} />}</ChildGate>;
}

function QuizPlayer({ child, exerciseId }: { child: ChildProfile; exerciseId: string | undefined }): JSX.Element {
  const navigate = useNavigate();
  const data = useExerciseData(exerciseId, child.id);
  if (data.status === 'ready') return <QuizRun child={child} exercise={data.exercise} answers={data.answers} doc={data.doc} />;
  return (
    <ExerciseLayout title={TITLE} onBack={() => navigate('/exercices')}>
      {data.status === 'loading' ? (
        <LoadingBlock label={t.player.loading} />
      ) : (
        <EmptyState
          emoji="🔎"
          title={t.player.notFound.title}
          message={t.player.notFound.message}
          action={<Button onClick={() => navigate('/exercices')}>{t.summary.backToBook}</Button>}
        />
      )}
    </ExerciseLayout>
  );
}

function spokenQuestion(question: Question): string {
  return question.type === 'qcm' ? [question.prompt, ...question.choices].join('\n') : question.prompt;
}

function QuizRun({ child, exercise, answers, doc }: { child: ChildProfile; exercise: Exercise; answers: Answer[]; doc: DocumentMeta | null }): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const settings = useParentSettings();
  const [params, setParams] = useSearchParams();
  const total = exercise.questions.length;

  const [localAnswers, setLocalAnswers] = useState<Answer[]>([]);
  const latest = useMemo(() => latestAnswers([...answers, ...localAnswers]), [answers, localAnswers]);
  const [index, setIndex] = useState(() => parseQuestionParam(params.get('q'), total) ?? firstUnansweredIndex(exercise, latestAnswers(answers)));
  const [checking, setChecking] = useState(false);
  const [notices, setNotices] = useState<ReadonlyMap<string, string>>(new Map());
  const { start } = useAbortable();
  useStopSpeechOnUnmount();

  // Keeps the position in the URL so « Relire le passage » then « Retour » comes back to the same question.
  useEffect(() => {
    const value = questionParam(index, total);
    if (params.get('q') !== value) {
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set('q', value);
        return next;
      }, { replace: true });
    }
  }, [index, total, params, setParams]);

  const fontClass = readingFontClass(child.reading.font);
  const question = index < total ? exercise.questions[index] : undefined;
  const answer = question ? latest.get(question.id) : undefined;
  const documentHash = doc?.sourceHash || null;
  const back = (): void => {
    void navigate(exercisesHomeLink(exercise.documentId));
  };

  const submit = async (q: Question, response: AnswerResponse, meta: SubmitMeta): Promise<void> => {
    const signal = start();
    setChecking(true);
    try {
      const pages = q.type === 'reponse_libre' ? await loadCorrectionPages(exercise, q) : [];
      const outcome = await correctResponse({
        question: q,
        response,
        childId: child.id,
        documentId: exercise.documentId,
        documentHash,
        pages,
        aiAllowed: aiFeatureEnabled(settings, 'correctAnswers'),
        signal,
      });
      if (signal.aborted) return;
      const saved = buildAnswer({ exerciseId: exercise.id, question: q, childId: child.id, response, ...meta, outcome });
      setLocalAnswers((list) => [...list, saved]);
      if (outcome.kind === 'self_check' && outcome.message) {
        const message = outcome.message;
        setNotices((map) => new Map(map).set(q.id, message));
      }
      await saveAnswer(saved);
    } catch {
      if (!signal.aborted) toast.error(t.common.saveError);
    } finally {
      if (!signal.aborted) setChecking(false);
    }
  };

  const again = async (): Promise<void> => {
    try {
      const copy = await duplicateExercise(exercise);
      navigate(quizLink(copy.id), { replace: true });
    } catch {
      toast.error(t.common.saveError);
    }
  };

  if (!question) {
    const score = scoreExercise(exercise, [...latest.values()]);
    const cheer = cheerFor(score);
    return (
      <ExerciseLayout title={TITLE} subtitle={doc?.title} onBack={back}>
        <section className="ex-card ex-result" aria-labelledby="ex-result-title">
          <span className="ex-result__emoji" aria-hidden="true">
            {t.score.cheerEmoji[cheer]}
          </span>
          <h2 id="ex-result-title" className="ex-result__title">
            {t.score.cheer[cheer]}
          </h2>
          <p className="ex-result__score">{scoreLine(score)}</p>
          <div className="ex-actions ex-actions--column">
            <Button icon="🏠" onClick={back}>
              {t.player.result.backHome}
            </Button>
            <Button variant="secondary" icon={t.player.result.againEmoji} onClick={() => void again()}>
              {t.player.result.again}
            </Button>
            {doc && (
              <Button variant="ghost" icon="📖" onClick={() => navigate(readerLink(exercise.documentId))}>
                {t.player.result.openBook}
              </Button>
            )}
          </div>
        </section>
      </ExerciseLayout>
    );
  }

  const progress = format(t.player.progress, { current: index + 1, total });
  const isLast = index === total - 1;

  return (
    <ExerciseLayout title={TITLE} subtitle={doc?.title} onBack={back}>
      <ProgressBar label={progress} value={index + (answer ? 1 : 0)} max={total} showValue={false} tone="ok" />
      {exercise.origin === 'local' && <p className="ex-badge">{t.player.localLabel}</p>}

      <section className="ex-card ex-question" aria-labelledby="ex-question-prompt">
        <div className="ex-row ex-row--between ex-row--top">
          <h2 id="ex-question-prompt" className={`ex-question__prompt ${fontClass}`}>
            {question.prompt}
          </h2>
          <ListenButton text={spokenQuestion(question)} label={t.player.listenQuestion} compact />
        </div>
        {answer ? null : (
          <QuestionInput
            key={question.id}
            question={question}
            busy={checking}
            fontClass={fontClass}
            child={child}
            exercise={exercise}
            documentHash={documentHash}
            handwriting={handwritingRecognitionEnabled(settings)}
            onSubmit={(response, meta) => void submit(question, response, meta)}
          />
        )}
      </section>

      {answer && (
        <FeedbackPanel
          key={answer.id}
          question={question}
          answer={answer}
          documentId={exercise.documentId}
          fontClass={fontClass}
          notice={notices.get(question.id) ?? null}
          nextLabel={isLast ? t.player.seeResult : t.player.next}
          onNext={() => {
            speechEngine.stop();
            setIndex(index + 1);
          }}
        />
      )}
    </ExerciseLayout>
  );
}

function QuestionInput({ question, busy, fontClass, child, exercise, documentHash, handwriting, onSubmit }: {
  question: Question;
  busy: boolean;
  fontClass: string;
  child: ChildProfile;
  exercise: Exercise;
  documentHash: string | null;
  handwriting: boolean;
  onSubmit: (response: AnswerResponse, meta: SubmitMeta) => void;
}): JSX.Element {
  switch (question.type) {
    case 'qcm':
      return <QcmInput question={question} busy={busy} onSubmit={onSubmit} fontClass={fontClass} />;
    case 'vrai_faux':
      return <VraiFauxInput question={question} busy={busy} onSubmit={onSubmit} fontClass={fontClass} />;
    case 'association':
      return <AssociationInput question={question} busy={busy} onSubmit={onSubmit} fontClass={fontClass} />;
    case 'ordre':
      return <OrdreInput question={question} busy={busy} onSubmit={onSubmit} fontClass={fontClass} />;
    case 'reponse_libre':
      return (
        <FreeAnswerInput
          question={question}
          busy={busy}
          onSubmit={onSubmit}
          fontClass={fontClass}
          childId={child.id}
          exerciseId={exercise.id}
          exerciseCreatedAt={exercise.createdAt}
          documentId={exercise.documentId}
          documentHash={documentHash}
          handwritingRecognition={handwriting}
        />
      );
  }
}
