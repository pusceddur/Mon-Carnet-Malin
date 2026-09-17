import { extractEntities, normalizeForMatch, normalizeNumberFr, tokenizeWords } from '@aide/shared';
import type { GuardIssue } from '../ai/validation/types';
import { truncateForLog } from '../ai/validation/types';
import { SourceIndex, type QuoteMatch, type SourceSection } from './textMatch';

export type EntityMode = 'strict' | 'lenient';

/** §15.5 lenient mode (explain_word / explain_text): numbers up to this value are allowed. */
export const LENIENT_MAX_FREE_NUMBER = 1000;

function numericValue(canonical: string): number | null {
  const value = Number(canonical.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function canonicalNumber(raw: string): string {
  return normalizeNumberFr(raw) ?? raw.replace(/[\s.  ]/g, '').replace(',', '.');
}

/** Numbers that are articles or trivial counts ("un", "une", "zéro") are never treated as invented facts. */
function isTrivialNumber(canonical: string): boolean {
  const value = numericValue(canonical);
  return value !== null && value >= 0 && value <= 1;
}

/** Precomputed entities of the source texts. */
export class EntitySource {
  readonly index: SourceIndex;
  readonly numbers = new Set<string>();
  readonly properNouns: string[] = [];
  readonly rawText: string;

  constructor(sections: readonly SourceSection[], private readonly isKnownWord: (w: string) => boolean) {
    this.index = new SourceIndex(sections);
    this.rawText = sections.map((s) => s.text).join('\n\n');
    const entities = extractEntities(this.rawText, isKnownWord);
    for (const n of [...entities.numbers, ...entities.years]) this.numbers.add(canonicalNumber(n));
    for (const token of tokenizeWords(this.rawText)) {
      const canonical = normalizeNumberFr(token.word);
      if (canonical !== null) this.numbers.add(canonical);
    }
    this.properNouns = [...new Set(entities.properNouns)];
  }

  hasNumber(raw: string): boolean {
    const canonical = canonicalNumber(raw);
    return this.numbers.has(canonical) || this.index.containsPhrase(raw);
  }

  hasPhrase(raw: string): boolean {
    return this.index.containsPhrase(raw);
  }

  entityCount(): number {
    return this.numbers.size + this.properNouns.length;
  }

  known(word: string): boolean {
    return this.isKnownWord(word);
  }
}

/** §8.4 / §15.5: numbers, years and proper nouns of the output must appear in the source. */
export function checkEntities(outputTexts: readonly string[], source: EntitySource, mode: EntityMode, field = 'output'): GuardIssue[] {
  const issues: GuardIssue[] = [];
  const text = outputTexts.filter((t) => t.trim() !== '').join('\n');
  if (text === '') return issues;
  const entities = extractEntities(text, (w) => source.known(w), { contextText: source.rawText });
  const lowercaseOutputTokens = new Set(tokenizeWords(text).map((t) => t.word).filter((w) => w === w.toLowerCase()));

  const years = new Set(entities.years.map(canonicalNumber));
  for (const raw of entities.years) {
    if (!source.hasNumber(raw)) {
      issues.push({
        code: 'source_invented_year', detail: `${field}:${truncateForLog(raw, 20)}`,
        feedback: `La date « ${raw} » n'est pas dans le texte : n'invente aucune date.`,
      });
    }
  }
  for (const raw of entities.numbers) {
    const canonical = canonicalNumber(raw);
    if (years.has(canonical) || isTrivialNumber(canonical)) continue;
    if (mode === 'lenient') {
      const value = numericValue(canonical);
      if (value !== null && Math.abs(value) <= LENIENT_MAX_FREE_NUMBER) continue;
    }
    if (!source.hasNumber(raw)) {
      issues.push({
        code: 'source_invented_number', detail: `${field}:${truncateForLog(raw, 20)}`,
        feedback: `Le nombre « ${raw} » n'est pas dans le texte : n'invente aucun nombre.`,
      });
    }
  }
  for (const raw of entities.properNouns) {
    if (source.hasPhrase(raw)) continue;
    const lower = raw.toLowerCase();
    if (source.known(lower) && lowercaseOutputTokens.has(lower)) continue;
    issues.push({
      code: 'source_invented_name', detail: `${field}:${truncateForLog(raw, 30)}`,
      feedback: `Le nom « ${raw} » n'apparaît pas dans le texte : n'utilise aucun nom qui n'est pas dans le texte.`,
    });
  }
  return issues;
}

/** §8.4 simplify_text: at least 80 % of the source entities are kept. */
export const SIMPLIFY_MIN_KEPT_ENTITY_RATIO = 0.8;

export function checkEntitiesPreserved(source: EntitySource, outputText: string): GuardIssue[] {
  const total = source.entityCount();
  if (total === 0) return [];
  const output = new EntitySource([{ pageIndex: null, text: outputText }], (w) => source.known(w));
  let kept = 0;
  const missing: string[] = [];
  for (const n of source.numbers) {
    if (output.numbers.has(n)) kept++;
    else missing.push(n);
  }
  for (const p of source.properNouns) {
    if (output.hasPhrase(p)) kept++;
    else missing.push(p);
  }
  if (kept / total >= SIMPLIFY_MIN_KEPT_ENTITY_RATIO) return [];
  return [{
    code: 'source_entities_lost', detail: `kept:${kept}/${total}`,
    feedback: `Garde les noms, les dates et les nombres du texte (il manque : ${missing.slice(0, 5).join(', ')}).`,
  }];
}

export interface QuoteCheck {
  issues: GuardIssue[];
  match: QuoteMatch;
}

export function checkQuote(index: SourceIndex, quote: string, field: string, preferredPage: number | null = null): QuoteCheck {
  if (normalizeForMatch(quote) === '') {
    return {
      issues: [{ code: 'source_quote_empty', detail: field, feedback: 'Chaque citation doit recopier une phrase du texte.' }],
      match: { found: false, pageIndex: null, exact: false },
    };
  }
  const match = index.findQuote(quote, preferredPage);
  if (match.found) return { issues: [], match };
  return {
    issues: [{
      code: 'source_quote_not_found', detail: `${field}:${truncateForLog(quote, 40)}`,
      feedback: `La citation « ${truncateForLog(quote, 60)} » ne se trouve pas dans le texte : recopie les mots exacts du texte.`,
    }],
    match,
  };
}
