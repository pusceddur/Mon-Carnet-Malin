import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { GlossaryEntry } from '@aide/shared';
import { kidifyDefinition, lemmaCandidates, lookupGlossary } from '@aide/shared';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config';
import { createDb, runMigrations } from '../../src/db/knex';
import {
  createDictionaryService,
  DICTIONARY_NEGATIVE_TTL_MS,
  DICTIONARY_POSITIVE_TTL_MS,
  normalizeLookupWord,
} from '../../src/dictionary/DictionaryService';
import type { WiktionaryFetcher, WiktionaryPageResult } from '../../src/dictionary/WiktionaryClient';
import { silentLogger } from '../../src/logger';
import type { AppDeps } from '../../src/types';

// shared-core functions are developed in parallel: the service is tested against their contract.
vi.mock('@aide/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aide/shared')>();
  return {
    ...actual,
    lemmaCandidates: vi.fn((word: string) => [word.toLowerCase()]),
    lookupGlossary: vi.fn(() => null),
    kidifyDefinition: vi.fn((raw: string) => ({ text: raw.trim(), kidFriendly: true })),
  };
});

const BUILTIN: GlossaryEntry = {
  headword: 'photosynthèse',
  partOfSpeech: 'nom',
  kidDefinition: 'Façon dont les plantes fabriquent leur nourriture avec la lumière.',
  example: 'Grâce à la photosynthèse, la plante grandit.',
};

function glossaryContract(word: string, custom?: readonly GlossaryEntry[]): ReturnType<typeof lookupGlossary> {
  const w = word.toLowerCase();
  const own = custom?.find((e) => e.headword === w || e.forms?.includes(w));
  if (own) return { entry: own, source: 'glossaire_parent', lemma: own.headword };
  if (w === BUILTIN.headword) return { entry: BUILTIN, source: 'glossaire', lemma: w };
  return null;
}

const fixture = (name: string): string => readFileSync(fileURLToPath(new URL(`./fixtures/${name}.wikitext`, import.meta.url)), 'utf8');

const FIXTURE_PAGES: Record<string, string> = {
  cheval: 'cheval',
  chevaux: 'chevaux',
  belles: 'belles',
  beau: 'beau',
  manger: 'manger',
  hello: 'hello',
  clef: 'clef',
  clé: 'cle',
};

class FakeWiktionary implements WiktionaryFetcher {
  calls: string[] = [];
  failWith: WiktionaryPageResult | null = null;
  extraPages: Record<string, string> = {};
  delayMs = 0;

  async fetchPage(title: string): Promise<WiktionaryPageResult> {
    this.calls.push(title);
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failWith) return this.failWith;
    const inline = this.extraPages[title];
    if (inline !== undefined) return { status: 'found', title, wikitext: inline };
    const file = FIXTURE_PAGES[title];
    return file ? { status: 'found', title, wikitext: fixture(file) } : { status: 'missing' };
  }
}

