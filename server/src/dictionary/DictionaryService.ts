import {
  kidifyDefinition,
  lemmaCandidates,
  LIMITS,
  lookupGlossary,
  type DictionaryResult,
  type GlossaryEntry,
} from '@aide/shared';
import type { AppDeps } from '../types';
import { loadParentGlossary, readDictionaryCache, writeDictionaryCache, type CachedLookup, type CacheRow } from './store';
import { WiktionaryClient, wiktionaryPageUrl, type WiktionaryFetcher } from './WiktionaryClient';
import { analyzeWikitext, chooseEntry, type DefinitionCandidate, type WikitextAnalysis } from './wikitext';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DICTIONARY_POSITIVE_TTL_MS = 90 * DAY_MS;
export const DICTIONARY_NEGATIVE_TTL_MS = 7 * DAY_MS;
/** Pages tried for one word (the word itself, then lemma candidates). */
export const WIKTIONARY_MAX_CANDIDATES = 4;
/** No new Wiktionnaire request is started after this delay (the client gives up after 15 s). */
export const WIKTIONARY_LOOKUP_BUDGET_MS = 10_000;
export const WIKTIONNAIRE_ATTRIBUTION_PREFIX = 'Wiktionnaire (CC BY-SA 4.0)';

export interface DictionaryService {
  lookup(parentId: string, word: string): Promise<DictionaryResult>;
}

export interface DictionaryServiceOptions {
  wiktionary?: WiktionaryFetcher;
  /** Defaults to process.env (WIKIMEDIA_CONTACT). */
  env?: Readonly<Record<string, string | undefined>>;
}

type RemoteOutcome =
  | { kind: 'found'; record: Extract<CachedLookup, { status: 'found' }>; cacheable: boolean }
  | { kind: 'not_found' }
  | { kind: 'unavailable' };

