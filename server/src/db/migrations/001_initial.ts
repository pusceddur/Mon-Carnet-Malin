import type { Knex } from 'knex';

// Contract §9 + §15.2/§15.3. IDs string(36); hashes string(64); timestamps bigInteger (epoch ms); JSON as longtext.
// Syncable tables carry `server_seq` (per-parent monotonic counter in `sync_counters`) indexed with parent_id.
// Indexed/primary string columns always have an explicit length (MySQL cannot index TEXT without a prefix).

const ID = 36;
const HASH = 64;

export type SchemaDialect = 'mysql' | 'sqlite';

export function dialectOf(knex: Knex): SchemaDialect {
  return String(knex.client.config.client).startsWith('mysql') ? 'mysql' : 'sqlite';
}

/** Builds the whole initial schema on a schema builder (also used to render MySQL DDL in tests). */
export function buildInitialSchema(schema: Knex.SchemaBuilder, dialect: SchemaDialect): Knex.SchemaBuilder {
  // MySQL/MariaDB table options (knex rejects them on SQLite): utf8mb4 for emoji/French text, binary collation so
  // that PRIMARY/UNIQUE comparisons are case- and accent-sensitive exactly like SQLite (e.g. `élève` != `eleve`).
  const table = (build: (t: Knex.CreateTableBuilder) => void) => (t: Knex.CreateTableBuilder): void => {
    if (dialect === 'mysql') {
      t.engine('InnoDB');
      t.charset('utf8mb4');
      t.collate('utf8mb4_bin');
    }
    build(t);
  };

  return schema
    .createTable('users', table((t) => {
      t.string('id', ID).primary();
      t.string('email', 254).notNullable().unique();
      t.string('password_hash', 255).notNullable();
      t.string('display_name', 80).notNullable();
      t.string('pin_hash', 255).nullable();
      t.integer('pin_failed_count').notNullable().defaultTo(0);
      t.bigInteger('pin_locked_until').nullable();
      t.integer('login_failed_count').notNullable().defaultTo(0);
      t.bigInteger('login_locked_until').nullable();
      t.bigInteger('created_at').notNullable();
      t.bigInteger('updated_at').notNullable();
    }))
    .createTable('sessions', table((t) => {
      t.string('id', HASH).primary(); // sha256 of the session token
      t.string('user_id', ID).notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.bigInteger('created_at').notNullable();
      t.bigInteger('expires_at').notNullable();
      t.bigInteger('last_seen_at').notNullable();
      t.bigInteger('parent_unlocked_until').nullable();
      t.string('user_agent', 255).nullable();
      t.index(['expires_at'], 'sessions_expires_at_idx');
      t.index(['user_id'], 'sessions_user_idx');
    }))
    .createTable('children', table((t) => {
      t.string('id', ID).primary();
      t.string('parent_id', ID).notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.string('first_name', 80).notNullable();
      t.integer('age').notNullable();
      t.string('avatar', 32).notNullable();
      t.string('reading_level', 20).notNullable();
      t.string('explanation_difficulty', 20).notNullable();
      t.text('preferences_json', 'longtext').notNullable(); // { reading, tts, exercises }
      t.bigInteger('created_at').notNullable();
      t.bigInteger('updated_at').notNullable();
      t.bigInteger('deleted_at').nullable();
      t.bigInteger('server_seq').notNullable().defaultTo(0);
      t.index(['parent_id', 'updated_at'], 'children_parent_updated_idx');
      t.index(['parent_id', 'server_seq'], 'children_parent_seq_idx');
    }))
    .createTable('settings', table((t) => {
      t.string('parent_id', ID).primary();
      t.text('settings_json', 'longtext').notNullable();
      t.bigInteger('updated_at').notNullable();
    }))
    .createTable('documents', table((t) => {
      t.string('id', ID).primary();
      t.string('parent_id', ID).notNullable();
      t.string('title', 255).notNullable();
      t.string('kind', 16).notNullable();
      t.string('source_hash', HASH).notNullable();
      t.integer('page_count').notNullable();
      t.string('status', 16).notNullable();
      t.text('child_ids_json', 'longtext').notNullable();
      t.bigInteger('created_at').notNullable();
      t.bigInteger('updated_at').notNullable();
      t.bigInteger('deleted_at').nullable();
      t.bigInteger('server_seq').notNullable().defaultTo(0);
      t.index(['parent_id', 'updated_at'], 'documents_parent_updated_idx');
      t.index(['parent_id', 'server_seq'], 'documents_parent_seq_idx');
    }))
    .createTable('document_pages', table((t) => {
      t.string('document_id', ID).notNullable();
      t.integer('page_index').notNullable();
      t.string('parent_id', ID).notNullable();
      t.string('status', 20).notNullable();
      t.string('text_source', 20).nullable();
      t.text('blocks_json', 'longtext').notNullable();
      t.double('confidence').nullable();
      t.string('content_hash', HASH).nullable();
      t.integer('width').nullable();
      t.integer('height').nullable();
      t.text('warnings_json', 'longtext').notNullable();
      t.bigInteger('updated_at').notNullable();
      t.bigInteger('server_seq').notNullable().defaultTo(0);
      t.primary(['document_id', 'page_index']);
      t.index(['parent_id', 'updated_at'], 'document_pages_parent_updated_idx');
      t.index(['parent_id', 'server_seq'], 'document_pages_parent_seq_idx');
    }))
    .createTable('document_files', table((t) => {
      t.string('document_id', ID).notNullable();
      t.integer('file_index').notNullable();
      t.string('parent_id', ID).notNullable();
      t.string('name', 255).notNullable();
      t.string('mime', 100).notNullable();
      t.bigInteger('size').notNullable();
      t.string('sha256', HASH).notNullable();
      t.string('storage_path', 512).notNullable();
      t.bigInteger('created_at').notNullable();
      t.primary(['document_id', 'file_index']);
      t.index(['parent_id'], 'document_files_parent_idx');
    }))
    .createTable('document_page_images', table((t) => {
      t.string('document_id', ID).notNullable();
      t.integer('page_index').notNullable();
      t.string('parent_id', ID).notNullable();
      t.string('mime', 100).notNullable();
      t.bigInteger('size').notNullable();
      t.string('sha256', HASH).notNullable();
      t.string('storage_path', 512).notNullable();
      t.bigInteger('updated_at').notNullable();
      t.primary(['document_id', 'page_index']);
      t.index(['parent_id'], 'document_page_images_parent_idx');
    }))
    .createTable('ocr_results', table((t) => {
      t.string('id', ID).primary();
      t.string('parent_id', ID).notNullable();
      t.string('document_id', ID).notNullable();
      t.integer('page_index').notNullable();
      t.string('engine', 32).notNullable();
      t.double('confidence').nullable();
      t.double('quality_score').nullable();
      t.integer('word_count').notNullable();
      t.double('low_confidence_ratio').nullable();
      t.integer('duration_ms').notNullable();
      t.bigInteger('created_at').notNullable();
      t.index(['parent_id', 'document_id'], 'ocr_results_parent_document_idx');
    }))
    .createTable('annotations', table((t) => {
      t.string('id', ID).primary();
      t.string('parent_id', ID).notNullable();
      t.string('child_id', ID).notNullable();
      t.string('document_id', ID).nullable();
      t.string('type', 16).notNullable();
      t.text('data_json', 'longtext').notNullable();
      t.bigInteger('created_at').notNullable();
      t.bigInteger('updated_at').notNullable();
      t.bigInteger('deleted_at').nullable();
      t.bigInteger('server_seq').notNullable().defaultTo(0);
      t.index(['parent_id', 'updated_at'], 'annotations_parent_updated_idx');
      t.index(['parent_id', 'server_seq'], 'annotations_parent_seq_idx');
    }))
    .createTable('reading_progress', table((t) => {
      t.string('child_id', ID).notNullable();
      t.string('document_id', ID).notNullable();
      t.string('parent_id', ID).notNullable();
      t.integer('page_index').notNullable();
      t.integer('block_index').notNullable();
      t.integer('sentence_index').notNullable();
      t.bigInteger('updated_at').notNullable();
      t.bigInteger('server_seq').notNullable().defaultTo(0);
      t.primary(['child_id', 'document_id']);
      t.index(['parent_id', 'updated_at'], 'reading_progress_parent_updated_idx');
      t.index(['parent_id', 'server_seq'], 'reading_progress_parent_seq_idx');
    }))
    .createTable('reading_sessions', table((t) => {
      t.string('id', ID).primary();
      t.string('parent_id', ID).notNullable();
      t.string('child_id', ID).notNullable();
      t.string('document_id', ID).notNullable();
      t.bigInteger('started_at').notNullable();
      t.bigInteger('ended_at').notNullable();
      t.text('data_json', 'longtext').notNullable();
      t.bigInteger('updated_at').notNullable();
      t.bigInteger('server_seq').notNullable().defaultTo(0);
      t.index(['parent_id', 'updated_at'], 'reading_sessions_parent_updated_idx');
      t.index(['parent_id', 'server_seq'], 'reading_sessions_parent_seq_idx');
    }))
    .createTable('ai_requests', table((t) => {
      t.string('id', ID).primary();
      t.string('parent_id', ID).notNullable();
      t.string('child_id', ID).nullable();
      t.string('document_id', ID).nullable();
      t.string('operation', 32).notNullable();
      t.string('route', 16).notNullable();
      t.string('provider', 16).notNullable();
      t.string('model', 100).notNullable();
      t.string('prompt_version', 32).notNullable();
      t.boolean('cache_hit').notNullable();
      t.string('status', 32).notNullable();
      t.string('rejection_reason', 64).nullable();
      t.text('rejection_detail').nullable();
      t.integer('input_chars').notNullable();
      t.integer('input_tokens').nullable();
      t.integer('output_tokens').nullable();
      t.integer('duration_ms').notNullable();
      t.bigInteger('cost_micros').nullable();
      t.boolean('readability_warning').notNullable().defaultTo(false);
      t.bigInteger('created_at').notNullable();
      t.index(['parent_id', 'created_at'], 'ai_requests_parent_created_idx');
      t.index(['child_id', 'created_at'], 'ai_requests_child_created_idx');
    }))
    .createTable('ai_cache', table((t) => {
      t.string('id', ID).primary();
      t.string('cache_key', HASH).notNullable().unique();
      t.string('document_hash', HASH).nullable();
      t.string('content_hash', HASH).nullable();
      t.string('operation', 32).notNullable();
      t.string('provider', 16).notNullable();
      t.string('model', 100).notNullable();
      t.string('prompt_version', 32).notNullable();
      t.string('input_hash', HASH).notNullable();
      t.text('output_json', 'longtext').notNullable();
      t.string('validation_status', 32).notNullable();
      t.bigInteger('created_at').notNullable();
      t.bigInteger('expires_at').nullable();
    }))
    .createTable('safety_alerts', table((t) => {
      t.string('id', ID).primary();
      t.string('parent_id', ID).notNullable();
      t.string('child_id', ID).nullable();
      t.string('document_id', ID).nullable();
      t.string('kind', 32).notNullable();
      t.text('detail').notNullable();
      t.bigInteger('created_at').notNullable();
      t.bigInteger('seen_at').nullable();
      t.index(['parent_id', 'created_at'], 'safety_alerts_parent_created_idx');
    }))
    .createTable('ai_jobs', table((t) => {
      t.string('id', ID).primary();
      t.string('parent_id', ID).notNullable();
      t.string('child_id', ID).nullable();
      t.string('operation', 32).notNullable();
      t.string('status', 16).notNullable(); // pending | done | error
      t.text('result_json', 'longtext').nullable();
      t.bigInteger('created_at').notNullable();
      t.bigInteger('updated_at').notNullable();
      t.bigInteger('expires_at').notNullable();
      t.index(['parent_id', 'created_at'], 'ai_jobs_parent_created_idx');
      t.index(['expires_at'], 'ai_jobs_expires_at_idx');
    }))
    .createTable('exercises', table((t) => {
      t.string('id', ID).primary();
      t.string('parent_id', ID).notNullable();
      t.string('child_id', ID).notNullable();
      t.string('document_id', ID).notNullable();
      t.text('data_json', 'longtext').notNullable();
      t.bigInteger('created_at').notNullable();
      t.bigInteger('updated_at').notNullable();
      t.bigInteger('deleted_at').nullable();
      t.bigInteger('server_seq').notNullable().defaultTo(0);
      t.index(['parent_id', 'updated_at'], 'exercises_parent_updated_idx');
      t.index(['parent_id', 'server_seq'], 'exercises_parent_seq_idx');
    }))
    .createTable('answers', table((t) => {
      t.string('id', ID).primary();
      t.string('parent_id', ID).notNullable();
      t.string('child_id', ID).notNullable();
      t.string('exercise_id', ID).notNullable();
      t.string('question_id', 64).notNullable();
      t.text('data_json', 'longtext').notNullable();
      t.string('verdict', 16).nullable();
      t.bigInteger('created_at').notNullable();
      t.bigInteger('updated_at').notNullable();
      t.bigInteger('server_seq').notNullable().defaultTo(0);
      t.index(['parent_id', 'updated_at'], 'answers_parent_updated_idx');
      t.index(['parent_id', 'server_seq'], 'answers_parent_seq_idx');
    }))
    .createTable('dictionary_cache', table((t) => {
      t.string('word', 100).primary();
      t.text('result_json', 'longtext').notNullable();
      t.bigInteger('fetched_at').notNullable();
    }))
    .createTable('glossary_entries', table((t) => {
      t.string('parent_id', ID).notNullable();
      t.string('headword', 100).notNullable();
      t.text('entry_json', 'longtext').notNullable();
      t.bigInteger('updated_at').notNullable();
      t.primary(['parent_id', 'headword']);
    }))
    .createTable('sync_counters', table((t) => {
      t.string('parent_id', ID).primary();
      t.bigInteger('seq').notNullable().defaultTo(0);
    }));
}

export const INITIAL_TABLES = [
  'users', 'sessions', 'children', 'settings', 'documents', 'document_pages', 'document_files', 'document_page_images',
  'ocr_results', 'annotations', 'reading_progress', 'reading_sessions', 'ai_requests', 'ai_cache', 'safety_alerts', 'ai_jobs',
  'exercises', 'answers', 'dictionary_cache', 'glossary_entries', 'sync_counters',
] as const;

/** Tables synchronized through /api/sync (§15.2): each has `parent_id` and `server_seq`. */
export const SYNC_SEQ_TABLES = [
  'children', 'documents', 'document_pages', 'annotations', 'reading_progress', 'reading_sessions', 'exercises', 'answers',
] as const;

export async function up(knex: Knex): Promise<void> {
  await buildInitialSchema(knex.schema, dialectOf(knex));
}

export async function down(knex: Knex): Promise<void> {
  for (const table of [...INITIAL_TABLES].reverse()) {
    await knex.schema.dropTableIfExists(table);
  }
}
