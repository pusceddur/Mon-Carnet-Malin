import type { Knex } from 'knex';
import { type Db, isMysql, toNum } from './common';

/**
 * Hands out the per-parent `server_seq` values inside one transaction (§15.2).
 * The counter row stays locked until the transaction ends (MySQL `FOR UPDATE`; SQLite has a single writer),
 * so concurrent writers of the same family are serialized and a pulled cursor never skips a later commit.
 */
export interface SeqAllocator {
  next(): number;
  /** Last value handed out (or the stored counter when none). */
  readonly current: number;
  /** Persists the counter; call before the transaction commits. */
  flush(): Promise<void>;
}

export async function openSeqAllocator(trx: Knex.Transaction, parentId: string): Promise<SeqAllocator> {
  await trx('sync_counters').insert({ parent_id: parentId, seq: 0 }).onConflict('parent_id').ignore();
  const query = trx('sync_counters').select('seq').where('parent_id', parentId).first();
  const row = (await (isMysql(trx) ? query.forUpdate() : query)) as { seq: unknown } | undefined;
  const stored = toNum(row?.seq);
  let current = stored;
  return {
    next: () => {
      current += 1;
      return current;
    },
    get current() {
      return current;
    },
    flush: async () => {
      if (current !== stored) await trx('sync_counters').where('parent_id', parentId).update({ seq: current });
    },
  };
}

/** Runs `fn` in a transaction with a seq allocator, flushing the counter before commit. */
export async function withSeq<T>(db: Knex, parentId: string, fn: (trx: Knex.Transaction, seq: SeqAllocator) => Promise<T>): Promise<T> {
  return db.transaction(async (trx) => {
    const seq = await openSeqAllocator(trx, parentId);
    const result = await fn(trx, seq);
    await seq.flush();
    return result;
  });
}

export async function currentSeq(db: Db, parentId: string): Promise<number> {
  const row = (await db('sync_counters').select('seq').where('parent_id', parentId).first()) as { seq: unknown } | undefined;
  return toNum(row?.seq);
}
