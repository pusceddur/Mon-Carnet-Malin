// Authentication sessions (table `sessions`). Reading sessions live in readingSessions.ts.
import { type Db, type Row, toBool, toNum, toNumOrNull, toStr, toStrOrNull } from './common';

export interface SessionRecord {
  /** sha256 hex of the cookie token. */
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  parentUnlockedUntil: number | null;
  userAgent: string | null;
  /** §20 last known IP address and name sent by the app. */
  ip: string | null;
  deviceName: string | null;
}

/** Session with the account setting read at the same time (every authenticated request). */
export interface SessionWithAccount extends SessionRecord {
  /** §20: false = the Réglages open without the code. */
  pinRequired: boolean;
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
    ip: toStrOrNull(row.ip),
    deviceName: toStrOrNull(row.device_name),
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
    ip: s.ip === null ? null : s.ip.slice(0, 45),
    device_name: s.deviceName === null ? null : s.deviceName.slice(0, 80),
  });
}

export async function findSession(db: Db, id: string): Promise<SessionWithAccount | null> {
  const row = (await db('sessions as s').join('users as u', 'u.id', 's.user_id').select('s.*', 'u.pin_required').where('s.id', id).first()) as Row | undefined;
  if (!row) return null;
  return { ...fromRow(row), pinRequired: row.pin_required === null || row.pin_required === undefined ? true : toBool(row.pin_required) };
}

/** Sliding expiry, written at most once per hour; also keeps the last IP address. */
export async function renewSession(db: Db, id: string, now: number, expiresAt: number, ip: string | null = null): Promise<void> {
  await db('sessions').where('id', id).update({ last_seen_at: now, expires_at: expiresAt, ...(ip ? { ip: ip.slice(0, 45) } : {}) });
}

/** §20 « Appareils connectés »: sessions of an account, most recently used first. */
export async function listUserSessions(db: Db, userId: string): Promise<SessionRecord[]> {
  const rows = (await db('sessions').where('user_id', userId).orderBy('last_seen_at', 'desc')) as Row[];
  return rows.map(fromRow);
}

export async function setSessionDeviceName(db: Db, id: string, name: string): Promise<void> {
  await db('sessions').where('id', id).update({ device_name: name.slice(0, 80) });
}

/** Signs out every device of the account (password reset, no confirmation of use). */
export async function deleteUserSessions(db: Db, userId: string): Promise<number> {
  return db('sessions').where('user_id', userId).delete();
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
