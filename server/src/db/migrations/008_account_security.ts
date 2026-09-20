import type { Knex } from 'knex';
import { dialectOf, type SchemaDialect } from './001_initial';

// §20 account security: code of the Réglages optional, confirmation of use every 180 days by e-mail, devices signed in
// (name and last IP of each session), single-use links sent by e-mail (password reset, confirmation of use).

export const EMAIL_TOKENS_TABLE = 'email_tokens';

/** Builds the schema changes of 008 on a schema builder (also used to render MySQL DDL in tests). */
export function buildAccountSecuritySchema(schema: Knex.SchemaBuilder, dialect: SchemaDialect): Knex.SchemaBuilder {
  return schema
    .alterTable('users', (t) => {
      t.boolean('pin_required').notNullable().defaultTo(true);
      t.bigInteger('continuity_confirmed_at').nullable();
      t.bigInteger('continuity_email_sent_at').nullable();
    })
    .alterTable('sessions', (t) => {
      t.string('ip', 45).nullable();
      t.string('device_name', 80).nullable();
    })
    .createTable(EMAIL_TOKENS_TABLE, (t) => {
      if (dialect === 'mysql') {
        t.engine('InnoDB');
        t.charset('utf8mb4');
        t.collate('utf8mb4_bin');
      }
      t.string('id', 64).primary(); // sha256 hex of the token sent in the link
      t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.string('purpose', 16).notNullable(); // password_reset | continuity
      t.bigInteger('created_at').notNullable();
      t.bigInteger('expires_at').notNullable();
      t.bigInteger('used_at').nullable();
      t.index(['user_id', 'purpose'], 'email_tokens_user_purpose_idx');
      t.index(['expires_at'], 'email_tokens_expires_at_idx');
    });
}

export async function up(knex: Knex): Promise<void> {
  await buildAccountSecuritySchema(knex.schema, dialectOf(knex));
  // Existing accounts start their 180 days now.
  await knex('users').update({ continuity_confirmed_at: Date.now() });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists(EMAIL_TOKENS_TABLE);
  await knex.schema.alterTable('sessions', (t) => {
    t.dropColumn('device_name');
    t.dropColumn('ip');
  });
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('continuity_email_sent_at');
    t.dropColumn('continuity_confirmed_at');
    t.dropColumn('pin_required');
  });
}
