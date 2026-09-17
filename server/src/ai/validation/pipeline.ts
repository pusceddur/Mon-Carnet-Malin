// §8.4 + §15.5 validation pipeline, fixed order: Schema → Source → Age → Safety → Length (+ output injection check).
// Every stage runs so that the single regeneration receives all the feedback at once.
import {
  GLOSSARY_FR, LIMITS, normalizeForMatch, type AILearner, type ChunkSummaryData, type CorrectAnswerRequest, type CorrectionData,
  type ExplainTextRequest, type ExplainWordRequest, type ExplanationData, type GenerateQuestionsRequest, type HandwritingData, type Question,
  type QuestionOnTextData, type QuestionOnTextRequest, type QuestionsData, type SafetyLevel, type SimplifyData, type SimplifyTextRequest,
  type SourceRef, type SummaryData, type SummaryLevel, type TextChunk,
} from '@aide/shared';
import { checkAge, exemptWordsOf } from '../../safety/AgeGuard';
import { checkCharLimit, checkLengthRules, checkSimplifyLength, explainWordMaxWords, summaryMaxWords, type LengthRule } from '../../safety/LengthGuard';
import { checkOutputInjection } from '../../safety/PromptInjectionGuard';
import { checkOutputSafety } from '../../safety/SafetyGuard';
import { checkEntities, checkEntitiesPreserved, checkQuote, EntitySource } from '../../safety/SourceGuard';
import type { SourceSection } from '../../safety/textMatch';
import type {
  ModelAnswer, ModelChunkSummary, ModelCorrection, ModelExplanation, ModelHandwriting, ModelQuestion, ModelQuestions, ModelSimplification,
  ModelSummary,
} from '../schemas';
import type { GuardIssue, GuardResult } from './types';

export type ValidationStage = 'schema' | 'source' | 'age' | 'safety' | 'length' | 'injection';
const STAGE_ORDER: readonly ValidationStage[] = ['schema', 'source', 'age', 'safety', 'length', 'injection'];

export interface ValidationEnv {
  learner: AILearner;
  safetyLevel: SafetyLevel;
  selfReferenceTerms: readonly string[];
  isKnownWord(word: string): boolean;
  attempt: 1 | 2;
}

export type ValidationOutcome<D> =
  | { ok: true; data: D; readabilityWarning: boolean; droppedQuestions: number }
  | { ok: false; stages: ValidationStage[]; issues: GuardIssue[] };

let glossaryWords: Set<string> | null = null;
function glossaryExemptions(): Set<string> {
  glossaryWords ??= exemptWordsOf(GLOSSARY_FR.flatMap((e) => [e.headword, ...(e.forms ?? [])]));
  return glossaryWords;
}

function exemptions(texts: readonly string[]): Set<string> {
  const out = exemptWordsOf(texts);
  for (const w of glossaryExemptions()) out.add(w);
  return out;
}

class Collector {
  private readonly byStage = new Map<ValidationStage, GuardIssue[]>();

  add(stage: ValidationStage, issues: readonly GuardIssue[] | GuardResult): void {
    const list = Array.isArray(issues) ? issues : (issues as GuardResult).issues;
    if (list.length === 0) return;
    this.byStage.set(stage, [...(this.byStage.get(stage) ?? []), ...list]);
  }

  outcome<D>(data: () => D, readabilityWarning: boolean, droppedQuestions = 0): ValidationOutcome<D> {
    const stages = STAGE_ORDER.filter((s) => (this.byStage.get(s)?.length ?? 0) > 0);
    if (stages.length > 0) return { ok: false, stages, issues: stages.flatMap((s) => this.byStage.get(s) ?? []) };
    return { ok: true, data: data(), readabilityWarning, droppedQuestions };
  }
}

function clean(text: string | null | undefined): string {
  return (text ?? '').trim();
}

function nonEmpty(texts: readonly (string | null | undefined)[]): string[] {
  return texts.map(clean).filter((t) => t !== '');
}

function emptyField(field: string): GuardIssue {
  return { code: 'schema_empty_field', detail: field, feedback: `Le champ « ${field} » ne doit pas être vide.` };
}