describe('DictionaryService', () => {
  let db: Knex;
  let clock: number;
  let wiktionary: FakeWiktionary;
  let wiktionaryEnabled: boolean;

  const deps = (): AppDeps => ({
    config: { ...loadConfig({ NODE_ENV: 'test' }), wiktionaryEnabled },
    db,
    logger: silentLogger,
    now: () => clock,
  });
  const service = () => createDictionaryService(deps(), { wiktionary, env: {} });

  beforeAll(async () => {
    db = createDb('sqlite::memory:');
    await runMigrations(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db('dictionary_cache').del();
    await db('glossary_entries').del();
    clock = 1_800_000_000_000;
    wiktionary = new FakeWiktionary();
    wiktionaryEnabled = true;
    vi.mocked(lookupGlossary).mockImplementation(glossaryContract);
    vi.mocked(lemmaCandidates).mockImplementation((word: string) => [word.toLowerCase()]);
    vi.mocked(kidifyDefinition).mockImplementation((raw: string) => ({ text: raw.trim(), kidFriendly: true }));
  });

  async function addParentEntry(parentId: string, entry: GlossaryEntry): Promise<void> {
    await db('glossary_entries').insert({ parent_id: parentId, headword: entry.headword, entry_json: JSON.stringify(entry), updated_at: clock });
  }

  it('answers from the parent glossary first, isolated per family, without network', async () => {
    const own: GlossaryEntry = { headword: 'cheval', partOfSpeech: 'nom', kidDefinition: 'Le grand animal de notre ferme.', example: null };
    await addParentEntry('parent-1', own);
    await db('glossary_entries').insert({ parent_id: 'parent-1', headword: 'casse', entry_json: '{pas du json', updated_at: clock });

    const result = await service().lookup('parent-1', 'Cheval');
    expect(result).toEqual({
      status: 'found',
      entry: {
        headword: 'cheval',
        lemma: 'cheval',
        partOfSpeech: 'nom',
        definition: 'Le grand animal de notre ferme.',
        example: null,
        source: 'glossaire_parent',
        attribution: null,
        kidFriendly: true,
      },
    });
    expect(wiktionary.calls).toEqual([]);
    expect(vi.mocked(lookupGlossary).mock.calls[0]?.[1]).toEqual([own]);

    const other = await service().lookup('parent-2', 'cheval');
    expect(other.status === 'found' && other.entry.source).toBe('wiktionnaire');
  });

  it('answers from the built-in glossary before any cache or network', async () => {
    const result = await service().lookup('parent-1', 'photosynthèse');
    expect(result).toMatchObject({ status: 'found', entry: { source: 'glossaire', lemma: 'photosynthèse', kidFriendly: true, attribution: null } });
    expect(wiktionary.calls).toEqual([]);
  });

  it('builds a Wiktionnaire entry with attribution, kidified definition and no example', async () => {
    vi.mocked(kidifyDefinition).mockImplementation((raw: string) => ({ text: `${raw.split(',')[0]}.`, kidFriendly: false }));
    const result = await service().lookup('parent-1', 'cheval');
    expect(result).toEqual({
      status: 'found',
      entry: {
        headword: 'cheval',
        lemma: 'cheval',
        partOfSpeech: 'nom',
        definition: 'Grand mammifère herbivore de la famille des équidés.',
        example: null,
        source: 'wiktionnaire',
        attribution: 'Wiktionnaire (CC BY-SA 4.0) — https://fr.wiktionary.org/wiki/cheval',
        kidFriendly: false,
      },
    });
    const row = await db('dictionary_cache').where({ word: 'cheval' }).first();
    expect(row?.fetched_at).toBe(clock);
  });

  it('follows an inflected form to its lemma (one hop) and credits the lemma page', async () => {
    const result = await service().lookup('parent-1', 'chevaux');
    expect(wiktionary.calls).toEqual(['chevaux', 'cheval']);
    expect(result).toMatchObject({
      status: 'found',
      entry: {
        headword: 'chevaux',
        lemma: 'cheval',
        partOfSpeech: 'nom',
        definition: 'Grand mammifère herbivore de la famille des équidés, domestiqué et employé comme monture ou comme bête de trait.',
        attribution: 'Wiktionnaire (CC BY-SA 4.0) — https://fr.wiktionary.org/wiki/cheval',
      },
    });
  });

  it('keeps the part of speech of the inflected form on the lemma page', async () => {
    const result = await service().lookup('parent-1', 'belles');
    expect(result).toMatchObject({
      status: 'found',
      entry: { lemma: 'beau', partOfSpeech: 'adjectif', definition: 'Qui fait naître un sentiment d’admiration par sa forme, ses couleurs ou sa grâce.' },
    });
  });

  it('follows spelling variants', async () => {
    const result = await service().lookup('parent-1', 'clef');
    expect(result).toMatchObject({ status: 'found', entry: { headword: 'clef', lemma: 'clé' } });
    expect(wiktionary.calls).toEqual(['clef', 'clé']);
  });

  it('never makes more than one hop', async () => {
    wiktionary.extraPages = {
      forme: "== {{langue|fr}} ==\n=== {{S|nom|fr|flexion}} ===\n# ''Pluriel de'' [[intermediaire]].",
      intermediaire: "== {{langue|fr}} ==\n=== {{S|nom|fr|flexion}} ===\n# ''Pluriel de'' [[final]].",
      final: '== {{langue|fr}} ==\n=== {{S|nom|fr}} ===\n# Jamais atteint.',
    };
    const result = await service().lookup('parent-1', 'forme');
    expect(wiktionary.calls).toEqual(['forme', 'intermediaire']);
    expect(result).toMatchObject({ status: 'found', entry: { lemma: 'intermediaire', definition: 'Pluriel de intermediaire.' } });
  });

  it('tries lemma candidates when the word itself has no page', async () => {
    vi.mocked(lemmaCandidates).mockImplementation((word: string) => [word.toLowerCase(), 'manger']);
    const result = await service().lookup('parent-1', 'mangeassions');
    expect(wiktionary.calls).toEqual(['mangeassions', 'manger']);
    expect(result).toMatchObject({ status: 'found', entry: { headword: 'mangeassions', lemma: 'manger', partOfSpeech: 'verbe' } });
  });

  it('caches positive results for 90 days', async () => {
    await service().lookup('parent-1', 'cheval');
    clock += DICTIONARY_POSITIVE_TTL_MS - 1;
    const cached = await service().lookup('parent-1', 'cheval');
    expect(cached.status).toBe('found');
    expect(wiktionary.calls).toEqual(['cheval']);

    clock += 2;
    await service().lookup('parent-1', 'cheval');
    expect(wiktionary.calls).toEqual(['cheval', 'cheval']);
  });

  it('caches not_found for 7 days (non-existent word)', async () => {
    expect(await service().lookup('parent-1', 'zzkwxq')).toEqual({ status: 'not_found' });
    clock += DICTIONARY_NEGATIVE_TTL_MS - 1;
    expect(await service().lookup('parent-1', 'zzkwxq')).toEqual({ status: 'not_found' });
    expect(wiktionary.calls).toEqual(['zzkwxq']);
    clock += 2;
    await service().lookup('parent-1', 'zzkwxq');
    expect(wiktionary.calls).toEqual(['zzkwxq', 'zzkwxq']);
  });

  it('treats a page without French section as not found', async () => {
    expect(await service().lookup('parent-1', 'hello')).toEqual({ status: 'not_found' });
  });

  it('returns unavailable on network errors without caching them', async () => {
    wiktionary.failWith = { status: 'error', reason: 'timeout' };
    expect(await service().lookup('parent-1', 'cheval')).toEqual({ status: 'unavailable' });
    expect(await db('dictionary_cache').count({ n: '*' }).first()).toMatchObject({ n: 0 });
    wiktionary.failWith = null;
    expect((await service().lookup('parent-1', 'cheval')).status).toBe('found');
  });

  it('serves an expired positive entry when Wiktionnaire is unreachable', async () => {
    await service().lookup('parent-1', 'cheval');
    clock += DICTIONARY_POSITIVE_TTL_MS + 1;
    wiktionary.failWith = { status: 'error', reason: 'network' };
    expect(await service().lookup('parent-1', 'cheval')).toMatchObject({ status: 'found', entry: { lemma: 'cheval' } });
  });

  it('keeps the inflection text (not cached) when the lemma page cannot be fetched', async () => {
    const original = wiktionary.fetchPage.bind(wiktionary);
    wiktionary.fetchPage = async (title) => (title === 'cheval' ? { status: 'error', reason: 'network' } : original(title));
    expect(await service().lookup('parent-1', 'chevaux')).toMatchObject({ status: 'found', entry: { lemma: 'cheval', definition: 'Pluriel de cheval.' } });
    expect(await db('dictionary_cache').where({ word: 'chevaux' }).first()).toBeUndefined();
  });

  it('does not call Wiktionnaire when disabled', async () => {
    wiktionaryEnabled = false;
    expect(await service().lookup('parent-1', 'cheval')).toEqual({ status: 'not_found' });
    expect(wiktionary.calls).toEqual([]);
  });

  it('shares one request between concurrent lookups of the same word', async () => {
    wiktionary.delayMs = 20;
    const s = service();
    const [a, b] = await Promise.all([s.lookup('parent-1', 'cheval'), s.lookup('parent-2', 'Cheval')]);
    expect(a).toEqual(b);
    expect(wiktionary.calls).toEqual(['cheval']);
  });

  it('never throws', async () => {
    vi.mocked(lookupGlossary).mockImplementation(() => {
      throw new Error('boom');
    });
    wiktionary.fetchPage = async () => {
      throw new Error('boom');
    };
    await expect(service().lookup('parent-1', 'cheval')).resolves.toEqual({ status: 'unavailable' });
  });

  it('rejects empty or letterless input as not found', async () => {
    expect(await service().lookup('parent-1', '  « »  ')).toEqual({ status: 'not_found' });
    expect(await service().lookup('parent-1', '1234')).toEqual({ status: 'not_found' });
    expect(wiktionary.calls).toEqual([]);
  });

  it('normalizes the word', () => {
    expect(normalizeLookupWord('« Cheval ! »')).toBe('Cheval');
    expect(normalizeLookupWord("aujourd'hui")).toBe('aujourd’hui');
    expect(normalizeLookupWord('l’')).toBe('l’');
    expect(normalizeLookupWord('été')).toBe('été');
  });
});
