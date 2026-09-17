import type { ParentUser } from '@aide/shared';
import { type Db, type Row, toBool, toNum, toNumOrNull, toStr, toStrOrNull } from './common';

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  pinHash: string | null;
  pinFailedCount: number;
  pinLockedUntil: number | null;
  loginFailedCount: number;
  loginLockedUntil: number | null;
  isOwner: boolean;
  createdAt: number;
  updatedAt: number;
}

function fromRow(row: Row): UserRecord {
  return {
    id: toStr(row.id),
    email: toStr(row.email),
    displayName: toStr(row.display_name),
    passwordHash: toStr(row.password_hash),
    pinHash: toStrOrNull(row.pin_hash),
    pinFailedCount: toNum(row.pin_failed_count),
    pinLockedUntil: toNumOrNull(row.pin_locked_until),
    loginFailedCount: toNum(row.login_failed_count),
    loginLockedUntil: toNumOrNull(row.login_locked_until),
    isOwner: toBool(row.is_owner),
    createdAt: toNum(row.created_at),
    updatedAt: toNum(row.updated_at),
  };
}

export function toParentUser(user: UserRecord): ParentUser {
  return { id: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt, isOwner: user.isOwner };
}

export async function countUsers(db: Db): Promise<number> {
  const row = (await db('users').count({ n: '*' }).first()) as { n: unknown } | undefined;
  return toNum(row?.n);
}

export async function findUserByEmail(db: Db, email: string): Promise<UserRecord | null> {
  const row = (await db('users').where('email', email.trim().toLowerCase()).first()) as Row | undefined;
  return row ? fromRow(row) : null;
}

export async function findUserById(db: Db, id: string): Promise<UserRecord | null> {
  const row = (await db('users').where('id', id).first()) as Row | undefined;
  return row ? fromRow(row) : null;
}

export async function insertUser(
  db: Db,
  user: { id: string; email: string; displayName: string; passwordHash: string; pinHash: string | null; isOwner: boolean; now: number },
): Promise<void> {
  await db('users').insert({
    id: user.id,
    email: user.email.trim().toLowerCase(),
    display_name: user.displayName,
    password_hash: user.passwordHash,
    pin_hash: user.pinHash,
    pin_failed_count: 0,
    pin_locked_until: null,
    login_failed_count: 0,
    login_locked_until: null,
    is_owner: user.isOwner,
    created_at: user.now,
    updated_at: user.now,
  });
}

export async function updatePasswordHash(db: Db, id: string, passwordHash: string, now: number): Promise<void> {
  await db('users').where('id', id).update({ password_hash: passwordHash, updated_at: now });
}

export async function updatePinHash(db: Db, id: string, pinHash: string, now: number): Promise<void> {
  await db('users').where('id', id).update({ pin_hash: pinHash, pin_failed_count: 0, pin_locked_until: null, updated_at: now });
}

export type AttemptKind = 'pin' | 'login';

const ATTEMPT_COLUMNS: Record<AttemptKind, { count: string; lockedUntil: string }> = {
  pin: { count: 'pin_failed_count', lockedUntil: 'pin_locked_until' },
  login: { count: 'login_failed_count', lockedUntil: 'login_locked_until' },
};

/** Atomically increments the failure counter and returns the new count. */
export async function incrementFailedAttempts(db: Db, id: string, kind: AttemptKind): Promise<number> {
  const col = ATTEMPT_COLUMNS[kind];
  await db('users').where('id', id).increment(col.count, 1);
  const row = (await db('users').select(col.count).where('id', id).first()) as Row | undefined;
  return toNum(row?.[col.count]);
}

export async function setLockedUntil(db: Db, id: string, kind: AttemptKind, lockedUntil: number | null): Promise<void> {
  await db('users').where('id', id).update({ [ATTEMPT_COLUMNS[kind].lockedUntil]: lockedUntil });
}

export async function resetAttempts(db: Db, id: string, kinds: readonly AttemptKind[]): Promise<void> {
  const patch: Row = {};
  for (const kind of kinds) {
    patch[ATTEMPT_COLUMNS[kind].count] = 0;
    patch[ATTEMPT_COLUMNS[kind].lockedUntil] = null;
  }
  await db('users').where('id', id).update(patch);
}
