import type { Knex } from 'knex';
import { dialectOf, type SchemaDialect } from './001_initial';

// §30 « Supprimer le compte »: deleting an account for good, from the app or the browser.
//
// Two things the deletion itself cannot do without help.
//
// An iPad that was switched off while the account was deleted still holds the books and a session token that looks
// valid. `deleted_accounts` keeps the hashes of those tokens — the same sha256 that `sessions.id` already is, never
// the token, never anything about the person — so that the device is answered `410 account_deleted` and empties
// itself. Kept 180 days, which is how long a session could have lived.
//
// And the cache of AI answers is keyed by a hash that carries the family (§28) but cannot be searched by it. A
// nullable `parent_id` makes those rows findable, so a deleted family's answers about their own books go with them
// instead of sitting on the server until they expire.

export const DELETED_ACCOUNTS_TABLE = 'deleted_accounts';

export function buildAccountDeletionSchema(schema: Knex.SchemaBuilder, dialect: SchemaDialect): Knex.SchemaBuilder {
  return schema
    .createTable(DELETED_ACCOUNTS_TABLE, (t) => {
      if (dialect === 'mysql') {
        t.engine('InnoDB');
        t.charset('utf8mb4');
        t.collate('utf8mb4_bin');
      }
      // The sha256 of a session token, which is what `sessions.id` holds. No user id, no e-mail, nothing else:
      // this table must say nothing about who the account belonged to.
      t.string('session_hash', 64).primary();
      t.bigInteger('deleted_at').notNullable();
      t.index(['deleted_at'], 'deleted_accounts_deleted_at_idx');
    })
    .alterTable('ai_cache', (t) => {
      t.string('parent_id', 36).nullable();
      t.index(['parent_id'], 'ai_cache_parent_idx');
    });
}

export async function up(knex: Knex): Promise<void> {
  await buildAccountDeletionSchema(knex.schema, dialectOf(knex));
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ai_cache', (t) => {
    t.dropIndex(['parent_id'], 'ai_cache_parent_idx');
    t.dropColumn('parent_id');
  });
  await knex.schema.dropTableIfExists(DELETED_ACCOUNTS_TABLE);
}
