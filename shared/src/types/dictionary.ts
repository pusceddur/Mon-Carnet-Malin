export interface GlossaryEntry {
  headword: string;                 // lowercase base form, e.g. "photosynthèse"
  partOfSpeech: 'nom' | 'verbe' | 'adjectif' | 'adverbe' | 'expression' | 'autre';
  kidDefinition: string;            // <= 30 words, for 8-11 year olds
  example: string | null;           // simple example sentence
  forms?: string[];                 // known inflected forms
}
export type DictionaryResult =
  | { status: 'found'; entry: { headword: string; lemma: string; partOfSpeech: string | null; definition: string;
        example: string | null; source: 'glossaire' | 'glossaire_parent' | 'wiktionnaire'; attribution: string | null; kidFriendly: boolean } }
  | { status: 'not_found' }
  | { status: 'unavailable' };      // offline / network error
