import { LIMITS } from '../constants';
import { countWords } from '../ai/limits';
import { readabilityFr } from '../text/readability';
import { segmentSentences } from '../text/segment';

const LABELS = [
  'sens figuré', 'sens propre', 'au figuré', 'figuré', 'par extension', 'par analogie', 'familier', 'populaire', 'vieilli', 'vieux',
  'littéraire', 'soutenu', 'argot', 'péjoratif', 'rare', 'régional', 'désuet', 'poétique', 'botanique', 'zoologie', 'biologie',
  'médecine', 'anatomie', 'chimie', 'physique', 'mathématiques', 'géométrie', 'grammaire', 'linguistique', 'géographie',
  'géologie', 'astronomie', 'histoire', 'religion', 'droit', 'marine', 'militaire', 'musique', 'cuisine', 'sport', 'informatique',
  'technique', 'économie', 'politique', 'agriculture', 'architecture', 'art', 'ornithologie', 'entomologie', 'ichtyologie',
];
const LABEL_PREFIX_RE = new RegExp(`^(?:(?:${LABELS.join('|')})\\s*[:.,;]\\s*)+`, 'i');
const CROSS_REFERENCE_RE = /^(?:voir|voyez|cf\.?|synonymes?|antonymes?|note|notes|ex\.|exemples?|variantes?|→|⇒)(?:\s|:|$)/i;
const INLINE_REFERENCE_RE = /\s*(?:→|⇒)\s*(?:voir\s+)?[^.;]*/g;
const MARKUP_RE = /\{\{|\}\}|\[\[|\]\]|\||=|#|<|>/;
const KID_MAX_SENTENCE_WORDS = 20;
const KID_MAX_LONG_WORD_RATIO = 0.3;

function firstDefinition(raw: string): string {
  const lines = raw.normalize('NFC').replace(/\r\n?/g, '\n').split('\n');
  for (const line of lines) {
    const cleaned = line.replace(/^\s*(?:[#*•\-\u2013]+|\d+\s*[.)]|[IVX]+\s*[.)]|[a-z]\))\s*/u, '').trim();
    if (cleaned.length === 0) continue;
    return cleaned.split(/\s(?:2|II)\s*[.)]\s/)[0] ?? cleaned;
  }
  return '';
}

function stripParentheses(text: string): string {
  let out = text;
  for (let i = 0; i < 5; i++) {
    const next = out.replace(/\s*\([^()]*\)/g, '').replace(/\s*\[[^[\]]*\]/g, '');
    if (next === out) break;
    out = next;
  }
  return out;
}

function tidy(text: string): string {
  let t = text.replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').replace(/^[\s,;:.]+/, '').trim();
  t = t.replace(/[\s,;:]+$/, '');
  if (t.length === 0) return '';
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/** Longest prefix of `sentence` ending at a clause boundary with at most `maxWords` words, or null. */
function clauseCut(sentence: string, maxWords: number): string | null {
  let best: string | null = null;
  for (const m of sentence.matchAll(/[,;:]/g)) {
    const prefix = sentence.slice(0, m.index ?? 0).trim();
    if (countWords(prefix) > maxWords) break;
    if (countWords(prefix) >= 3) best = prefix;
  }
  return best === null ? null : `${best}.`;
}

/**
 * Deterministic simplification of a dictionary definition for a child: first definition only, labels such as
 * « (Botanique) » and cross-references removed, cut at complete sentences within `maxWords` words (or at a clause).
 * kidFriendly when nothing had to be cut mid-clause and the sentences are short enough.
 */
export function kidifyDefinition(raw: string, maxWords: number = LIMITS.kidDefinitionMaxWords): { text: string; kidFriendly: boolean } {
  const limit = Math.max(1, Math.floor(maxWords));
  let text = stripParentheses(firstDefinition(raw)).replace(INLINE_REFERENCE_RE, '').trim();
  text = text.replace(LABEL_PREFIX_RE, '');
  text = tidy(text);
  if (text.length === 0) return { text: '', kidFriendly: false };

  const sentences = segmentSentences(text)
    .map((s) => text.slice(s.start, s.end))
    .filter((s) => !CROSS_REFERENCE_RE.test(s));
  if (sentences.length === 0) return { text: '', kidFriendly: false };

  const kept: string[] = [];
  let words = 0;
  for (const s of sentences) {
    const n = countWords(s);
    if (words + n > limit) break;
    kept.push(s);
    words += n;
  }

  let result: string;
  let hardCut = false;
  if (kept.length > 0) {
    result = kept.join(' ');
  } else {
    const first = sentences[0]!;
    const clause = clauseCut(first.replace(/[.!?…]+$/, ''), limit);
    if (clause) {
      result = clause;
    } else {
      const tokens = first.split(/\s+/);
      result = `${tokens.slice(0, limit).join(' ').replace(/[,;:.]+$/, '')}…`;
      hardCut = true;
    }
  }

  const report = readabilityFr(result);
  const kidFriendly = !hardCut && !MARKUP_RE.test(result) && countWords(result) <= limit
    && report.maxWordsPerSentence <= KID_MAX_SENTENCE_WORDS && report.longWordRatio <= KID_MAX_LONG_WORD_RATIO;
  return { text: result, kidFriendly };
}