function commonChecks(
  c: Collector,
  env: ValidationEnv,
  source: EntitySource,
  childVisible: readonly string[],
  ageTexts: readonly string[],
  lengthRules: readonly LengthRule[],
  exemptSourceTexts: readonly string[],
): boolean {
  const age = checkAge({ texts: ageTexts, difficulty: env.learner.explanationDifficulty, exemptWords: exemptions(exemptSourceTexts), attempt: env.attempt });
  c.add('age', age.issues);
  c.add('safety', checkOutputSafety({
    outputTexts: childVisible, source: source.index, rawSource: source.rawText, level: env.safetyLevel, selfReferenceTerms: env.selfReferenceTerms,
  }));
  c.add('length', checkLengthRules(lengthRules));
  c.add('injection', checkOutputInjection(childVisible, source.index));
  return age.readabilityWarning;
}

// ---------- explain_word / explain_text ----------

export function validateExplanation(
  req: ExplainWordRequest | ExplainTextRequest,
  out: ModelExplanation,
  env: ValidationEnv,
): ValidationOutcome<ExplanationData> {
  const c = new Collector();
  const isWord = 'word' in req;
  const explanation = clean(out.explanation);
  const example = clean(out.example) === '' ? null : clean(out.example);
  const quotes = nonEmpty(out.sourceQuotes);
  if (explanation === '') c.add('schema', [emptyField('explanation')]);

  const sections: SourceSection[] = isWord
    ? [{ pageIndex: req.pageIndex, text: req.paragraph }, { pageIndex: req.pageIndex, text: req.sentence }, { pageIndex: null, text: req.word }]
    : [{ pageIndex: req.pageIndex, text: req.text }, { pageIndex: req.pageIndex, text: req.paragraph }];
  const source = new EntitySource(sections, env.isKnownWord);
  const contextText = isWord ? `${req.paragraph}${req.sentence}` : req.text;
  if (quotes.length === 0 && contextText.trim() !== '') {
    c.add('source', [{ code: 'source_quote_missing', detail: 'sourceQuotes', feedback: 'Ajoute dans "sourceQuotes" la phrase du texte recopiée mot pour mot.' }]);
  }
  for (const q of quotes) c.add('source', checkQuote(source.index, q, 'sourceQuotes').issues);
  c.add('source', checkEntities(nonEmpty([explanation, example]), source, 'lenient', 'explanation'));

  const maxWords = isWord ? explainWordMaxWords(env.learner.explanationDifficulty) : LIMITS.explainTextMaxWords;
  const warning = commonChecks(c, env, source, nonEmpty([explanation, example, ...quotes]), nonEmpty([explanation, example]), [
    { field: 'explanation', text: explanation, maxWords },
    { field: 'example', text: example ?? '', maxWords: LIMITS.exampleMaxWords },
  ], sections.map((s) => s.text));
  return c.outcome(() => ({ explanation, example, sourceQuotes: quotes }), warning);
}

// ---------- simplify_text ----------

export function validateSimplification(req: SimplifyTextRequest, out: ModelSimplification, env: ValidationEnv): ValidationOutcome<SimplifyData> {
  const c = new Collector();
  const simplifiedText = clean(out.simplifiedText);
  if (simplifiedText === '') c.add('schema', [emptyField('simplifiedText')]);
  const source = new EntitySource([{ pageIndex: req.pageIndex, text: req.text }], env.isKnownWord);
  c.add('source', checkEntities([simplifiedText], source, 'strict', 'simplifiedText'));
  c.add('source', checkEntitiesPreserved(source, simplifiedText));
  const warning = commonChecks(c, env, source, [simplifiedText], [simplifiedText], [], [req.text]);
  c.add('length', checkSimplifyLength(req.text, simplifiedText));
  return c.outcome(() => ({ simplifiedText }), warning);
}

// ---------- summarize (chunk / final) ----------

