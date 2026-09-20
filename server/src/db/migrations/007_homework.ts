import type { Knex } from 'knex';

// §19.3 « Mes devoirs »: purpose of a document and the moment the child marked the homework done.

/** Builds the schema changes of 007 on a schema builder (also used to render MySQL DDL in tests). */
export function buildHomeworkSchema(schema: Knex.SchemaBuilder): Knex.SchemaBuilder {
  return schema.alterTable('documents', (t) => {
    t.string('purpose', 16).notNullable().defaultTo('reading'); // reading | homework
    t.bigInteger('homework_done_at').nullable();
  });
}

export async function up(knex: Knex): Promise<void> {
  await buildHomeworkSchema(knex.schema);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('documents', (t) => {
    t.dropColumn('homework_done_at');
    t.dropColumn('purpose');
  });
}
