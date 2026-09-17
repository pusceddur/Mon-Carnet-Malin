// Deterministic parsing of French Wiktionnaire wikitext (no network, no AI).

export interface PosSection {
  /** Canonical section code, e.g. "nom", "verbe", "adjectif". */
  posCode: string;
  /** Label shown to the reader (French). */
  partOfSpeech: string;
  flexion: boolean;
  /** Raw wikitext between the heading and the next heading. */
  body: string;
}

export interface DefinitionCandidate {
  posCode: string;
  partOfSpeech: string;
  definition: string;
}

export interface InflectionCandidate {
  posCode: string;
  partOfSpeech: string;
  lemma: string;
  /** Cleaned text of the inflection definition, e.g. "Pluriel de cheval." */
  description: string;
}

export interface WikitextAnalysis {
  hasFrench: boolean;
  /** Real definitions (first usable one per section), in page order. */
  definitions: DefinitionCandidate[];
  /** Inflected forms / variants pointing to a lemma, in page order. */
  inflections: InflectionCandidate[];
}

export type EntryChoice =
  | ({ kind: 'definition' } & DefinitionCandidate)
  | ({ kind: 'inflection' } & InflectionCandidate);

const HEADING = /^(={2,6})\s*(.+?)\s*\1\s*$/;
const FRENCH_LANGUAGE = /\{\{\s*langue\s*\|\s*fr\s*(?:\|[^}]*)?\}\}/;

/** Section codes (and their aliases) that hold definitions → French label. */
const POS_LABELS: ReadonlyMap<string, string> = new Map([
  ['nom', 'nom'], ['substantif', 'nom'], ['nom commun', 'nom'],
  ['nom propre', 'nom propre'], ['nom-pr', 'nom propre'],
  ['prénom', 'prénom'], ['nom de famille', 'nom de famille'], ['nom-fam', 'nom de famille'],
  ['adjectif', 'adjectif'], ['adj', 'adjectif'], ['adjectif qualificatif', 'adjectif'],
  ['verbe', 'verbe'], ['verb', 'verbe'],
  ['adverbe', 'adverbe'], ['adv', 'adverbe'],
  ['pronom', 'pronom'], ['pronom personnel', 'pronom'], ['pronom-pers', 'pronom'], ['pronom relatif', 'pronom'],
  ['pronom-rel', 'pronom'], ['pronom démonstratif', 'pronom'], ['pronom-dém', 'pronom'], ['pronom indéfini', 'pronom'],
  ['pronom-indéf', 'pronom'], ['pronom interrogatif', 'pronom'], ['pronom-int', 'pronom'], ['pronom possessif', 'pronom'],
  ['pronom-pos', 'pronom'],
  ['article', 'article'], ['article défini', 'article'], ['art-déf', 'article'], ['article indéfini', 'article'],
  ['art-indéf', 'article'], ['article partitif', 'article'], ['art-part', 'article'],
  ['déterminant', 'déterminant'], ['adjectif démonstratif', 'déterminant'], ['adj-dém', 'déterminant'],
  ['adjectif possessif', 'déterminant'], ['adj-pos', 'déterminant'], ['adjectif indéfini', 'déterminant'],
  ['adj-indéf', 'déterminant'], ['adjectif interrogatif', 'déterminant'], ['adj-int', 'déterminant'],
  ['adjectif exclamatif', 'déterminant'], ['adjectif numéral', 'adjectif numéral'], ['adj-num', 'adjectif numéral'],
  ['préposition', 'préposition'], ['prép', 'préposition'],
  ['conjonction', 'conjonction'], ['conj', 'conjonction'], ['conjonction de coordination', 'conjonction'],
  ['conj-coord', 'conjonction'],
  ['interjection', 'interjection'], ['interj', 'interjection'],
  ['onomatopée', 'onomatopée'], ['onoma', 'onomatopée'],
  ['locution-phrase', 'expression'], ['loc-phr', 'expression'], ['locution phrase', 'expression'],
  ['phrase', 'expression'], ['proverbe', 'expression'], ['prov', 'expression'],
  ['numéral', 'numéral'], ['particule', 'particule'], ['part', 'particule'],
]);