export function validateChunkSummary(chunk: TextChunk, level: SummaryLevel, out: ModelChunkSummary, env: ValidationEnv): ValidationOutcome<ChunkSummaryData> {
  const c = new Collector();
  const summary = clean(out.summary);
  if (summary === '') c.add('schema', [emptyField('summary')]);
  const pageIndex = chunk.pageIndexes[0] ?? 0;
  const source = new EntitySource([{ pageIndex, text: chunk.text }], env.isKnownWord);
  const keyQuotes: SourceRef[] = [];
  const quoteIssues: GuardIssue[] = [];
  for (const q of nonEmpty(out.keyQuotes)) {
    const check = checkQuote(source.index, q, 'keyQuotes');
    if (check.issues.length === 0) keyQuotes.push({ pageIndex, quote: q });
    else quoteIssues.push(...check.issues);
  }
  if (keyQuotes.length < LIMITS.chunkKeyQuotesMin) {
    c.add('source', quoteIssues.length > 0 ? quoteIssues : [{ code: 'source_quote_missing', detail: 'keyQuotes', feedback: 'Ajoute dans "keyQuotes" 1 à 3 phrases de l\'extrait, recopiées mot pour mot.' }]);
  }
  c.add('source', checkEntities([summary], source, 'strict', 'summary'));
  const warning = commonChecks(c, env, source, nonEmpty([summary, ...keyQuotes.map((k) => k.quote)]), [summary], [
    { field: 'summary', text: summary, maxWords: summaryMaxWords(level) },
  ], [chunk.text]);
  return c.outcome(() => ({ chunkIndex: chunk.chunkIndex, summary, keyQuotes: keyQuotes.slice(0, LIMITS.chunkKeyQuotesMax) }), warning);
}

export function validateFinalSummary(chunks: readonly ChunkSummaryData[], level: SummaryLevel, out: ModelSummary, env: ValidationEnv): ValidationOutcome<SummaryData> {
  const c = new Collector();
  const summary = clean(out.summary);
  const keyPoints = nonEmpty(out.keyPoints);
  if (summary === '') c.add('schema', [emptyField('summary')]);
  const sections: SourceSection[] = chunks.flatMap((ch) => [
    { pageIndex: null, text: ch.summary },
    ...ch.keyQuotes.map((q) => ({ pageIndex: q.pageIndex, text: q.quote })),
  ]);
  const source = new EntitySource(sections, env.isKnownWord);
  const allowed = chunks.flatMap((ch) => ch.keyQuotes);
  const sourceRefs: SourceRef[] = [];
  for (const ref of out.sourceRefs) {
    const normalized = normalizeForMatch(ref.quote);
    const match = allowed.find((q) => normalizeForMatch(q.quote) === normalized && q.pageIndex === ref.pageIndex)
      ?? allowed.find((q) => normalizeForMatch(q.quote) === normalized);
    if (match && !sourceRefs.some((r) => r.pageIndex === match.pageIndex && r.quote === match.quote)) sourceRefs.push(match);
  }
  if (sourceRefs.length === 0 && allowed.length > 0) {
    c.add('source', [{ code: 'source_refs_not_allowed', detail: `refs:${out.sourceRefs.length}`, feedback: 'Choisis "sourceRefs" uniquement parmi les citations fournies, recopiées exactement.' }]);
  }
  c.add('source', checkEntities([summary, ...keyPoints], source, 'strict', 'summary'));
  const lengthRules: LengthRule[] = [
    { field: 'summary', text: summary, maxWords: summaryMaxWords(level) },
    ...keyPoints.map((k, i) => ({ field: `keyPoints[${i}]`, text: k, maxWords: LIMITS.keyPointMaxWords })),
  ];
  if (keyPoints.length > LIMITS.keyPointsMax) {
    c.add('length', [{ code: 'length_too_many_key_points', detail: `${keyPoints.length}>${LIMITS.keyPointsMax}`, feedback: `Donne au maximum ${LIMITS.keyPointsMax} idées principales.` }]);
  }
  const warning = commonChecks(c, env, source, nonEmpty([summary, ...keyPoints]), [summary, ...keyPoints], lengthRules, sections.map((s) => s.text));
  return c.outcome(() => ({ summary, keyPoints, sourceRefs }), warning);
}

