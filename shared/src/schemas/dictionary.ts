import { z } from 'zod';
import { LIMITS } from '../constants';

export const GlossaryEntrySchema = z.object({
  headword: z.string().trim().min(1).max(LIMITS.wordMaxChars),
  partOfSpeech: z.enum(['nom', 'verbe', 'adjectif', 'adverbe', 'expression', 'autre']),
  kidDefinition: z.string().trim().min(1).max(500),
  example: z.string().max(500).nullable(),
  forms: z.array(z.string().min(1).max(LIMITS.wordMaxChars)).max(50).optional(),
});

export const DictionaryResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('found'),
    entry: z.object({
      headword: z.string(),
      lemma: z.string(),
      partOfSpeech: z.string().nullable(),
      definition: z.string(),
      example: z.string().nullable(),
      source: z.enum(['glossaire', 'glossaire_parent', 'wiktionnaire']),
      attribution: z.string().nullable(),
      kidFriendly: z.boolean(),
    }),
  }),
  z.object({ status: z.literal('not_found') }),
  z.object({ status: z.literal('unavailable') }),
]);
