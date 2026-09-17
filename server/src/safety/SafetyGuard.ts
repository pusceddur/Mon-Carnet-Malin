import { normalizeForMatch, type SafetyLevel } from '@aide/shared';
import { guardResult, type GuardIssue, type GuardResult } from '../ai/validation/types';
import {
  ADULT_REDIRECT, BLOCK_EXPLICIT, CONTACT_PATTERNS, DEPENDENCY_PATTERNS, GENERIC_SELF_REFERENCE, SELF_REFERENCE_TEMPLATES, SENSITIVE_EDUCATIONAL,
  type LexiconEntry,
} from './lexicons.fr';
import { SourceIndex } from './textMatch';

export interface LexiconMatch {
  id: string;
  /** Normalized matched text (never logged for child text). */
  match: string;
}

function findAll(entries: readonly LexiconEntry[], normalizedText: string): LexiconMatch[] {
  const out: LexiconMatch[] = [];
  for (const entry of entries) {
    const m = entry.re.exec(normalizedText);
    if (m) out.push({ id: entry.id, match: m[0].trim() });
  }
  return out;
}

export type InputSafetyVerdict =
  | { verdict: 'ok' }
  | { verdict: 'block'; matches: LexiconMatch[]; source: 'child' | 'document' }
  | { verdict: 'adult_redirect'; matches: LexiconMatch[] }
  | { verdict: 'strict'; matches: LexiconMatch[] };

export interface InputSafetyRequest {
  /** Free text written by the child (question, answer, recognized handwriting). */
  childTexts: readonly string[];
  /** Selected document text / pages. adult_redirect never applies here (§15.5). */
  documentTexts: readonly string[];
  level: SafetyLevel;
}

/** §8.2 step 2 + §15.5: input check before any AI call. */
export function checkInputSafety(req: InputSafetyRequest): InputSafetyVerdict {
  const child = req.childTexts.map(normalizeForMatch).filter((t) => t !== '');
  const documents = req.documentTexts.map(normalizeForMatch).filter((t) => t !== '');

  for (const text of child) {
    const distress = findAll(ADULT_REDIRECT, text);
    if (distress.length > 0) return { verdict: 'adult_redirect', matches: distress };
  }
  for (const text of child) {
    const explicit = findAll(BLOCK_EXPLICIT, text);
    if (explicit.length > 0) return { verdict: 'block', matches: explicit, source: 'child' };
  }
  for (const text of documents) {
    const explicit = findAll(BLOCK_EXPLICIT, text);
    if (explicit.length > 0) return { verdict: 'block', matches: explicit, source: 'document' };
  }
  if (req.level === 'strict') {
    for (const text of [...child, ...documents]) {
      const sensitive = findAll(SENSITIVE_EDUCATIONAL, text);
      if (sensitive.length > 0) return { verdict: 'strict', matches: sensitive };
    }
  }
  return { verdict: 'ok' };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function selfReferenceEntries(terms: readonly string[]): LexiconEntry[] {
  const entries: LexiconEntry[] = [];
  for (const raw of terms) {
    const term = normalizeForMatch(raw);
    if (term === '') continue;
    const escaped = escapeRegExp(term);
    for (const template of SELF_REFERENCE_TEMPLATES) {
      entries.push({ id: `self_reference:${term}`, re: new RegExp(`(?:^| )${template.replace(/TERM/g, escaped)}(?= |$)`) });
    }
  }
  return entries;
}

export interface OutputSafetyRequest {
  /** Every child-visible string of the output. */
  outputTexts: readonly string[];
  /** Source texts (document, selection, question, child's answer). */
  source: SourceIndex;
  /** Raw source concatenation (URLs/e-mails/phones are compared before normalization). */
  rawSource: string;
  level: SafetyLevel;
  selfReferenceTerms: readonly string[];
}

const FEEDBACK = {
  explicit: "Ta réponse contient un contenu inadapté pour un enfant : reformule sans ce contenu.",
  sensitive: (word: string) => `N'emploie pas « ${word} » : ce thème n'est pas dans le texte. N'ajoute aucun détail sensible.`,
  dependency: "Ne parle pas de toi, pas d'amitié, pas de secret et ne demande aucune information personnelle.",
  selfReference: "Ne parle pas de toi ni de ce que tu es : réponds seulement sur le texte.",
  contact: "N'écris ni lien, ni adresse e-mail, ni numéro de téléphone.",
} as const;

function sourceMatches(source: SourceIndex, entry: LexiconEntry): boolean {
  return entry.re.test(source.paddedAll.replace(/ \| /g, '  '));
}

/** §8.4 SafetyGuard output, with the §15.5 false-refusal rules. */
export function checkOutputSafety(req: OutputSafetyRequest): GuardResult {
  const issues: GuardIssue[] = [];
  const texts = req.outputTexts.map(normalizeForMatch).filter((t) => t !== '');
  const joined = texts.join(' | ');
  const sourceNormalized = req.source.paddedAll;

  for (const m of findAll(BLOCK_EXPLICIT, joined)) {
    issues.push({ code: 'safety_explicit', detail: m.id, feedback: FEEDBACK.explicit });
  }

  for (const entry of SENSITIVE_EDUCATIONAL) {
    const m = entry.re.exec(joined);
    if (!m) continue;
    if (req.level === 'strict' || !sourceMatches(req.source, entry)) {
      issues.push({ code: 'safety_sensitive', detail: entry.id, feedback: FEEDBACK.sensitive(m[0].trim()) });
    }
  }

  for (const m of findAll(DEPENDENCY_PATTERNS, joined)) {
    if (!sourceNormalized.includes(` ${m.match} `)) {
      issues.push({ code: 'safety_dependency', detail: m.id, feedback: FEEDBACK.dependency });
    }
  }

  for (const m of findAll([...GENERIC_SELF_REFERENCE, ...selfReferenceEntries(req.selfReferenceTerms)], joined)) {
    if (!sourceNormalized.includes(` ${m.match} `)) {
      issues.push({ code: 'safety_self_reference', detail: m.id, feedback: FEEDBACK.selfReference });
    }
  }

  const rawOutput = req.outputTexts.join('\n');
  const rawSourceCompact = req.rawSource.replace(/\s+/g, '').toLowerCase();
  for (const entry of CONTACT_PATTERNS) {
    const m = entry.re.exec(rawOutput);
    if (m && !rawSourceCompact.includes(m[0].replace(/\s+/g, '').toLowerCase())) {
      issues.push({ code: 'safety_contact', detail: entry.id, feedback: FEEDBACK.contact });
    }
  }

  return guardResult(dedupeIssues(issues));
}

export function dedupeIssues(issues: GuardIssue[]): GuardIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.code}|${i.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
