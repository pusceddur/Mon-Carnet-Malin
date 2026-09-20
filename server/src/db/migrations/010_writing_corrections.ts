import type { Knex } from 'knex';
import { dialectOf, type SchemaDialect } from './001_initial';

// §24 « Corriger »: every text corrected in a text box, with what changed, for the adult (kept one year, removed with the
// child or the account).

export const WRITING_CORRECTIONS_TABLE = 'writing_corrections';

/** Builds the schema changes of 010 on a schema builder (also used to render MySQL DDL in tests). */
export function buildWritingCorrectionsSchema(schema: Knex.SchemaBuilder, dialect: SchemaDialect): Knex.SchemaBuilder {
  return schema.createTable(WRITING_CORRECTIONS_TABLE, (t) => {
    if (dialect === 'mysql') {
      t.engine('InnoDB');
      t.charset('utf8mb4');
      t.collate('utf8mb4_bin');
    }
    t.string('id', 36).primary();
    t.string('parent_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('child_id', 36).notNullable();
    t.string('document_id', 36).nullable();
    t.string('annotation_id', 36).nullable();
    t.text('original_text').notNullable();
    t.text('corrected_text').notNullable();
    t.text('changes_json', 'mediumtext').notNullable();
    t.bigInteger('created_at').notNullable();
    t.index(['parent_id', 'child_id', 'created_at'], 'writing_corrections_child_idx');
    t.index(['created_at'], 'writing_corrections_created_at_idx');
  });
}

export async function up(knex: Knex): Promise<void> {
  await buildWritingCorrectionsSchema(knex.schema, dialectOf(knex));
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists(WRITING_CORRECTIONS_TABLE);
}
