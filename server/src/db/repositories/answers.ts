import type { Answer } from '@aide/shared';
import { type Db, type Row, parseJson, toNum, toStr } from './common';

export function answerFromRow(row: Row): Answer {
  const data = parseJson<Answer>(row.data_json, {} as Answer);
  return {
    ...data,
    id: toStr(row.id),
    exerciseId: toStr(row.exercise_id),
    questionId: toStr(row.question_id),
    childId: toStr(row.child_id),
    updatedAt: toNum(row.updated_at),
  };
}

export async function findAnswer(db: Db, id: string): Promise<{ parentId: string; answer: Answer } | null> {
  const row = (await db('answers').where('id', id).first()) as Row | undefined;
  return row ? { parentId: toStr(row.parent_id), answer: answerFromRow(row) } : null;
}

export async function saveAnswer(db: Db, parentId: string, a: Answer, serverSeq: number): Promise<void> {
  await db('answers')
    .insert({
      id: a.id,
      parent_id: parentId,
      child_id: a.childId,
      exercise_id: a.exerciseId,
      question_id: a.questionId,
      data_json: JSON.stringify(a),
      verdict: a.verdict,
      created_at: a.createdAt,
      updated_at: a.updatedAt,
      server_seq: serverSeq,
    })
    .onConflict('id')
    .merge();
}
