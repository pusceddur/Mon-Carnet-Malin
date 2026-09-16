// STUB: shared-core
import type { GlossaryEntry } from '../types/dictionary';
import { lemmaCandidates } from '../text/lemma';
import { GLOSSARY_FR } from './glossary.fr';

// custom (parent) entries take precedence; tries lemmaCandidates and forms
export function lookupGlossary(word: string, custom?: readonly GlossaryEntry[]): { entry: GlossaryEntry; source: 'glossaire' | 'glossaire_parent'; lemma: string } | null {
  for (const lemma of lemmaCandidates(word)) {
    const own = custom?.find((e) => e.headword === lemma);
    if (own) return { entry: own, source: 'glossaire_parent', lemma };
    const builtin = GLOSSARY_FR.find((e) => e.headword === lemma);
    if (builtin) return { entry: builtin, source: 'glossaire', lemma };
  }
  return null;
}
