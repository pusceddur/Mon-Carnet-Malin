// §15.8 progressive lockout stored in the database (PIN per account, login per e-mail, invitation codes globally).

export interface LockoutPolicy {
  /** Failures allowed before the first lock. */
  freeAttempts: number;
  firstLockMs: number;
  maxLockMs: number;
}

export const LOCKOUT = {
  freeAttempts: 5,
  firstLockMs: 60_000,
  maxLockMs: 24 * 60 * 60_000,
} as const satisfies LockoutPolicy;

export function isLocked(lockedUntil: number | null, now: number): boolean {
  return lockedUntil !== null && lockedUntil > now;
}

/**
 * Lock end after the `failedCount`-th consecutive failure: none before `freeAttempts`, then `firstLockMs` doubling
 * up to `maxLockMs` (default policy: 5 failures, 1 min, 24 h).
 */
export function lockUntilAfterFailure(failedCount: number, now: number, policy: LockoutPolicy = LOCKOUT): number | null {
  if (failedCount < policy.freeAttempts) return null;
  const exponent = Math.min(failedCount - policy.freeAttempts, 30);
  return now + Math.min(policy.firstLockMs * 2 ** exponent, policy.maxLockMs);
}
