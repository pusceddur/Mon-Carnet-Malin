import { describe, expect, it } from 'vitest';
import { countWords } from '../../src/ai/limits';
import { LIMITS } from '../../src/constants';
import { GLOSSARY_FR } from '../../src/dictionary/glossary.fr';
import { lookupGlossary } from '../../src/dictionary/lookup';
import { GlossaryEntrySchema } from '../../src/schemas/dictionary';
import { normalizeForMatch } from '../../src/text/normalize';
import { readabilityFr } from '../../src/text/readability';
import { tokenizeWords } from '../../src/text/tokenize';

// Words that must never appear in a child definition of the built-in glossary.
const FORBIDDEN = ['suicide', 'sexe', 'sexuel', 'drogue', 'meurtre', 'tuer', 'tué', 'pistolet', 'fusil', 'alcool', 'cadavre', 'viol'];

describe('GLOSSARY_FR', () => {
  it('has at least 250 entries that validate against the schema', () => {
    expect(GLOSSARY_FR.length).toBeGreaterThanOrEqual(250);
    for (const entry of GLOSSARY_FR) expect(GlossaryEntrySchema.safeParse(entry).success, entry.headword).toBe(true);
  });

  it('has unique lowercase headwords and forms', () => {
    const headwords = GLOSSARY_FR.map((e) => e.headword);
    expect(new Set(headwords).size).toBe(headwords.length);
    for (const e of GLOSSARY_FR) {
      expect(e.headword).toBe(e.headword.toLowerCase());
      expect(e.headword).toBe(e.headword.trim());
      for (const f of e.forms ?? []) {
        expect(f, e.headword).toBe(f.toLowerCase());
        expect(f, e.headword).not.toBe(e.headword);
      }
    }
  });

  it('never uses a form that is the headword of another entry or a form of another entry', () => {
    const headwords = new Set(GLOSSARY_FR.map((e) => e.headword));
    const owners = new Map<string, string>();
    for (const e of GLOSSARY_FR) {
      for (const f of e.forms ?? []) {
        expect(headwords.has(f), `${f} (${e.headword})`).toBe(false);
        expect(owners.get(f), `${f} (${e.headword})`).toBeUndefined();
        owners.set(f, e.headword);
      }
    }
  });

  it('keeps every definition within 30 words and every example short', () => {
    for (const e of GLOSSARY_FR) {
      expect(countWords(e.kidDefinition), e.headword).toBeLessThanOrEqual(LIMITS.kidDefinitionMaxWords);
      expect(e.example, e.headword).not.toBeNull();
      expect(countWords(e.example ?? ''), e.headword).toBeLessThanOrEqual(20);
    }
  });

  it('writes complete sentences with reasonable readability', () => {
    for (const e of GLOSSARY_FR) {
      expect(e.kidDefinition, e.headword).toMatch(/^[\p{Lu}«]/u);
      expect(e.kidDefinition, e.headword).toMatch(/[.!?»]$/);
      expect(e.example ?? '', e.headword).toMatch(/[.!?»]$/);
      const exempt = [e.headword, ...(e.forms ?? [])];
      const report = readabilityFr(e.kidDefinition, exempt);
      expect(report.maxWordsPerSentence, e.headword).toBeLessThanOrEqual(22);
      expect(report.longWordRatio, e.headword).toBeLessThanOrEqual(0.3);
    }
    const all = GLOSSARY_FR.map((e) => e.kidDefinition).join(' ');
    const overall = readabilityFr(all);
    expect(overall.avgWordsPerSentence).toBeLessThanOrEqual(15);
    expect(overall.longWordRatio).toBeLessThanOrEqual(0.12);
  });

  it('writes numbers in letters and avoids sensitive words', () => {
    for (const e of GLOSSARY_FR) {
      const text = `${e.kidDefinition} ${e.example ?? ''}`;
      expect(text, e.headword).not.toMatch(/\d/);
      const words = new Set(tokenizeWords(text).map((t) => normalizeForMatch(t.word)));
      for (const bad of FORBIDDEN) expect(words.has(normalizeForMatch(bad)), `${e.headword}: ${bad}`).toBe(false);
    }
  });

  it('does not repeat the headword alone as its own definition', () => {
    for (const e of GLOSSARY_FR) {
      expect(normalizeForMatch(e.kidDefinition), e.headword).not.toBe(normalizeForMatch(e.headword));
    }
  });

  it('finds every entry from its headword, its forms and a word of its example', () => {
    for (const e of GLOSSARY_FR) {
      expect(lookupGlossary(e.headword)?.entry.headword, e.headword).toBe(e.headword);
      for (const f of e.forms ?? []) expect(lookupGlossary(f)?.entry.headword, `${f} → ${e.headword}`).toBe(e.headword);
      const found = tokenizeWords(e.example ?? '').some((t) => lookupGlossary(t.word)?.entry.headword === e.headword);
      expect(found, `example of ${e.headword}`).toBe(true);
    }
  });

  it('covers the main school subjects', () => {
    for (const w of ['photosynthèse', 'mammifère', 'volcan', 'siècle', 'république', 'continent', 'fleuve', 'verbe', 'adjectif',
      'imparfait', 'fraction', 'périmètre', 'triangle', 'hésiter', 'soudain', 'curiosité']) {
      expect(GLOSSARY_FR.some((e) => e.headword === w), w).toBe(true);
    }
  });
});
