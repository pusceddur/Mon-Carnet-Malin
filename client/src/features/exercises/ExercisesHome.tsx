import type { Answer, ChildProfile, DocumentMeta, Exercise } from '@aide/shared';
import { useMemo, type JSX } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button, EmptyState, Tile } from '../../design/components';
import { format } from '../../i18n/fr';
import { exercises as t } from '../../i18n/fr/exercises';
import { ChildGate } from './components/ChildGate';
import { ExerciseLayout, LoadingBlock } from './components/ExerciseLayout';
import { useChildDocuments, useChildHistory } from './hooks';
import { questionsLink, quizLink, summaryLink } from './lib/links';
import { cheerFor, scoreExercise } from './lib/score';
import { plural, scoreLine } from './lib/texts';

const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const PAST_MAX = 20;

export default function ExercisesHome(): JSX.Element {
  return <ChildGate>{(child) => <ExercisesHomeScreen child={child} />}</ChildGate>;
}

function bookDescription(doc: DocumentMeta): string {
  if (doc.status === 'processing') return t.home.processing;
  return plural(doc.pageCount, t.home.pagesOne, t.home.pagesMany);
}

function ExercisesHomeScreen({ child }: { child: ChildProfile }): JSX.Element {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const documents = useChildDocuments(child.id);
  const history = useChildHistory(child.id);
  const selectedId = params.get('livre');
  const selected = documents?.find((d) => d.id === selectedId) ?? null;

  return (
    <ExerciseLayout title={`${t.home.emoji} ${t.home.title}`} onBack={() => navigate(selected ? '/exercices' : '/accueil')}>
      {documents === undefined ? (
        <LoadingBlock label={t.common.loadingBook} />
      ) : selected ? (
        <section className="ex-stack" aria-labelledby="ex-what">
          <h2 id="ex-what" className="ex-section-title">
            {t.home.whatToDo}
          </h2>
          <p className="ex-book-name">
            <span aria-hidden="true">{t.home.bookEmoji} </span>
            {selected.title}
          </p>
          <div className="ex-tiles">
            <Tile
              emoji={t.home.summaryEmoji}
              label={t.home.summaryLabel}
              description={t.home.summaryHint}
              tone="warm"
              onClick={() => navigate(summaryLink(selected.id))}
            />
            <Tile
              emoji={t.home.questionsEmoji}
              label={t.home.questionsLabel}
              description={t.home.questionsHint}
              tone="violet"
              onClick={() => navigate(questionsLink(selected.id))}
            />
          </div>
          <div>
            <Button variant="ghost" onClick={() => setParams({}, { replace: true })}>
              {t.home.changeBook}
            </Button>
          </div>
        </section>
      ) : documents.length === 0 ? (
        <EmptyState emoji="📚" title={t.home.noBooks.title} message={t.home.noBooks.message} />
      ) : (
        <section className="ex-stack" aria-labelledby="ex-books">
          <h2 id="ex-books" className="ex-section-title">
            {t.home.chooseBook}
          </h2>
          <div className="ex-list">
            {documents.map((doc) => (
              <Tile
                key={doc.id}
                layout="row"
                emoji={t.home.bookEmoji}
                label={doc.title}
                description={bookDescription(doc)}
                onClick={() => setParams({ livre: doc.id })}
              />
            ))}
          </div>
        </section>
      )}

      {!selected && history !== undefined && (
        <PastExercises exercises={history.exercises} answers={history.answers} documents={documents ?? []} onOpen={(id) => navigate(quizLink(id))} />
      )}
    </ExerciseLayout>
  );
}

function PastExercises({ exercises, answers, documents, onOpen }: {
  exercises: Exercise[];
  answers: Answer[];
  documents: DocumentMeta[];
  onOpen: (exerciseId: string) => void;
}): JSX.Element {
  const titles = useMemo(() => new Map(documents.map((d) => [d.id, d.title])), [documents]);
  const visible = exercises.filter((e) => titles.has(e.documentId) && e.questions.length > 0).slice(0, PAST_MAX);

  return (
    <section className="ex-stack" aria-labelledby="ex-past">
      <h2 id="ex-past" className="ex-section-title">
        {t.home.past.title}
      </h2>
      {visible.length === 0 ? (
        <p className="ex-muted">{t.home.past.empty}</p>
      ) : (
        <ul className="ex-past">
          {visible.map((exercise) => {
            const score = scoreExercise(exercise, answers);
            const title = titles.get(exercise.documentId) ?? '';
            const date = dateFormat.format(exercise.createdAt);
            const emoji = score.complete ? t.score.cheerEmoji[cheerFor(score)] : '🧠';
            return (
              <li key={exercise.id}>
                <button
                  type="button"
                  className="ex-past__item"
                  aria-label={`${format(t.home.past.openLabel, { title, date })}. ${scoreLine(score)}`}
                  onClick={() => onOpen(exercise.id)}
                >
                  <span className="ex-past__emoji" aria-hidden="true">
                    {emoji}
                  </span>
                  <span className="ex-past__text">
                    <span className="ex-past__title">{title}</span>
                    <span className="ex-past__meta">
                      {date} · {scoreLine(score)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