// ---------- generate_questions ----------

function distinct(values: readonly string[]): boolean {
  return new Set(values.map(normalizeForMatch)).size === values.length;
}

interface ConvertedQuestion {
  question: Question | null;
  issues: GuardIssue[];
  /** Texts that must respect the entity rules (distractors and false statements excluded). */
  factualTexts: string[];
  visibleTexts: string[];
}

function convertQuestion(mq: ModelQuestion, index: number, types: readonly Question['type'][], source: EntitySource): ConvertedQuestion {
  const issues: GuardIssue[] = [];
  const field = `questions[${index}]`;
  const prompt = clean(mq.prompt);
  const quote = clean(mq.source.quote);
  const fail = (code: string, feedback: string): ConvertedQuestion => ({ question: null, issues: [...issues, { code, detail: field, feedback }], factualTexts: [], visibleTexts: [] });
  if (!types.includes(mq.type)) return fail('question_type_not_requested', `La question ${index + 1} utilise un type non demandé (${mq.type}).`);
  if (prompt === '') return fail('schema_empty_field', `La question ${index + 1} n'a pas d'énoncé.`);

  const quoteCheck = checkQuote(source.index, quote, `${field}.source`, Number.isInteger(mq.source.pageIndex) ? mq.source.pageIndex : null);
  issues.push(...quoteCheck.issues);
  const ref: SourceRef = { pageIndex: quoteCheck.match.pageIndex ?? Math.max(0, Math.trunc(mq.source.pageIndex)), quote };
  const base = { id: `q${index + 1}`, prompt, source: ref };
  const explanation = clean(mq.explanation);

  let question: Question | null = null;
  const factual: string[] = [prompt, explanation];
  const visible: string[] = [prompt, explanation, quote];
  switch (mq.type) {
    case 'qcm': {
      const choices = nonEmpty(mq.choices ?? []);
      const correctIndex = mq.correctIndex;
      if (choices.length < 2 || choices.length > 6) return fail('question_qcm_choices', `La question ${index + 1} doit avoir de 2 à 6 choix.`);
      if (!distinct(choices)) return fail('question_qcm_duplicates', `Les choix de la question ${index + 1} doivent être différents.`);
      if (correctIndex === null || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= choices.length) {
        return fail('question_qcm_correct_index', `"correctIndex" de la question ${index + 1} doit désigner un des choix.`);
      }
      factual.push(choices[correctIndex]!);
      visible.push(...choices);
      question = { ...base, type: 'qcm', choices, correctIndex, explanation };
      break;
    }
    case 'vrai_faux': {
      if (mq.answer === null) return fail('question_vf_answer', `"answer" de la question ${index + 1} doit valoir true ou false.`);
      // A deliberately false statement may alter a detail: only true statements follow the entity rules.
      if (!mq.answer) factual.splice(0, 1);
      question = { ...base, type: 'vrai_faux', answer: mq.answer, explanation };
      break;
    }
    case 'reponse_libre': {
      const expectedAnswer = clean(mq.expectedAnswer);
      const keyPoints = nonEmpty(mq.keyPoints ?? []).slice(0, 10);
      if (expectedAnswer === '') return fail('question_expected_answer', `La question ${index + 1} doit avoir une "expectedAnswer".`);
      factual.push(expectedAnswer, ...keyPoints);
      visible.push(expectedAnswer, ...keyPoints);
      question = { ...base, type: 'reponse_libre', expectedAnswer, keyPoints };
      break;
    }
    case 'association': {
      const pairs = (mq.pairs ?? []).map((p) => ({ left: clean(p.left), right: clean(p.right) })).filter((p) => p.left !== '' && p.right !== '');
      if (pairs.length < 2 || pairs.length > 10) return fail('question_pairs', `La question ${index + 1} doit avoir de 2 à 10 paires.`);
      if (!distinct(pairs.map((p) => p.left)) || !distinct(pairs.map((p) => p.right))) return fail('question_pairs_duplicates', `Les paires de la question ${index + 1} doivent être différentes.`);
      const texts = pairs.flatMap((p) => [p.left, p.right]);
      factual.push(...texts);
      visible.push(...texts);
      question = { ...base, type: 'association', pairs };
      break;
    }
    case 'ordre': {
      const itemsInOrder = nonEmpty(mq.itemsInOrder ?? []);
      if (itemsInOrder.length < 2 || itemsInOrder.length > 10) return fail('question_order_items', `La question ${index + 1} doit avoir de 2 à 10 éléments.`);
      if (!distinct(itemsInOrder)) return fail('question_order_duplicates', `Les éléments de la question ${index + 1} doivent être différents.`);
      for (const item of itemsInOrder) issues.push(...checkQuote(source.index, item, `${field}.itemsInOrder`).issues);
      visible.push(...itemsInOrder);
      question = { ...base, type: 'ordre', itemsInOrder };
      break;
    }
  }
  return { question, issues, factualTexts: nonEmpty(factual), visibleTexts: nonEmpty(visible) };
}

