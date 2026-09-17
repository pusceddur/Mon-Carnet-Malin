import { type Db, isMysql, parseJson, type Row, toNum } from './common';

// Server-wide settings stored as JSON under a key (table `app_config`, migration 002).

export interface ConfigEntry<T> { value: T; updatedAt: number | null }

export async function readConfig<T>(db: Db, key: string, fallback: T): Promise<ConfigEntry<T>> {
  const row = (await db('app_config').where('key', key).first()) as Row | undefined;
  if (!row) return { value: fallback, updatedAt: null };
  return { value: parseJson<T>(row.value_json, fallback), updatedAt: toNum(row.updated_at) };
}

export async function writeConfig(db: Db, key: string, value: unknown, now: number): Promise<void> {
  await db('app_config')
    .insert({ key, value_json: JSON.stringify(value), updated_at: now })
    .onConflict('key')
    .merge(['value_json', 'updated_at']);
}

/**
 * Read-modify-write of one key inside a transaction (row locked on MySQL; SQLite uses a single connection).
 * Returns the value written.
 */
export async function updateConfig<T>(db: Db, key: string, fallback: T, update: (current: T) => T, now: number): Promise<T> {
  return db.transaction(async (trx) => {
    // The row must exist before locking it, otherwise two concurrent inserts would conflict.
    await trx('app_config').insert({ key, value_json: JSON.stringify(fallback), updated_at: now }).onConflict('key').ignore();
    const query = trx('app_config').where('key', key).first();
    const row = (await (isMysql(trx) ? query.forUpdate() : query)) as Row | undefined;
    const next = update(parseJson<T>(row?.value_json, fallback));
    await trx('app_config').where('key', key).update({ value_json: JSON.stringify(next), updated_at: now });
    return next;
  });
}
