import { randomInt } from 'node:crypto';
import type { InvitationConfig } from '@aide/shared';
import { readConfig, updateConfig, writeConfig } from '../db/repositories/appConfig';
import type { Db } from '../db/repositories/common';
import { isLocked, lockUntilAfterFailure, type LockoutPolicy } from './lockout';
import { timingSafeEqualString } from './passwords';

export const INVITATION_CONFIG_KEY = 'invitation';
export const INVITATION_FAILURES_KEY = 'invitation_failures';

/** Global lock on wrong invitation codes: 10 consecutive failures, then 5 min doubling up to 24 h. */
export const INVITATION_LOCKOUT = {
  freeAttempts: 10,
  firstLockMs: 5 * 60_000,
  maxLockMs: 24 * 60 * 60_000,
} as const satisfies LockoutPolicy;

/** Readable alphabet: no 0/O, 1/I/L, 5/S, 8/B, 2/Z. */
export const INVITE_CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';
const GROUPS = 3;
const GROUP_LENGTH = 4;

interface StoredInvitation { enabled: boolean; code: string }
export interface InvitationFailures { count: number; lockedUntil: number | null }

const NO_INVITATION: StoredInvitation = { enabled: false, code: '' };
const NO_FAILURES: InvitationFailures = { count: 0, lockedUntil: null };

export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Random code such as `K7QM-3FXA-9TRD` (crypto RNG, ~55 bits). */
export function generateInviteCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let group = '';
    for (let i = 0; i < GROUP_LENGTH; i++) group += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
    groups.push(group);
  }
  return groups.join('-');
}

export async function getInvitation(db: Db): Promise<InvitationConfig> {
  const { value, updatedAt } = await readConfig<StoredInvitation>(db, INVITATION_CONFIG_KEY, NO_INVITATION);
  return {
    enabled: value.enabled === true,
    code: typeof value.code === 'string' ? value.code : '',
    updatedAt,
  };
}

export async function saveInvitation(db: Db, invitation: StoredInvitation, now: number): Promise<void> {
  await writeConfig(db, INVITATION_CONFIG_KEY, { enabled: invitation.enabled, code: invitation.code }, now);
}

export function isInvitationUsable(invitation: InvitationConfig): boolean {
  return invitation.enabled && invitation.code !== '';
}

/** Timing-safe, whitespace- and case-insensitive comparison with the configured code. */
export function inviteCodeMatches(invitation: InvitationConfig, candidate: string): boolean {
  const matches = timingSafeEqualString(normalizeInviteCode(candidate), normalizeInviteCode(invitation.code));
  return matches && isInvitationUsable(invitation);
}

export async function getInvitationFailures(db: Db): Promise<InvitationFailures> {
  const { value } = await readConfig<InvitationFailures>(db, INVITATION_FAILURES_KEY, NO_FAILURES);
  return {
    count: Number.isFinite(value.count) ? value.count : 0,
    lockedUntil: typeof value.lockedUntil === 'number' ? value.lockedUntil : null,
  };
}

export async function invitationLockedUntil(db: Db, now: number): Promise<number | null> {
  const { lockedUntil } = await getInvitationFailures(db);
  return isLocked(lockedUntil, now) ? lockedUntil : null;
}

/** Counts a wrong code (atomic read-modify-write) and applies the progressive lock. */
export async function registerInvitationFailure(db: Db, now: number): Promise<InvitationFailures> {
  return updateConfig<InvitationFailures>(db, INVITATION_FAILURES_KEY, NO_FAILURES, (current) => {
    const count = (Number.isFinite(current.count) ? current.count : 0) + 1;
    return { count, lockedUntil: lockUntilAfterFailure(count, now, INVITATION_LOCKOUT) };
  }, now);
}

export async function resetInvitationFailures(db: Db, now: number): Promise<void> {
  await writeConfig(db, INVITATION_FAILURES_KEY, NO_FAILURES, now);
}