export function validateQuestions(req: GenerateQuestionsRequest, out: ModelQuestions, env: ValidationEnv): ValidationOutcome<QuestionsData> {
  const c = new Collector();
  const sections = req.pages.map((p) => ({ pageIndex: p.pageIndex, text: p.text }));
  const source = new EntitySource(sections, env.isKnownWord);
  const kept: { question: Question; factual: string[]; visible: string[] }[] = [];
  const dropped: GuardIssue[] = [];
  const seenPrompts = new Set<string>();

  out.questions.forEach((mq, i) => {
    const converted = convertQuestion(mq, i, req.types, source);
    const issues = [...converted.issues];
    if (converted.question) {
      issues.push(...checkEntities(converted.factualTexts, source, 'strict', `questions[${i}]`));
      issues.push(...checkLengthRules([{ field: `questions[${i}].prompt`, text: converted.question.prompt, maxWords: LIMITS.questionPromptMaxWords }]).issues);
      const key = normalizeForMatch(converted.question.prompt);
      if (seenPrompts.has(key)) issues.push({ code: 'question_duplicate', detail: `questions[${i}]`, feedback: `La question ${i + 1} répète une autre question.` });
      seenPrompts.add(key);
    }
    if (converted.question && issues.length === 0) kept.push({ question: converted.question, factual: converted.factualTexts, visible: converted.visibleTexts });
    else dropped.push(...issues);
  });

  const minKept = Math.ceil(LIMITS.questionsMinKeptRatio * req.count - 1e-9);
  if (kept.length < minKept) {
    c.add('source', [
      ...dropped,
      { code: 'questions_too_few', detail: `${kept.length}/${req.count}`, feedback: `Seulement ${kept.length} questions sur ${req.count} respectent les règles : écris ${req.count} questions dont la réponse et la citation sont dans le texte.` },
    ]);
  }
  const final = kept.slice(0, req.count).map((k, i) => ({ ...k, question: { ...k.question, id: `q${i + 1}` } }));
  const ageTexts = final.map((k) => k.question.prompt);
  const warning = commonChecks(c, env, source, final.flatMap((k) => k.visible), ageTexts, [], sections.map((s) => s.text));
  return c.outcome(() => ({ questions: final.map((k) => k.question) }), warning, out.questions.length - final.length);
}

// ---------- correct_answer ----------

