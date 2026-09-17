import { LIMITS, type GlossaryEntry } from '@aide/shared';

export interface GlossaryFormValues {
  headword: string;
  partOfSpeech: GlossaryEntry['partOfSpeech'];
  kidDefinition: string;
  example: string;
  forms: string;
}

export type GlossaryFormErrors = Partial<Record<'headword' | 'kidDefinition' | 'example' | 'forms', 'required' | 'tooLong' | 'tooManyWords' | 'duplicate'>>;

export const PARTS_OF_SPEECH: readonly GlossaryEntry['partOfSpeech'][] = ['nom', 'verbe', 'adjectif', 'adverbe', 'expression', 'autre'];

const TEXT_MAX_CHARS = 500;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/[\s  ]+/u).length;
}

export function normalizeHeadword(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('fr-FR');
}

export function parseForms(value: string): string[] {
  const seen = new Set<string>();
  for (const part of value.split(/[,;\n]/u)) {
    const form = normalizeHeadword(part);
    if (form !== '') seen.add(form);
  }
  return Array.from(seen);
}

export function emptyGlossaryForm(): GlossaryFormValues {
  return { headword: '', partOfSpeech: 'nom', kidDefinition: '', example: '', forms: '' };
}

export function entryToForm(entry: GlossaryEntry): GlossaryFormValues {
  return {
    headword: entry.headword,
    partOfSpeech: entry.partOfSpeech,
    kidDefinition: entry.kidDefinition,
    example: entry.example ?? '',
    forms: (entry.forms ?? []).join(', '),
  };
}

/** `existing`: headwords already in the glossary; `originalHeadword`: the entry being edited (null for a new one). */
export function validateGlossaryForm(v: GlossaryFormValues, existing: readonly string[], originalHeadword: string | null): GlossaryFormErrors {
  const errors: GlossaryFormErrors = {};
  const headword = normalizeHeadword(v.headword);
  if (headword === '') errors.headword = 'required';
  else if (headword.length > LIMITS.wordMaxChars) errors.headword = 'tooLong';
  else if (headword !== originalHeadword && existing.includes(headword)) errors.headword = 'duplicate';

  const definition = v.kidDefinition.trim();
  if (definition === '') errors.kidDefinition = 'required';
  else if (definition.length > TEXT_MAX_CHARS) errors.kidDefinition = 'tooLong';
  else if (countWords(definition) > LIMITS.kidDefinitionMaxWords) errors.kidDefinition = 'tooManyWords';

  if (v.example.trim().length > TEXT_MAX_CHARS) errors.example = 'tooLong';
  const forms = parseForms(v.forms);
  if (forms.length > 50 || forms.some((f) => f.length > LIMITS.wordMaxChars)) errors.forms = 'tooLong';
  return errors;
}

export function formToGlossaryEntry(v: GlossaryFormValues): GlossaryEntry {
  const headword = normalizeHeadword(v.headword);
  const forms = parseForms(v.forms).filter((f) => f !== headword);
  const example = v.example.trim();
  return {
    headword,
    partOfSpeech: v.partOfSpeech,
    kidDefinition: v.kidDefinition.trim().replace(/\s+/gu, ' '),
    example: example === '' ? null : example,
    ...(forms.length > 0 ? { forms } : {}),
  };
}

export function filterGlossary(entries: readonly GlossaryEntry[], query: string): GlossaryEntry[] {
  const q = normalizeHeadword(query);
  const sorted = [...entries].sort((a, b) => a.headword.localeCompare(b.headword, 'fr'));
  if (q === '') return sorted;
  return sorted.filter((e) => e.headword.includes(q) || (e.forms ?? []).some((f) => f.includes(q)));
}
