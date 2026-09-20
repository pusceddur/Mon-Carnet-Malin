// free_questions (§18.3): every question of « Pose ta question » with its outcome, for the parent (never shown to the child).
import { LIMITS, newId, type FreeQuestionLogEntry, type FreeQuestionOutcome } from '@aide/shared';
import { type Db, type Row, toNum, toStr, toStrOrNull } from './common';

const TABLE = 'free_questions';

/** §18.3: questions are kept 30 days. */
export const FREE_QUESTIONS_RETENTION_MS = 30 * 24 * 60 * 60_000;
/** Longest answer stored (answer + example of a validated answer, or a dictionary definition). */
const ANSWER_TEXT_MAX_CHARS = 4000;

export interface FreeQuestionRecord {
  parentId: string;
  childId: string;
  question: string;
  outcome: FreeQuestionOutcome;
  /** Only for `answered`. */
  answerText: string | null;
  createdAt: number;
}

export interface FreeQuestionsRepository {
  insert(record: FreeQuestionRecord): Promise<void>;
}

function toRow(record: FreeQuestionRecord): Row {
  return {
    id: newId(),
    parent_id: record.parentId,
    child_id: record.childId,
    question: record.question.slice(0, LIMITS.freeQuestionMaxChars),
    outcome: record.outcome,
    answer_text: record.outcome === 'answered' && record.answerText !== null ? record.answerText.slice(0, ANSWER_TEXT_MAX_CHARS) : null,
    created_at: record.createdAt,
  };
}

export function createFreeQuestionsRepository(db: Db): FreeQuestionsRepository {
  return {
    async insert(record) {
      await db(TABLE).insert(toRow(record));
    },
  };
}

export function createMemoryFreeQuestionsRepository(): FreeQuestionsRepository & { records: FreeQuestionRecord[] } {
  const records: FreeQuestionRecord[] = [];
  return {
    records,
    insert(record) {
      records.push({ ...record, answerText: record.outcome === 'answered' ? record.answerText : null });
      return Promise.resolve();
    },
  };
}

/** Questions of one child of `parentId` created at or after `since`, newest first. */
export async function listFreeQuestions(db: Db, parentId: string, childId: string, opts: { since: number; limit: number }): Promise<FreeQuestionLogEntry[]> {
  const rows = (await db(TABLE)
    .select('id', 'child_id', 'question', 'outcome', 'answer_text', 'created_at')
    .where({ parent_id: parentId, child_id: childId })
    .andWhere('created_at', '>=', opts.since)
    .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'id', order: 'desc' }])
    .limit(opts.limit)) as Row[];
  return rows.map((row) => ({
    id: toStr(row.id),
    childId: toStr(row.child_id),
    question: toStr(row.question),
    outcome: toStr(row.outcome) as FreeQuestionOutcome,
    answer: toStrOrNull(row.answer_text),
    createdAt: toNum(row.created_at),
  }));
}

export async function deleteFreeQuestionsBefore(db: Db, cutoff: number): Promise<number> {
  return db(TABLE).where('created_at', '<', cutoff).delete();
}