/** Words allowed before "de [[lemma]]" in an inflection definition. */
const GRAMMAR_WORDS: ReadonlySet<string> = new Set([
  'première', 'deuxième', 'troisième', '1re', '2e', '3e', 'personne', 'personnes',
  'du', 'de', 'des', 'la', 'le', 'l', 'et', 'ou', 'au', 'à',
  'singulier', 'pluriel', 'masculin', 'féminin', 'neutre',
  'participe', 'passé', 'présent', 'imparfait', 'futur', 'simple', 'antérieur', 'composé', 'plus-que-parfait',
  'subjonctif', 'impératif', 'conditionnel', 'indicatif', 'infinitif', 'gérondif',
  'forme', 'variante', 'orthographique', 'ortho', 'ancienne', 'orthographe', 'graphie', 'archaïque', 'typographique',
]);
/** At least one of these must be present for a definition to count as an inflection. */
const INFLECTION_CORE_WORDS: ReadonlySet<string> = new Set([
  'singulier', 'pluriel', 'masculin', 'féminin', 'personne', 'personnes', 'participe', 'variante', 'orthographe', 'graphie',
]);

const FIRST_LINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]|\{\{\s*(?:lien|l)\s*\|\s*([^|}]+?)\s*(?:\|[^}]*)?\}\}/;

// ---------------------------------------------------------------------------------------------
// Sections

/** Returns the `== {{langue|fr}} ==` section (without its heading), or null. */
export function extractFrenchSection(wikitext: string): string | null {
  const lines = wikitext.replace(/\r\n?/g, '\n').split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = HEADING.exec(lines[i] ?? '');
    if (!m || m[1]?.length !== 2) continue;
    if (start >= 0) return lines.slice(start, i).join('\n');
    if (FRENCH_LANGUAGE.test(m[2] ?? '')) start = i + 1;
  }
  return start >= 0 ? lines.slice(start).join('\n') : null;
}

function parseSectionTemplate(heading: string): { code: string; lang: string | null; flexion: boolean } | null {
  const m = /^\{\{\s*S\s*\|([^{}]*)\}\}$/.exec(heading.trim());
  if (!m) return null;
  const params = (m[1] ?? '').split('|').map((p) => p.trim());
  const code = (params[0] ?? '').toLowerCase();
  if (!code) return null;
  const positional = params.slice(1).filter((p) => !p.includes('='));
  return { code, lang: positional[0] ?? null, flexion: positional.includes('flexion') };
}

/** Part-of-speech sections of a French language section, in page order. */
export function listPosSections(frenchSection: string): PosSection[] {
  const lines = frenchSection.split('\n');
  const sections: PosSection[] = [];
  let current: { posCode: string; partOfSpeech: string; flexion: boolean; lines: string[] } | null = null;
  const flush = (): void => {
    if (current) sections.push({ posCode: current.posCode, partOfSpeech: current.partOfSpeech, flexion: current.flexion, body: current.lines.join('\n') });
    current = null;
  };
  for (const line of lines) {
    const m = HEADING.exec(line);
    if (m) {
      flush();
      const s = parseSectionTemplate(m[2] ?? '');
      const label = s ? POS_LABELS.get(s.code) : undefined;
      if (s && label && (s.lang === null || s.lang === 'fr')) {
        // Aliases collapse onto the label so that flexion and lemma sections compare equal.
        current = { posCode: label, partOfSpeech: label, flexion: s.flexion, lines: [] };
      }
      continue;
    }
    current?.lines.push(line);
  }
  flush();
  return sections;
}

