import type { Knex } from 'knex';
import { dialectOf, type SchemaDialect } from './001_initial';

// External worker queue (§17.2): generic jobs leased over HTTPS by the home worker, and the state it reports.
// `request_json` never outlives the job (emptied once the job is final); `worker_state.info_json` never holds document text.

export const WORKER_JOBS_TABLE = 'worker_jobs';
export const WORKER_STATE_TABLE = 'worker_state';
export const WORKER_TABLES = [WORKER_JOBS_TABLE, WORKER_STATE_TABLE] as const;

/** Builds the schema changes of 004 on a schema builder (also used to render MySQL DDL in tests). */
export function buildWorkerJobsSchema(schema: Knex.SchemaBuilder, dialect: SchemaDialect): Knex.SchemaBuilder {
  // Same table options as 001 (utf8mb4 + binary collation), MySQL/MariaDB only.
  const options = (t: Knex.CreateTableBuilder): void => {
    if (dialect === 'mysql') {
      t.engine('InnoDB');
      t.charset('utf8mb4');
      t.collate('utf8mb4_bin');
    }
  };
  return schema
    .createTable(WORKER_JOBS_TABLE, (t) => {
      options(t);
      t.string('id', 36).primary();
      t.string('parent_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.string('kind', 16).notNullable(); // ai | page_text | page_speech (§22) (page_audio reserved)
      t.string('tier', 16).notNullable(); // light | complex
      t.string('operation', 40).notNullable();
      t.string('document_id', 36).nullable();
      t.integer('page_index').nullable();
      t.string('image_sha256', 64).nullable();
      t.text('request_json', 'longtext').notNullable();
      t.string('status', 16).notNullable(); // queued | leased | done | failed | expired | skipped
      t.integer('priority').notNullable().defaultTo(0);
      t.bigInteger('lease_until').nullable();
      t.string('leased_by', 64).nullable();
      t.integer('attempts').notNullable().defaultTo(0);
      t.text('result_json', 'longtext').nullable();
      t.string('error', 40).nullable();
      t.bigInteger('created_at').notNullable();
      t.bigInteger('updated_at').notNullable();
      t.bigInteger('expires_at').notNullable();
      t.index(['status', 'priority', 'created_at'], 'worker_jobs_status_priority_idx');
      t.index(['parent_id', 'document_id', 'page_index'], 'worker_jobs_parent_page_idx');
      t.index(['expires_at'], 'worker_jobs_expires_at_idx');
    })
    .createTable(WORKER_STATE_TABLE, (t) => {
      options(t);
      t.string('worker_name', 64).primary();
      t.bigInteger('last_seen_at').notNullable();
      t.bigInteger('limited_until').nullable();
      t.text('info_json').notNullable();
    });
}

export async function up(knex: Knex): Promise<void> {
  await buildWorkerJobsSchema(knex.schema, dialectOf(knex));
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists(WORKER_STATE_TABLE);
  await knex.schema.dropTableIfExists(WORKER_JOBS_TABLE);
}
