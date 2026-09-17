import type { Answer, Exercise, Verdict } from '@aide/shared';

/** Most recent answer per question (by updatedAt, then createdAt). */
export function latestAnswers(answers: readonly Answer[]): Map<string, Answer> {
  const latest = new Map<string, Answer>();
  for (const answer of answers) {
    const current = latest.get(answer.questionId);
    if (!current || answer.updatedAt > current.updatedAt || (answer.updatedAt === current.updatedAt && answer.createdAt >= current.createdAt)) {
      latest.set(answer.questionId, answer);
    }
  }
  return latest;
}

export type AnswerDisplay = Verdict | 'self_check' | 'message';

/** How a saved answer is shown: a verdict, a self-check (no correction) or a message (adult redirect). */
export function answerDisplay(answer: Answer): AnswerDisplay {
  if (answer.verdict !== null) return answer.verdict;
  return answer.feedback !== null && answer.feedback.trim().length > 0 ? 'message' : 'self_check';
}

export interface ExerciseScore {
  total: number;
  answered: number;
  correct: number;
  partiel: number;
  incorrect: number;
  /** Answered without a verdict (self-check or message). */
  unscored: number;
  complete: boolean;
}

export function scoreExercise(exercise: Exercise, answers: readonly Answer[]): ExerciseScore {
  const latest = latestAnswers(answers.filter((a) => a.exerciseId === exercise.id));
  const score: ExerciseScore = { total: exercise.questions.length, answered: 0, correct: 0, partiel: 0, incorrect: 0, unscored: 0, complete: false };
  for (const question of exercise.questions) {
    const answer = latest.get(question.id);
    if (!answer) continue;
    score.answered += 1;
    if (answer.verdict === 'correct') score.correct += 1;
    else if (answer.verdict === 'partiel') score.partiel += 1;
    else if (answer.verdict === 'incorrect') score.incorrect += 1;
    else score.unscored += 1;
  }
  score.complete = score.total > 0 && score.answered === score.total;
  return score;
}

export type Cheer = 'all' | 'great' | 'good' | 'keepGoing';

/** Always encouraging: the wording only changes how enthusiastic it is. */
export function cheerFor(score: ExerciseScore): Cheer {
  const graded = score.correct + score.partiel + score.incorrect;
  if (graded === 0) return 'good';
  if (score.correct === graded) return 'all';
  const ratio = (score.correct + score.partiel / 2) / graded;
  if (ratio >= 0.7) return 'great';
  if (ratio >= 0.4) return 'good';
  return 'keepGoing';
}

/** Index of the first question without an answer, or `questions.length` when everything is answered. */
export function firstUnansweredIndex(exercise: Exercise, latest: ReadonlyMap<string, Answer>): number {
  const index = exercise.questions.findIndex((q) => !latest.has(q.id));
  return index === -1 ? exercise.questions.length : index;
}