/** First-level definition lines ("# …"), skipping examples (#*), notes (#:) and sub-definitions (##). */
export function definitionLines(sectionBody: string): string[] {
  return sectionBody
    .split('\n')
    .filter((line) => /^#(?![#*:])/.test(line))
    .map((line) => line.slice(1).trim());
}

// ---------------------------------------------------------------------------------------------
// Cleaning

const ENTITIES: Readonly<Record<string, string>> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', laquo: '«', raquo: '»',
  hellip: '…', ndash: '–', mdash: '—', thinsp: ' ', nnbsp: ' ',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const cp = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    if (body.startsWith('#')) {
      const cp = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const FILE_LINK_START = /\[\[\s*(?:fichier|file|image|média|media|catégorie|category)\s*:/gi;

/** Removes [[Fichier:…]]-like links, which can contain nested links. */
function removeFileLinks(s: string): string {
  let out = s;
  for (let guard = 0; guard < 50; guard += 1) {
    FILE_LINK_START.lastIndex = 0;
    const m = FILE_LINK_START.exec(out);
    if (!m) break;
    let depth = 0;
    let end = out.length;
    for (let i = m.index; i < out.length - 1; i += 1) {
      if (out[i] === '[' && out[i + 1] === '[') {
        depth += 1;
        i += 1;
      } else if (out[i] === ']' && out[i + 1] === ']') {
        depth -= 1;
        i += 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    out = out.slice(0, m.index) + out.slice(end);
  }
  return out;
}

function resolveLinks(s: string): string {
  return s.replace(/\[\[([^[\]]*)\]\]/g, (_whole, inner: string) => {
    const parts = inner.split('|');
    const target = (parts[0] ?? '').trim();
    const label = parts.length > 1 ? parts.slice(1).join('|').trim() : null;
    // Interlanguage links ([[en:word]]) are dropped; namespaced links keep their label.
    if (/^:?[a-z]{2,3}(?:-[a-z]+)?:/.test(target) && label === null && !/^:?(?:w|s|wikt):/i.test(target)) return '';
    if (label !== null) return label;
    return target.replace(/^:?(?:w|s|wikt):/i, '').replace(/#.*$/, '');
  });
}

function splitParams(inner: string): { name: string; positional: string[]; named: Record<string, string> } {
  const parts = inner.split('|');
  const name = (parts[0] ?? '').trim().replace(/^(?:modèle|template):/i, '').toLowerCase();
  const positional: string[] = [];
  const named: Record<string, string> = {};
  for (const raw of parts.slice(1)) {
    const eq = /^\s*([\p{L}\p{N} _-]+?)\s*=(.*)$/su.exec(raw);
    if (eq) named[(eq[1] ?? '').toLowerCase()] = (eq[2] ?? '').trim();
    else positional.push(raw.trim());
  }
  return { name, positional, named };
}

const SUPERSCRIPT_TEMPLATES = new Set(['e', 'er', 're', 'ers', 'res', 'ème', 'ex', 'exp', 'o', 'nd', 'd']);

function renderTemplate(inner: string): string {
  const colon = /^\s*(formatnum|lc|uc|ucfirst|lcfirst)\s*:(.*)$/is.exec(inner);
  if (colon) return (colon[2] ?? '').split('|')[0]?.trim() ?? '';
  const { name, positional, named } = splitParams(inner);
  switch (name) {
    case 'lien':
    case 'l':
      return named['dif'] ?? positional[0] ?? '';
    case 'w':
    case 'wp':
    case 'lien web':
      return positional[1] ?? positional[0] ?? named['titre'] ?? '';
    case 'nom w pc':
    case 'nom w pd':
      return positional.join(' ');
    case 'siècle':
    case 'siècle2':
      return positional[0] ? `${positional[0]}e siècle` : '';
    case 'nobr':
    case 'nowrap':
    case 'smcp':
    case 'petites capitales':
    case 'pc':
    case 'gras':
    case 'term-lien':
      return positional[0] ?? '';
    case 'lang':
      return positional[1] ?? '';
    case 'unité':
      return positional.join(' ');
    case 'fchim':
      return positional.join('');
    case 'variante de':
      return positional[0] ? `Variante de ${positional[0]}` : '';
    case 'variante ortho de':
    case 'variante orthographique de':
      return positional[0] ? `Variante orthographique de ${positional[0]}` : '';
    default:
      if (SUPERSCRIPT_TEMPLATES.has(name)) return positional[0] ?? name;
      if (/^\d+(?:e|er|re)$/.test(name)) return positional[0] ? `${name} ${positional[0]}` : name;
      // Labels ({{lexique|…}}, {{figuré|fr}}, {{term|…}}, {{info lex|…}}), references and the rest are dropped.
      return '';
  }
}

function resolveTemplates(s: string): string {
  let out = s;
  for (let guard = 0; guard < 20; guard += 1) {
    const next = out.replace(/\{\{([^{}]*)\}\}/g, (_whole, inner: string) => renderTemplate(inner));
    if (next === out) break;
    out = next;
  }
  return out.replace(/\{\{|\}\}/g, '');
}

/** Converts a fragment of wikitext into plain French text. */
export function cleanWikitext(raw: string): string {
  let s = raw;
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<ref\b[^>]*\/>/gi, '');
  s = s.replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>/gi, '');
  s = s.replace(/<(nowiki|math|gallery|syntaxhighlight)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, ' ');
  s = removeFileLinks(s);
  s = resolveLinks(s);
  s = resolveTemplates(s);
  s = resolveLinks(s);
  s = s.replace(/'{5}([\s\S]*?)'{5}/g, '$1').replace(/'{3}([\s\S]*?)'{3}/g, '$1').replace(/'{2}([\s\S]*?)'{2}/g, '$1');
  s = s.replace(/'{2,}/g, '');
  s = s.replace(/<\/?[a-z][a-z0-9]*\b[^>]*>/gi, '');
  s = decodeEntities(s);
  s = s.replace(/[   ]/g, ' ');
  s = s.replace(/\[\s*\]|\(\s*\)/g, ' ');
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/\s+([,.])/g, '$1');
  s = s.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
  s = s.replace(/^[\s,;:.–—-]+/, '');
  return s.trim();
}

function hasLetters(s: string, min = 2): boolean {
  return (s.match(/\p{L}/gu)?.length ?? 0) >= min;
}

// ---------------------------------------------------------------------------------------------
// Inflections

/** "''Pluriel de'' [[cheval]]." → { lemma: "cheval" }. Null when the definition is a real one. */
export function detectInflection(rawDefinition: string): { lemma: string; description: string } | null {
  const m = FIRST_LINK.exec(rawDefinition);
  if (!m) return null;
  const lemma = (m[1] ?? m[2] ?? '').trim();
  if (!lemma || lemma.includes(':') || lemma.length > 100) return null;
  const prefix = cleanWikitext(rawDefinition.slice(0, m.index))
    .toLowerCase()
    .replace(/[.,;:()«»"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tail = /^(.*?)\s*\b(?:de|d['’])$/u.exec(prefix);
  if (!tail) return null;
  const words = (tail[1] ?? '').split(/[\s'’]+/u).filter((w) => w.length > 0);
  if (words.length === 0) return null;
  if (!words.every((w) => GRAMMAR_WORDS.has(w))) return null;
  if (!words.some((w) => INFLECTION_CORE_WORDS.has(w))) return null;
  return { lemma, description: cleanWikitext(rawDefinition) };
}

/** Lemma from inflection box templates ({{fr-verbe-flexion|manger|…}}, {{fr-accord-…|ms=petit}}). */
export function lemmaFromFlexionTemplates(sectionBody: string): string | null {
  const verb = /\{\{\s*fr-verbe-flexion\s*\|([^{}]*)\}\}/.exec(sectionBody);
  if (verb) {
    const first = (verb[1] ?? '').split('|').map((p) => p.trim()).find((p) => p.length > 0 && !p.includes('='));
    if (first) return first;
  }
  const accord = /\{\{\s*fr-(?:accord-[^|{}]*|rég|inv)\s*\|([^{}]*)\}\}/.exec(sectionBody);
  if (accord) {
    const params = (accord[1] ?? '').split('|').map((p) => p.trim());
    for (const key of ['ms=', 's=']) {
      const found = params.find((p) => p.startsWith(key));
      const value = found?.slice(key.length).trim();
      if (value) return value;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Analysis

export function analyzeWikitext(wikitext: string): WikitextAnalysis {
  const french = extractFrenchSection(wikitext);
  if (french === null) return { hasFrench: false, definitions: [], inflections: [] };
  const definitions: DefinitionCandidate[] = [];
  const inflections: InflectionCandidate[] = [];

  for (const section of listPosSections(french)) {
    const base = { posCode: section.posCode, partOfSpeech: section.partOfSpeech };
    let handled = false;
    for (const raw of definitionLines(section.body)) {
      const cleaned = cleanWikitext(raw);
      if (!hasLetters(cleaned)) continue;
      const inflection = detectInflection(raw);
      if (inflection) {
        inflections.push({ ...base, ...inflection });
      } else if (section.flexion) {
        const lemma = lemmaFromFlexionTemplates(section.body);
        if (lemma) inflections.push({ ...base, lemma, description: cleaned });
        else definitions.push({ ...base, definition: cleaned });
      } else {
        definitions.push({ ...base, definition: cleaned });
      }
      handled = true;
      break;
    }
    if (!handled && section.flexion) {
      const lemma = lemmaFromFlexionTemplates(section.body);
      if (lemma) inflections.push({ ...base, lemma, description: '' });
    }
  }
  return { hasFrench: true, definitions, inflections };
}

/**
 * Picks the entry to show: a real definition first (same part of speech as `preferredPosCode` when given),
 * otherwise the first inflection. Homographs resolve deterministically to page order.
 */
export function chooseEntry(analysis: WikitextAnalysis, preferredPosCode?: string | null): EntryChoice | null {
  const preferred = preferredPosCode ? analysis.definitions.find((d) => d.posCode === preferredPosCode) : undefined;
  const definition = preferred ?? analysis.definitions[0];
  if (definition) return { kind: 'definition', ...definition };
  const inflection = analysis.inflections[0];
  return inflection ? { kind: 'inflection', ...inflection } : null;
}
