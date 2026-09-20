// §20 single-use links sent by e-mail (table `email_tokens`): only the sha256 of the token is stored.
import { createHash, randomBytes } from 'node:crypto';
import { type Db, type Row, toStr } from './common';

export type EmailTokenPurpose = 'password_reset' | 'continuity';

const TABLE = 'email_tokens';

export function hashEmailToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** New link token for this purpose; older unused links of the same purpose stop working. */
export async function createEmailToken(db: Db, userId: string, purpose: EmailTokenPurpose, now: number, ttlMs: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db(TABLE).where({ user_id: userId, purpose }).whereNull('used_at').delete();
  await db(TABLE).insert({ id: hashEmailToken(token), user_id: userId, purpose, created_at: now, expires_at: now + ttlMs, used_at: null });
  return token;
}

/** Account of a valid (known, unused, not expired) token, without using it. */
export async function findValidEmailToken(db: Db, token: string, purpose: EmailTokenPurpose, now: number): Promise<string | null> {
  const row = (await db(TABLE)
    .where({ id: hashEmailToken(token), purpose })
    .whereNull('used_at')
    .andWhere('expires_at', '>', now)
    .first()) as Row | undefined;
  return row ? toStr(row.user_id) : null;
}

/** Uses the token once (conditional update: two concurrent uses cannot both succeed). Returns the account or null. */
export async function consumeEmailToken(db: Db, token: string, purpose: EmailTokenPurpose, now: number): Promise<string | null> {
  const userId = await findValidEmailToken(db, token, purpose, now);
  if (!userId) return null;
  const updated = await db(TABLE).where({ id: hashEmailToken(token), purpose }).whereNull('used_at').update({ used_at: now });
  return updated === 1 ? userId : null;
}

/** Retention: expired or used links. */
export async function deleteStaleEmailTokens(db: Db, now: number): Promise<number> {
  return db(TABLE).where('expires_at', '<=', now).orWhereNotNull('used_at').delete();
}