const NOT_FOUND: DictionaryResult = { status: 'not_found' };
const UNAVAILABLE: DictionaryResult = { status: 'unavailable' };
const INVALID_TITLE_CHARS = /[#<>[\]{}|\n\r\t]/;

/** NFC, trimmed, surrounding punctuation removed, typographic apostrophe (Wiktionnaire titles use ’). */
export function normalizeLookupWord(word: string): string {
  return word
    .normalize('NFC')
    .replace(/^[\s"«»“”‘'’()[\]{}.,;:!?…—–-]+/u, '')
    .replace(/[\s"«»“”()[\]{}.,;:!?…—–-]+$/u, '')
    .replace(/'/g, '’');
}

export function wiktionnaireAttribution(pageTitle: string): string {
  return `${WIKTIONNAIRE_ATTRIBUTION_PREFIX} — ${wiktionaryPageUrl(pageTitle)}`;
}

function isUsableTitle(title: string): boolean {
  return title.length > 0 && title.length <= LIMITS.wordMaxChars && /\p{L}/u.test(title) && !INVALID_TITLE_CHARS.test(title);
}

function candidateTitles(word: string): string[] {
  let extra: string[] = [];
  try {
    extra = lemmaCandidates(word);
  } catch {
    extra = [];
  }
  const unique = [...new Set([word, ...extra.map((c) => normalizeLookupWord(c).toLowerCase())])];
  return unique.filter(isUsableTitle).slice(0, WIKTIONARY_MAX_CANDIDATES);
}

function pickDefinition(analysis: WikitextAnalysis, preferredPosCode: string): DefinitionCandidate | null {
  return analysis.definitions.find((d) => d.posCode === preferredPosCode) ?? analysis.definitions[0] ?? null;
}

function fromGlossary(word: string, match: { entry: GlossaryEntry; source: 'glossaire' | 'glossaire_parent' }): DictionaryResult {
  return {
    status: 'found',
    entry: {
      headword: word.toLowerCase(),
      lemma: match.entry.headword,
      partOfSpeech: match.entry.partOfSpeech,
      definition: match.entry.kidDefinition,
      example: match.entry.example,
      source: match.source,
      attribution: null,
      kidFriendly: true,
    },
  };
}

function fromCache(record: CachedLookup): DictionaryResult {
  if (record.status === 'not_found') return NOT_FOUND;
  let text = record.definition;
  let kidFriendly = false;
  try {
    const kid = kidifyDefinition(record.definition, LIMITS.kidDefinitionMaxWords);
    if (kid.text.trim().length > 0) text = kid.text;
    kidFriendly = kid.kidFriendly;
  } catch {
    kidFriendly = false;
  }
  return {
    status: 'found',
    entry: {
      headword: record.headword,
      lemma: record.lemma,
      partOfSpeech: record.partOfSpeech,
      definition: text,
      // Wiktionnaire citations are literary and unfiltered: no example is shown to the child.
      example: null,
      source: 'wiktionnaire',
      attribution: wiktionnaireAttribution(record.pageTitle),
      kidFriendly,
    },
  };
}

/**
 * « 📖 Définition » without AI: parent glossary → built-in glossary → dictionary_cache → Wiktionnaire.
 * Never throws: failures become `unavailable`.
 */
export function createDictionaryService(deps: AppDeps, options: DictionaryServiceOptions = {}): DictionaryService {
  const { db, config, logger, now } = deps;
  const env = options.env ?? process.env;
  const wiktionary = options.wiktionary ?? new WiktionaryClient({ contact: env['WIKIMEDIA_CONTACT'] ?? null });
  const inflight = new Map<string, Promise<DictionaryResult>>();

  async function queryWiktionary(word: string): Promise<RemoteOutcome> {
    const startedAt = now();
    const overBudget = (): boolean => now() - startedAt > WIKTIONARY_LOOKUP_BUDGET_MS;

    for (const title of candidateTitles(word)) {
      if (overBudget()) return { kind: 'unavailable' };
      const page = await wiktionary.fetchPage(title);
      if (page.status === 'missing') continue;
      if (page.status === 'error') return { kind: 'unavailable' };

      const choice = chooseEntry(analyzeWikitext(page.wikitext));
      if (!choice) continue;
      if (choice.kind === 'definition') {
        return {
          kind: 'found',
          cacheable: true,
          record: { v: 1, status: 'found', headword: word, lemma: page.title, partOfSpeech: choice.partOfSpeech, definition: choice.definition, pageTitle: page.title },
        };
      }

      // Inflected form: follow the lemma once.
      const fallback: Extract<CachedLookup, { status: 'found' }> | null = choice.description
        ? { v: 1, status: 'found', headword: word, lemma: choice.lemma, partOfSpeech: choice.partOfSpeech, definition: choice.description, pageTitle: page.title }
        : null;
      if (!isUsableTitle(choice.lemma)) {
        if (fallback) return { kind: 'found', record: fallback, cacheable: true };
        continue;
      }
      if (overBudget()) return fallback ? { kind: 'found', record: fallback, cacheable: false } : { kind: 'unavailable' };
      const lemmaPage = await wiktionary.fetchPage(choice.lemma);
      if (lemmaPage.status === 'error') {
        return fallback ? { kind: 'found', record: fallback, cacheable: false } : { kind: 'unavailable' };
      }
      if (lemmaPage.status === 'found') {
        const definition = pickDefinition(analyzeWikitext(lemmaPage.wikitext), choice.posCode);
        if (definition) {
          return {
            kind: 'found',
            cacheable: true,
            record: {
              v: 1, status: 'found', headword: word, lemma: lemmaPage.title,
              partOfSpeech: definition.partOfSpeech, definition: definition.definition, pageTitle: lemmaPage.title,
            },
          };
        }
      }
      if (fallback) return { kind: 'found', record: fallback, cacheable: true };
    }
    return { kind: 'not_found' };
  }

  async function lookupRemote(key: string): Promise<DictionaryResult> {
    let cached: CacheRow | null = null;
    try {
      cached = await readDictionaryCache(db, key);
    } catch (error) {
      logger.warn('dictionary_cache_read_failed', { error });
    }
    if (cached) {
      const ttl = cached.record.status === 'found' ? DICTIONARY_POSITIVE_TTL_MS : DICTIONARY_NEGATIVE_TTL_MS;
      if (now() - cached.fetchedAt < ttl) return fromCache(cached.record);
    }
    const stalePositive = cached?.record.status === 'found' ? cached.record : null;
    if (!config.wiktionaryEnabled) return stalePositive ? fromCache(stalePositive) : NOT_FOUND;

    const outcome = await queryWiktionary(key);
    if (outcome.kind === 'unavailable') {
      logger.info('dictionary_wiktionary_unavailable');
      return stalePositive ? fromCache(stalePositive) : UNAVAILABLE;
    }
    const record: CachedLookup = outcome.kind === 'found' ? outcome.record : { v: 1, status: 'not_found' };
    if (outcome.kind === 'not_found' || outcome.cacheable) {
      try {
        await writeDictionaryCache(db, key, record, now());
      } catch (error) {
        logger.warn('dictionary_cache_write_failed', { error });
      }
    }
    return fromCache(record);
  }

  async function lookup(parentId: string, word: string): Promise<DictionaryResult> {
    const normalized = normalizeLookupWord(word);
    if (!normalized || normalized.length > LIMITS.wordMaxChars || !/\p{L}/u.test(normalized)) return NOT_FOUND;

    let custom: GlossaryEntry[] = [];
    try {
      custom = await loadParentGlossary(db, parentId);
    } catch (error) {
      logger.warn('dictionary_glossary_read_failed', { error });
    }
    let match: ReturnType<typeof lookupGlossary> = null;
    try {
      match = lookupGlossary(normalized, custom);
    } catch (error) {
      logger.warn('dictionary_glossary_lookup_failed', { error });
    }
    if (match) return fromGlossary(normalized, match);

    const key = normalized.toLowerCase();
    const pending = inflight.get(key);
    if (pending) return pending;
    const task = lookupRemote(key).finally(() => inflight.delete(key));
    inflight.set(key, task);
    return task;
  }

  return {
    async lookup(parentId, word) {
      try {
        return await lookup(parentId, word);
      } catch (error) {
        logger.error('dictionary_lookup_failed', { error });
        return UNAVAILABLE;
      }
    },
  };
}
