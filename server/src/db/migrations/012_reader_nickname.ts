import type { Knex } from 'knex';

// §32 A reader is a nickname, and nothing else.
//
// `first_name` becomes `nickname`, and `age` goes. A reading app does not need to know who a child is in order to
// help them read: what it does not hold cannot leak, cannot be asked for, and cannot be sent anywhere. The age was
// not idle either — it travelled to the AI provider in every prompt (« Profil de l'enfant : 10 ans »), for a
// sentence length the app already decides from the explanation difficulty.
//
// Nothing is lost that the family cannot type back: whatever was in `first_name` becomes the nickname as it stands,
// and a parent who had written a real first name can change it to something else in the reader's settings.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('children', (t) => {
    t.renameColumn('first_name', 'nickname');
  });
  await knex.schema.alterTable('children', (t) => {
    t.dropColumn('age');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('children', (t) => {
    t.renameColumn('nickname', 'first_name');
  });
  await knex.schema.alterTable('children', (t) => {
    // The age it had is gone for good; a plausible one keeps the old column not null.
    t.integer('age').notNullable().defaultTo(10);
  });
}
