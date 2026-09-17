import {
  generateLocalQuestions, newId, QUESTION_TYPES, type AIPageInput, type Exercise, type Id, type Question, type QuestionType,
} from '@aide/shared';
import { requestAI } from '../../../ai/aiClient';
import { saveEntity } from '../../../sync/SyncEngine';
import { kidMessage } from './aiResults';

export type QuestionCount = 3 | 5 | 10;
export const QUESTION_COUNTS: readonly QuestionCount[] = [3, 5, 10];

/** Types the deterministic local generator can build from the text. */
export const LOCAL_QUESTION_TYPES: readonly QuestionType[] = ['qcm', 'vrai_faux', 'ordre'];

export type GenerationOutcome =
  | { kind: 'ok'; exercise: Exercise }
  | { kind: 'blocked'; message: string }
  | { kind: 'empty' }
  | { kind: 'aborted' };

export interface GenerationInput {
  childId: Id;
  documentId: Id;
  documentHash: string | null;
  pages: AIPageInput[];
  count: QuestionCount;
  types: QuestionType[];
  aiAllowed: boolean;
  signal?: AbortSignal;
  now?: number;
}

/** Types allowed by the child profile, in canonical order (every type when the profile lists none). */
export function profileQuestionTypes(enabledTypes: readonly QuestionType[]): QuestionType[] {
  const enabled = QUESTION_TYPES.filter((type) => enabledTypes.includes(type));
  return enabled.length > 0 ? enabled : [...QUESTION_TYPES];
}

const nonEmpty = (s: string): boolean => s.trim().length > 0;

/** Defensive check before showing a question: the player must be able to render and correct it. */
export function isPlayableQuestion(q: Question): boolean {
  if (!nonEmpty(q.id) || !nonEmpty(q.prompt)) return false;
  switch (q.type) {
    case 'qcm':
      return q.choices.length >= 2 && q.choices.every(nonEmpty) && Number.isInteger(q.correctIndex)
        && q.correctIndex >= 0 && q.correctIndex < q.choices.length;
    case 'vrai_faux':
      return typeof q.answer === 'boolean';
    case 'reponse_libre':
      return nonEmpty(q.expectedAnswer);
    case 'association':
      return q.pairs.length >= 2 && q.pairs.every((p) => nonEmpty(p.left) && nonEmpty(p.right));
    case 'ordre':
      return q.itemsInOrder.length >= 2 && q.itemsInOrder.every(nonEmpty);
  }
}

/** Keeps playable questions of the wanted types, with unique ids, at most `count`. */
export function cleanQuestions(questions: readonly Question[], types: readonly QuestionType[], count: number): Question[] {
  const seen = new Set<string>();
  const kept: Question[] = [];
  for (const q of questions) {
    if (kept.length >= count) break;
    if (!types.includes(q.type) || !isPlayableQuestion(q)) continue;
    let id = q.id;
    for (let n = 2; seen.has(id); n += 1) id = `${q.id}-${n}`;
    seen.add(id);
    kept.push(id === q.id ? q : { ...q, id });
  }
  return kept;
}

function localQuestions(input: GenerationInput, seed: number): Question[] {
  const wanted = input.types.filter((t) => LOCAL_QUESTION_TYPES.includes(t));
  if (wanted.length > 0) {
    const questions = cleanQuestions(generateLocalQuestions(input.pages, input.count, wanted, seed), wanted, input.count);
    if (questions.length > 0) return questions;
  }
  // The profile only allows types the local generator cannot build: better some questions than none.
  return cleanQuestions(generateLocalQuestions(input.pages, input.count, [...LOCAL_QUESTION_TYPES], seed), LOCAL_QUESTION_TYPES, input.count);
}

/** Online questions when possible, otherwise local ones; the exercise is saved (Dexie + sync outbox). */
export async function createExercise(input: GenerationInput): Promise<GenerationOutcome> {
  if (input.pages.length === 0 || input.types.length === 0) return { kind: 'empty' };
  const now = input.now ?? Date.now();

  let questions: Question[] = [];
  let origin: Exercise['origin'] = 'local';
  if (input.aiAllowed) {
    const result = await requestAI(
      'generate_questions',
      { childId: input.childId, documentId: input.documentId, documentHash: input.documentHash, count: input.count, types: input.types, pages: input.pages },
      { signal: input.signal },
    );
    if (input.signal?.aborted) return { kind: 'aborted' };
    if (result.status === 'ok') {
      questions = cleanQuestions(result.data.questions, input.types, input.count);
      origin = result.meta.route === 'local' ? 'local' : 'ai';
    } else if (result.status === 'blocked' && result.reason !== 'validation') {
      return { kind: 'blocked', message: kidMessage(result) };
    }
  }

  if (questions.length === 0) {
    questions = localQuestions(input, now % 2_147_483_647);
    origin = 'local';
  }
  if (questions.length === 0) return { kind: 'empty' };

  const exercise: Exercise = {
    id: newId(),
    childId: input.childId,
    documentId: input.documentId,
    pageIndexes: [...new Set(input.pages.map((p) => p.pageIndex))].sort((a, b) => a - b),
    questions,
    origin,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await saveEntity('exercises', exercise);
  return { kind: 'ok', exercise };
}

/** « Refaire le quiz »: same questions in a new exercise, so earlier answers stay in the history. */
export async function duplicateExercise(source: Exercise, now: number = Date.now()): Promise<Exercise> {
  const copy: Exercise = { ...source, id: newId(), createdAt: now, updatedAt: now, deletedAt: null };
  await saveEntity('exercises', copy);
  return copy;
}
