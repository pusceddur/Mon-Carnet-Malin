import type { Question } from '@aide/shared';
import { format } from '../../../i18n/fr';
import { exercises as t } from '../../../i18n/fr/exercises';
import type { ExerciseScore } from './score';

/** Plain-text right answer of a closed question (shown and read aloud); null for written answers. */
export function rightAnswerLines(question: Question): { title: string; lines: string[] } | null {
  const f = t.player.feedback;
  switch (question.type) {
    case 'qcm':
      return { title: f.rightAnswer, lines: [question.choices[question.correctIndex] ?? ''] };
    case 'vrai_faux':
      return { title: f.rightAnswer, lines: [question.answer ? f.vrai : f.faux] };
    case 'association':
      return { title: f.rightPairs, lines: question.pairs.map((p) => format(f.pair, { left: p.left, right: p.right })) };
    case 'ordre':
      return { title: f.rightOrder, lines: question.itemsInOrder.map((item, i) => `${i + 1}. ${item}`) };
    case 'reponse_libre':
      return null;
  }
}

/** French plural helper for « 1 page » / « 3 pages » (`{count}` placeholder). */
export function plural(count: number, one: string, many: string): string {
  return format(count === 1 ? one : many, { count });
}

/** Short, encouraging score line (« 4 bonnes réponses sur 5 · 1 réponse presque juste »). */
export function scoreLine(score: ExerciseScore): string {
  if (score.answered === 0) return t.home.past.notStarted;
  if (!score.complete) return format(t.home.past.inProgress, { answered: score.answered, total: score.total });
  const parts = [format(score.correct === 1 ? t.score.correctOne : t.score.correctMany, { count: score.correct, total: score.total })];
  if (score.partiel > 0) parts.push(plural(score.partiel, t.score.partielOne, t.score.partielMany));
  if (score.unscored > 0) parts.push(plural(score.unscored, t.score.selfCheckOne, t.score.selfCheckMany));
  return parts.join(' · ');
}
