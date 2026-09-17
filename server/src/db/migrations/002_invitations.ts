import type { Knex } from 'knex';
import { dialectOf, type SchemaDialect } from './001_initial';

// Invitation-based registration: `users.is_owner` (the account that manages invitations) and a key/value `app_config`.

export const APP_CONFIG_KEY_LENGTH = 64;

/** Builds the schema changes of 002 on a schema builder (also used to render MySQL DDL in tests). */
export function buildInvitationsSchema(schema: Knex.SchemaBuilder, dialect: SchemaDialect): Knex.SchemaBuilder {
  return schema
    .alterTable('users', (t) => {
      t.boolean('is_owner').notNullable().defaultTo(false);
    })
    .createTable('app_config', (t) => {
      // Same table options as 001 (utf8mb4 + binary collation), MySQL/MariaDB only.
      if (dialect === 'mysql') {
        t.engine('InnoDB');
        t.charset('utf8mb4');
        t.collate('utf8mb4_bin');
      }
      t.string('key', APP_CONFIG_KEY_LENGTH).primary();
      t.text('value_json').notNullable();
      t.bigInteger('updated_at').notNullable();
    });
}

export async function up(knex: Knex): Promise<void> {
  await buildInvitationsSchema(knex.schema, dialectOf(knex));
  // Existing installations: the oldest account becomes the owner.
  const owner = (await knex('users').where('is_owner', true).first('id')) as { id: string } | undefined;
  if (owner) return;
  const oldest = (await knex('users').orderBy([{ column: 'created_at' }, { column: 'id' }]).first('id')) as { id: string } | undefined;
  if (oldest) await knex('users').where('id', oldest.id).update({ is_owner: true });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('app_config');
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('is_owner');
  });
}
