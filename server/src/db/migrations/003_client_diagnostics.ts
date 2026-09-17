import type { Knex } from 'knex';
import type { SchemaDialect } from './001_initial';
import { dialectOf } from './001_initial';

// Technical problem reports sent by devices (never document text), kept 30 days by the maintenance job.

export const CLIENT_DIAGNOSTICS_TABLE = 'client_diagnostics';

/** Builds the schema changes of 003 on a schema builder (also used to render MySQL DDL in tests). */
export function buildClientDiagnosticsSchema(schema: Knex.SchemaBuilder, dialect: SchemaDialect): Knex.SchemaBuilder {
  return schema.createTable(CLIENT_DIAGNOSTICS_TABLE, (t) => {
    // Same table options as 001 (utf8mb4 + binary collation), MySQL/MariaDB only.
    if (dialect === 'mysql') {
      t.engine('InnoDB');
      t.charset('utf8mb4');
      t.collate('utf8mb4_bin');
    }
    t.string('id', 36).primary();
    t.string('parent_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('kind', 32).notNullable();
    t.string('stage', 40).nullable();
    t.text('message').notNullable();
    t.text('context_json').notNullable();
    t.string('user_agent', 400).notNullable();
    t.bigInteger('occurred_at').notNullable();
    t.bigInteger('created_at').notNullable();
    t.index(['parent_id', 'created_at'], 'client_diagnostics_parent_created_idx');
  });
}

export async function up(knex: Knex): Promise<void> {
  await buildClientDiagnosticsSchema(knex.schema, dialectOf(knex));
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists(CLIENT_DIAGNOSTICS_TABLE);
}
