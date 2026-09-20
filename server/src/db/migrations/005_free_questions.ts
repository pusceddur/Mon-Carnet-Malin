import type { Knex } from 'knex';
import { dialectOf, type SchemaDialect } from './001_initial';

// §18.3 « Pose ta question »: every free question of a child (even blocked) with its outcome, visible to the parent.
// Kept 30 days by the maintenance job, purged with a deleted child. `answer_text` only for answered questions.

export const FREE_QUESTIONS_TABLE = 'free_questions';

/** Builds the schema changes of 005 on a schema builder (also used to render MySQL DDL in tests). */
export function buildFreeQuestionsSchema(schema: Knex.SchemaBuilder, dialect: SchemaDialect): Knex.SchemaBuilder {
  return schema.createTable(FREE_QUESTIONS_TABLE, (t) => {
    // Same table options as 001 (utf8mb4 + binary collation), MySQL/MariaDB only.
    if (dialect === 'mysql') {
      t.engine('InnoDB');
      t.charset('utf8mb4');
      t.collate('utf8mb4_bin');
    }
    t.string('id', 36).primary();
    t.string('parent_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('child_id', 36).notNullable();
    t.string('question', 300).notNullable(); // LIMITS.freeQuestionMaxChars
    t.string('outcome', 16).notNullable(); // answered | blocked | adult_redirect | unavailable
    t.text('answer_text').nullable();
    t.bigInteger('created_at').notNullable();
    t.index(['parent_id', 'child_id', 'created_at'], 'free_questions_parent_child_created_idx');
    t.index(['created_at'], 'free_questions_created_at_idx');
  });
}

export async function up(knex: Knex): Promise<void> {
  await buildFreeQuestionsSchema(knex.schema, dialectOf(knex));
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists(FREE_QUESTIONS_TABLE);
}
