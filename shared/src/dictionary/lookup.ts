import { lemmaCandidateTiers } from '../text/lemma';
import { normalizeForMatch } from '../text/normalize';
import type { GlossaryEntry } from '../types/dictionary';
import { GLOSSARY_FR } from './glossary.fr';

interface GlossaryIndex {
  headwords: Map<string, GlossaryEntry>;
  forms: Map<string, GlossaryEntry>;
  looseHeadwords: Map<string, GlossaryEntry>;
  looseForms: Map<string, GlossaryEntry>;
}

function lowerKey(word: string): string {
  return word.normalize('NFC').trim().toLowerCase().replace(/[\u2019\u02BC]/g, "'");
}

function setOnce(map: Map<string, GlossaryEntry>, key: string, entry: GlossaryEntry): void {
  if (key.length > 0 && !map.has(key)) map.set(key, entry);
}

function buildIndex(entries: readonly GlossaryEntry[]): GlossaryIndex {
  const index: GlossaryIndex = { headwords: new Map(), forms: new Map(), looseHeadwords: new Map(), looseForms: new Map() };
  for (const e of entries) {
    setOnce(index.headwords, lowerKey(e.headword), e);
    setOnce(index.looseHeadwords, normalizeForMatch(e.headword), e);
  }
  for (const e of entries) {
    for (const form of e.forms ?? []) {
      setOnce(index.forms, lowerKey(form), e);
      setOnce(index.looseForms, normalizeForMatch(form), e);
    }
  }
  return index;
}

let builtinIndex: GlossaryIndex | null = null;
let customCache: { entries: readonly GlossaryEntry[]; index: GlossaryIndex } | null = null;

function indexFor(entries: readonly GlossaryEntry[]): GlossaryIndex {
  if (entries === GLOSSARY_FR) return (builtinIndex ??= buildIndex(GLOSSARY_FR));
  if (customCache?.entries !== entries) customCache = { entries, index: buildIndex(entries) };
  return customCache.index;
}

function find(index: GlossaryIndex, candidates: readonly string[], loose: boolean): GlossaryEntry | null {
  const keys = candidates.map((c) => (loose ? normalizeForMatch(c) : lowerKey(c)));
  const headwords = loose ? index.looseHeadwords : index.headwords;
  const forms = loose ? index.looseForms : index.forms;
  for (const k of keys) {
    const hit = headwords.get(k);
    if (hit) return hit;
  }
  for (const k of keys) {
    const hit = forms.get(k);
    if (hit) return hit;
  }
  return null;
}

/**
 * Glossary entry for a tapped word. Parent entries take precedence over the built-in glossary at each step:
 * the word itself, then irregular lemmas, then suffix heuristics; headwords before inflected forms; finally the same
 * search ignoring accents when the word has none. `lemma` is the headword of the entry found.
 */
export function lookupGlossary(word: string, custom?: readonly GlossaryEntry[]): { entry: GlossaryEntry; source: 'glossaire' | 'glossaire_parent'; lemma: string } | null {
  if (word.trim().length === 0) return null;
  const tiers = lemmaCandidateTiers(word);
  const sources: { entries: readonly GlossaryEntry[]; source: 'glossaire' | 'glossaire_parent' }[] = [];
  if (custom && custom.length > 0) sources.push({ entries: custom, source: 'glossaire_parent' });
  sources.push({ entries: GLOSSARY_FR, source: 'glossaire' });

  // Accent-insensitive search only when the word has no accent at all (lost by OCR or typing): « cote » → « côte ».
  const hasDiacritics = word.normalize('NFD') !== word.normalize('NFD').replace(/\p{M}/gu, '') || /[œæ]/i.test(word);
  for (const loose of hasDiacritics ? [false] : [false, true]) {
    for (const candidates of [tiers.exact, tiers.irregular, tiers.heuristic]) {
      if (candidates.length === 0) continue;
      for (const { entries, source } of sources) {
        const hit = find(indexFor(entries), candidates, loose);
        if (hit) return { entry: hit, source, lemma: hit.headword };
      }
    }
  }
  return null;
}