export function validateCorrection(req: CorrectAnswerRequest, out: ModelCorrection, env: ValidationEnv): ValidationOutcome<CorrectionData> {
  const c = new Collector();
  const feedback = clean(out.feedback);
  if (feedback === '') c.add('schema', [emptyField('feedback')]);
  const q = req.question;
  const sections: SourceSection[] = [
    ...req.pages.map((p) => ({ pageIndex: p.pageIndex, text: p.text })),
    { pageIndex: null, text: q.prompt },
    { pageIndex: null, text: q.expectedAnswer },
    ...q.keyPoints.map((k) => ({ pageIndex: null, text: k })),
    { pageIndex: null, text: req.answerText },
    { pageIndex: q.source.pageIndex, text: q.source.quote },
  ];
  const source = new EntitySource(sections, env.isKnownWord);
  let rereadRef: SourceRef | null = null;
  if (out.rereadRef && clean(out.rereadRef.quote) !== '') {
    const pageSource = new EntitySource(req.pages.map((p) => ({ pageIndex: p.pageIndex, text: p.text })), env.isKnownWord);
    const check = checkQuote(pageSource.index, clean(out.rereadRef.quote), 'rereadRef', out.rereadRef.pageIndex);
    c.add('source', check.issues);
    rereadRef = { pageIndex: check.match.pageIndex ?? Math.max(0, Math.trunc(out.rereadRef.pageIndex)), quote: clean(out.rereadRef.quote) };
  }
  c.add('source', checkEntities([feedback], source, 'strict', 'feedback'));
  const warning = commonChecks(c, env, source, nonEmpty([feedback, rereadRef?.quote]), [feedback], [
    { field: 'feedback', text: feedback, maxWords: LIMITS.correctionFeedbackMaxWords },
  ], sections.map((s) => s.text));
  return c.outcome(() => ({ verdict: out.verdict, feedback, rereadRef }), warning);
}

// ---------- question_on_text ----------

export function validateAnswer(req: QuestionOnTextRequest, out: ModelAnswer, env: ValidationEnv): ValidationOutcome<QuestionOnTextData> {
  const c = new Collector();
  const answer = clean(out.answer);
  if (answer === '') c.add('schema', [emptyField('answer')]);
  const pageSections = req.pages.map((p) => ({ pageIndex: p.pageIndex, text: p.text }));
  const pageIndex = new EntitySource(pageSections, env.isKnownWord);
  const source = new EntitySource([...pageSections, { pageIndex: null, text: req.question }], env.isKnownWord);
  const sourceRefs: SourceRef[] = [];
  for (const ref of out.sourceRefs) {
    const quote = clean(ref.quote);
    const check = checkQuote(pageIndex.index, quote, 'sourceRefs', ref.pageIndex);
    c.add('source', check.issues);
    if (check.issues.length === 0) sourceRefs.push({ pageIndex: check.match.pageIndex ?? Math.max(0, Math.trunc(ref.pageIndex)), quote });
  }
  if (out.sourceRefs.length === 0) {
    c.add('source', [{ code: 'source_quote_missing', detail: 'sourceRefs', feedback: 'Ajoute dans "sourceRefs" la phrase du texte qui contient la réponse, recopiée mot pour mot.' }]);
  }
  c.add('source', checkEntities([answer], source, 'strict', 'answer'));
  const warning = commonChecks(c, env, source, nonEmpty([answer, ...sourceRefs.map((r) => r.quote)]), [answer], [
    { field: 'answer', text: answer, maxWords: LIMITS.questionOnTextAnswerMaxWords },
  ], [...pageSections.map((s) => s.text), req.question]);
  return c.outcome(() => ({ answer, sourceRefs }), warning);
}

// ---------- recognize_handwriting ----------

export function validateHandwriting(out: ModelHandwriting): ValidationOutcome<HandwritingData> {
  const c = new Collector();
  const text = clean(out.text);
  if (text === '') c.add('schema', [emptyField('text')]);
  c.add('length', checkCharLimit('text', text, LIMITS.answerMaxChars));
  return c.outcome(() => ({ text }), false);
}

/** Retry feedback sent to the model (deduplicated, bounded). */
export function feedbackOf(issues: readonly GuardIssue[], max = 8): string[] {
  const out: string[] = [];
  for (const issue of issues) {
    const text = issue.feedback ?? `Problème : ${issue.code}.`;
    if (!out.includes(text)) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** Compact, content-free detail for ai_requests.rejection_detail. */
export function rejectionDetailOf(stages: readonly ValidationStage[], issues: readonly GuardIssue[]): string {
  const codes = [...new Set(issues.map((i) => i.code))].slice(0, 12).join(',');
  return `${stages.join('>')}: ${codes}`.slice(0, 1000);
}
