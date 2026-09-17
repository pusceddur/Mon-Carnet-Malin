// Authentication sessions (table `sessions`). Reading sessions live in readingSessions.ts.
import { type Db, type Row, toNum, toNumOrNull, toStr, toStrOrNull } from './common';

export interface SessionRecord {
  /** sha256 hex of the cookie token. */
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  parentUnlockedUntil: number | null;
  userAgent: string | null;
}

function fromRow(row: Row): SessionRecord {
  return {
    id: toStr(row.id),
    userId: toStr(row.user_id),
    createdAt: toNum(row.created_at),
    expiresAt: toNum(row.expires_at),
    lastSeenAt: toNum(row.last_seen_at),
    parentUnlockedUntil: toNumOrNull(row.parent_unlocked_until),
    userAgent: toStrOrNull(row.user_agent),
  };
}

export async function insertSession(db: Db, s: SessionRecord): Promise<void> {
  await db('sessions').insert({
    id: s.id,
    user_id: s.userId,
    created_at: s.createdAt,
    expires_at: s.expiresAt,
    last_seen_at: s.lastSeenAt,
    parent_unlocked_until: s.parentUnlockedUntil,
    user_agent: s.userAgent === null ? null : s.userAgent.slice(0, 255),
  });
}

export async function findSession(db: Db, id: string): Promise<SessionRecord | null> {
  const row = (await db('sessions').where('id', id).first()) as Row | undefined;
  return row ? fromRow(row) : null;
}

export async function renewSession(db: Db, id: string, now: number, expiresAt: number): Promise<void> {
  await db('sessions').where('id', id).update({ last_seen_at: now, expires_at: expiresAt });
}

export async function setParentUnlockedUntil(db: Db, id: string, until: number | null): Promise<void> {
  await db('sessions').where('id', id).update({ parent_unlocked_until: until });
}

export async function deleteSession(db: Db, id: string): Promise<void> {
  await db('sessions').where('id', id).delete();
}

/** Deletes every session of a user except `keepId` (after a password change). */
export async function deleteOtherSessions(db: Db, userId: string, keepId: string): Promise<number> {
  return db('sessions').where('user_id', userId).andWhereNot('id', keepId).delete();
}

export async function deleteExpiredSessions(db: Db, now: number): Promise<number> {
  return db('sessions').where('expires_at', '<=', now).delete();
}
