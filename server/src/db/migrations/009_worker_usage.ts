import type { Knex } from 'knex';
import { dialectOf, type SchemaDialect } from './001_initial';

// §21 use of the home worker: one row per result it reports, with the cost of the run estimated on its side. Kept after
// the job itself is purged, for the « Budget du mois » (month to date) and the Options page.

export const WORKER_USAGE_TABLE = 'worker_usage';

/** Builds the schema changes of 009 on a schema builder (also used to render MySQL DDL in tests). */
export function buildWorkerUsageSchema(schema: Knex.SchemaBuilder, dialect: SchemaDialect): Knex.SchemaBuilder {
  return schema.createTable(WORKER_USAGE_TABLE, (t) => {
    if (dialect === 'mysql') {
      t.engine('InnoDB');
      t.charset('utf8mb4');
      t.collate('utf8mb4_bin');
    }
    t.string('id', 36).primary();
    t.string('parent_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('kind', 16).notNullable(); // ai | page_text
    t.string('operation', 40).notNullable();
    t.string('outcome', 16).notNullable(); // done | error code
    t.integer('input_tokens').nullable();
    t.integer('output_tokens').nullable();
    t.bigInteger('cost_micros').nullable(); // millionths of a euro
    t.bigInteger('created_at').notNullable();
    t.index(['parent_id', 'created_at'], 'worker_usage_parent_created_idx');
    t.index(['created_at'], 'worker_usage_created_at_idx');
  });
}

export async function up(knex: Knex): Promise<void> {
  await buildWorkerUsageSchema(knex.schema, dialectOf(knex));
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists(WORKER_USAGE_TABLE);
}
