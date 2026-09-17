import type { Knex } from 'knex';

/** A knex instance or an open transaction. */
export type Db = Knex | Knex.Transaction;

export type Row = Record<string, unknown>;

export function isMysql(db: Db): boolean {
  return String(db.client.config.client).startsWith('mysql');
}

/** BIGINT/INT columns may come back as number, string or bigint depending on the driver. */
export function toNum(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return 0;
}

export function toNumOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : toNum(value);
}

/** SQLite stores booleans as 0/1, MySQL as TINYINT(1). */
export function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function toStr(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

export function toStrOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : toStr(value);
}

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Rows of `db.raw()` for both drivers (mysql2 answers `[rows, fields]`, better-sqlite3 answers rows). */
export function rawRows(result: unknown): Row[] {
  if (Array.isArray(result)) {
    const first: unknown = result[0];
    if (Array.isArray(first)) return first as Row[];
    return result as Row[];
  }
  return [];
}

/**
 * Updates many rows of a single-key table in chunks, giving each row its own value of `column`
 * (portable `CASE key WHEN ? THEN ? END`). `common` columns are set identically on every row.
 */
export async function updateEach(
  db: Db,
  table: string,
  keyColumn: string,
  column: string,
  values: ReadonlyArray<readonly [string, number]>,
  common: Row,
  chunkSize = 200,
): Promise<void> {
  for (let i = 0; i < values.length; i += chunkSize) {
    const chunk = values.slice(i, i + chunkSize);
    const cases = chunk.map(() => 'when ? then ?').join(' ');
    const bindings = chunk.flatMap(([key, value]) => [key, value]);
    await db(table)
      .whereIn(keyColumn, chunk.map(([key]) => key))
      .update({ ...common, [column]: db.raw(`case ?? ${cases} end`, [keyColumn, ...bindings]) });
  }
}

/** UNIQUE/PRIMARY KEY violation for both drivers (mysql2 `ER_DUP_ENTRY`, better-sqlite3 `SQLITE_CONSTRAINT_*`). */
export function isUniqueViolation(err: unknown): boolean {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  return code === 'ER_DUP_ENTRY' || code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
}
