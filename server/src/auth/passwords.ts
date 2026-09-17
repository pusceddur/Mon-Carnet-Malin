import { createHash, timingSafeEqual } from 'node:crypto';
import { compare, hash } from 'bcryptjs';

/** bcrypt hash of a password or PIN. */
export function hashSecret(secret: string, rounds: number): Promise<string> {
  return hash(secret, rounds);
}

/** Never throws: a malformed stored hash simply does not match. */
export async function verifySecret(secret: string, storedHash: string): Promise<boolean> {
  try {
    return await compare(secret, storedHash);
  } catch {
    return false;
  }
}

const dummyHashes = new Map<number, Promise<string>>();

/** Hash used to spend the same bcrypt time when the account does not exist (no user enumeration by timing). */
export function dummyHash(rounds: number): Promise<string> {
  let existing = dummyHashes.get(rounds);
  if (!existing) {
    existing = hash('aide-dummy-password-for-timing', rounds);
    dummyHashes.set(rounds, existing);
  }
  return existing;
}

/** Constant-time string comparison (both sides hashed first so lengths never leak). */
export function timingSafeEqualString(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}
