import { parseArgs } from 'node:util';
import { newId, type ParentUser, SetupRequestSchema } from '@aide/shared';
import { z } from 'zod';
import { type Db, isUniqueViolation } from '../db/repositories/common';
import { countUsers, findUserByEmail, findUserById, insertUser, toParentUser } from '../db/repositories/users';
import { appError, parseOrThrow } from '../errors';
import { hashSecret } from './passwords';

export const CreateParentInputSchema = SetupRequestSchema.omit({ setupToken: true });
export type CreateParentInput = z.input<typeof CreateParentInputSchema>;

export interface CreateParentOptions {
  now: number;
  rounds: number;
  /** Default: owner only when it is the first account of the server. */
  isOwner?: boolean;
}

/** Validates and creates a parent account (password and PIN hashed). 409 `email_taken` when the e-mail exists. */
export async function createParentAccount(db: Db, input: CreateParentInput, opts: CreateParentOptions): Promise<ParentUser> {
  const data = parseOrThrow(CreateParentInputSchema, input);
  if (await findUserByEmail(db, data.email)) throw appError(409, 'email_taken');
  const id = newId();
  const isOwner = opts.isOwner ?? (await countUsers(db)) === 0;
  const [passwordHash, pinHash] = await Promise.all([hashSecret(data.password, opts.rounds), hashSecret(data.pin, opts.rounds)]);
  try {
    await insertUser(db, { id, email: data.email, displayName: data.displayName, passwordHash, pinHash, isOwner, now: opts.now });
  } catch (err) {
    // Concurrent creation with the same e-mail: the UNIQUE index wins the race.
    if (isUniqueViolation(err)) throw appError(409, 'email_taken');
    throw err;
  }
  const user = await findUserById(db, id);
  if (!user) throw new Error('parent_not_created');
  return toParentUser(user);
}

export interface CreateParentArgs { email: string; name: string; passwordEnv: string; pinEnv: string }

/** Parses argv; returns an error message (English, for the operator) instead of throwing. */
export function parseCreateParentArgs(argv: readonly string[]): CreateParentArgs | { error: string } {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        email: { type: 'string' },
        name: { type: 'string' },
        'password-env': { type: 'string' },
        'pin-env': { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'invalid arguments' };
  }
  const get = (key: string): string | null => (typeof values[key] === 'string' && values[key] !== '' ? (values[key] as string) : null);
  const email = get('email');
  const name = get('name');
  const passwordEnv = get('password-env');
  const pinEnv = get('pin-env');
  if (!email || !name || !passwordEnv || !pinEnv) return { error: 'missing required option' };
  const envName = /^[A-Za-z_][A-Za-z0-9_]*$/;
  if (!envName.test(passwordEnv) || !envName.test(pinEnv)) return { error: 'invalid environment variable name' };
  return { email, name, passwordEnv, pinEnv };
}
