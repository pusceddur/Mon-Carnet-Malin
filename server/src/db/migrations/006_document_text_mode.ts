import type { Knex } from 'knex';

// §17.10 « Texte écrit par un enfant »: text mode of a document. Existing documents keep the text as printed.

export const DOCUMENT_TEXT_MODE_COLUMN = 'text_mode';

/** Builds the schema changes of 006 on a schema builder (also used to render MySQL DDL in tests). */
export function buildDocumentTextModeSchema(schema: Knex.SchemaBuilder): Knex.SchemaBuilder {
  return schema.alterTable('documents', (t) => {
    t.string(DOCUMENT_TEXT_MODE_COLUMN, 16).notNullable().defaultTo('faithful'); // faithful | punctuated
  });
}

export async function up(knex: Knex): Promise<void> {
  await buildDocumentTextModeSchema(knex.schema);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('documents', (t) => {
    t.dropColumn(DOCUMENT_TEXT_MODE_COLUMN);
  });
}
