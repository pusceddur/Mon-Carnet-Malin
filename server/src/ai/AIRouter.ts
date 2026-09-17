// Single entry point of every AI request (§8.2 reordered by §15.4):
// 1 validation + child ownership → 2 SafetyGuard input → 3 local resolution → 4 AI off / feature off / quota / budget
// → 5 PromptInjectionGuard → 6 routeFor → 7 cache → 8 call with deadline → 9 validation + at most 1 regeneration → 10 cache + log.
import {
  AI_DEADLINES, AIRequestSchemaByOperation, aiCacheKey, ChunkSummaryDataSchema, isAIOperationEnabled, KID_MESSAGES, LIMITS, newId,
  profileSignature, PROMPT_VERSION, retrieveRelevantParagraphs, routeFor, sha256Hex, TIMINGS, type AIBlockedReason, type AIJobAccepted,
  type AIJobPoll, type AILearner, type AIMeta, type AIOperation, type AIPageInput, type AIResult, type AIRoute, type AIUnavailableReason,
  type ChunkSummaryData, type CorrectAnswerRequest, type DictionaryResult, type ExplainTextRequest, type ExplainWordRequest,
  type GenerateQuestionsRequest, type ParentSettings, type QuestionOnTextRequest, type RecognizeHandwritingRequest, type SimplifyTextRequest,
  type SummarizeRequest,
} from '@aide/shared';
import { monthStartUtc } from '../db/repositories/activity';
import type { AICacheRepository } from '../db/repositories/aiCache';
import type { AIJobsRepository } from '../db/repositories/aiJobs';
import type { AIRequestRecord, AIRequestsRepository, AIRequestStatus } from '../db/repositories/aiRequests';
import type { SafetyAlertInput, SafetyAlertsRepository } from '../db/repositories/safetyAlerts';
import { AppError, ERROR_MESSAGES_FR, parseOrThrow } from '../errors';
import type { Logger } from '../logger';
import { neutralizeInjection, scanForInjection } from '../safety/PromptInjectionGuard';
import { checkInputSafety } from '../safety/SafetyGuard';
import type { AIProvider, ProviderCallContext, ProviderResponse } from './AIProvider';
import { LocalProvider } from './LocalProvider';
import { AI_KID_MESSAGES_FR, ALERT_DETAILS_FR, unavailableMessage } from './messages.fr';
import { isAITransportError, type AITier } from './plugin';
import type {
  ModelAnswer, ModelChunkSummary, ModelCorrection, ModelExplanation, ModelHandwriting, ModelQuestions, ModelSimplification, ModelStatus,
  ModelSummary,
} from './schemas';
import {
  feedbackOf, rejectionDetailOf, validateAnswer, validateChunkSummary, validateCorrection, validateExplanation, validateFinalSummary,
  validateHandwriting, validateQuestions, validateSimplification, type ValidationEnv, type ValidationOutcome, type ValidationStage,
} from './validation/pipeline';
import type { GuardIssue } from './validation/types';

export interface AIStore {
  /** Learner profile of a child of this parent (null when absent, deleted or owned by another parent). */
  getLearner(parentId: string, childId: string): Promise<AILearner | null>;
  getSettings(parentId: string): Promise<ParentSettings>;
}

export interface DictionaryLookup {
  lookup(parentId: string, word: string): Promise<DictionaryResult>;
}

export interface AIRouterDeps {
  now(): number;
  logger: Logger;
  store: AIStore;
  cache: AICacheRepository;
  requests: AIRequestsRepository;
  alerts: SafetyAlertsRepository;
  jobs: AIJobsRepository;
  providers: { light: AIProvider | null; complex: AIProvider | null };
  local?: LocalProvider;
  dictionary?: DictionaryLookup | null;
  isKnownWord(word: string): boolean;
  /**
   * Routes answered through asynchronous jobs (202 + polling): 'complex' (default, §15.4) or 'all' (§17.4: the external
   * worker serves the light route too).
   */
  asyncRoutes?: 'complex' | 'all';
  /** End-to-end deadline per route, of the provider serving it (default AI_DEADLINES; worker deadlines with the worker). */
  deadlines?: { light: number; complex: number };
  /** Test hooks. */
  minRetryMs?: number;
  cacheTtlMs?: number;
}

export type AIRouterOutcome =
  | { kind: 'result'; httpStatus: 200; body: AIResult<unknown> }
  | { kind: 'job'; httpStatus: 202; body: AIJobAccepted }
  | { kind: 'aborted' };

const DEFAULT_CACHE_TTL_MS = 180 * 24 * 60 * 60_000;
const DEFAULT_MIN_RETRY_MS = 5_000;
const BUDGET_WARNING_RATIO = 0.8;
const MICROS_PER_EUR = 1_000_000;

interface RequestCtx {
  requestId: string;
  op: AIOperation;
  parentId: string;
  childId: string;
  documentId: string | null;
  documentHash: string | null;
  learner: AILearner;
  settings: ParentSettings;
  startedAt: number;
}

interface CacheIdentity {
  scope: string;
  inputHash: string;
  contentHash: string | null;
  /** Summary chunks: shared by every provider (the final stage cannot know which one produced them). */
  modelIndependent: boolean;
}

type LocalData = { data: unknown } | null;

interface Plan {
  inputChars: number;
  childTexts: string[];
  documentTexts: string[];
  /** Page of the selection, for parent alerts. */
  pageIndex: number | null;
  sourceWarning: boolean;
  summarizeStage?: 'chunk' | 'final';
  cacheIdentity: CacheIdentity | null;
  local: (() => LocalData) | null;
  /** Result decided while planning (summary final: missing or excluded chunks). */
  early?: AIResult<unknown>;
  call(provider: AIProvider, ctx: ProviderCallContext): Promise<ProviderResponse<{ status: ModelStatus }>>;
  validate(parsed: unknown, env: ValidationEnv): ValidationOutcome<unknown>;
  neutralize(): void;
  /** Store a "blocked" marker (summary chunks) so that the final stage can exclude the chunk. */
  markBlocked?: boolean;
}

interface Usage {
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicros: number | null;
}

class DeadlineAbort extends Error {}
class ClientAbort extends Error {}

function addNullable(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}

function pagesChars(pages: readonly AIPageInput[]): number {
  return pages.reduce((n, p) => n + p.text.length, 0);
}

function pageScope(pages: readonly AIPageInput[]): string {
  if (pages.length === 0) return 'p-';
  const indexes = pages.map((p) => p.pageIndex);
  return `p${Math.min(...indexes)}-${Math.max(...indexes)}`;
}

async function hashJson(value: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(value));
}

export class AIRouter {
  private readonly local: LocalProvider;
  private readonly deadlines: { light: number; complex: number };
  private readonly asyncRoutes: 'complex' | 'all';
  private readonly inflightJobs = new Set<Promise<void>>();

  constructor(private readonly deps: AIRouterDeps) {
    this.local = deps.local ?? new LocalProvider();
    this.deadlines = deps.deadlines ?? AI_DEADLINES;
    this.asyncRoutes = deps.asyncRoutes ?? 'complex';
  }

  private isAsync(route: AITier): boolean {
    return route === 'complex' || this.asyncRoutes === 'all';
  }

  /** Resolves when every background job started so far has finished (tests, graceful shutdown). */
  async idle(): Promise<void> {
    while (this.inflightJobs.size > 0) await Promise.allSettled([...this.inflightJobs]);
  }

  // ---------------------------------------------------------------- public API

  async handle(op: AIOperation, parentId: string, body: unknown, opts: { signal?: AbortSignal } = {}): Promise<AIRouterOutcome> {
    // 1. validation + child ownership
    const schema = AIRequestSchemaByOperation[op];
    const req: unknown = parseOrThrow(schema, body);
    const base = req as { childId: string; documentId: string | null; documentHash: string | null };
    const learner = await this.deps.store.getLearner(parentId, base.childId);
    if (!learner) throw new AppError(403, 'forbidden', ERROR_MESSAGES_FR.forbidden);
    const settings = await this.deps.store.getSettings(parentId);
    const ctx: RequestCtx = {
      requestId: newId(), op, parentId, childId: base.childId, documentId: base.documentId, documentHash: base.documentHash,
      learner, settings, startedAt: this.deps.now(),
    };
    const plan = await this.buildPlan(ctx, req);
    if (plan.early) return this.finish(ctx, plan, plan.early, this.noUsage(), { route: 'local', cacheHit: false });

    // 2. SafetyGuard input
    const input = checkInputSafety({ childTexts: plan.childTexts, documentTexts: plan.documentTexts, level: settings.safety.level });
    if (input.verdict === 'adult_redirect') {
      await this.alert(ctx, 'adult_redirect', ALERT_DETAILS_FR.adultRedirect(op, plan.childTexts.join(' ')));
      return this.blocked(ctx, plan, 'adult_redirect', KID_MESSAGES.adultRedirect, `input:${input.matches.map((m) => m.id).join(',')}`);
    }
    if (input.verdict === 'block') {
      const detail = input.source === 'child'
        ? ALERT_DETAILS_FR.safetyInputChild(op, plan.childTexts.join(' '))
        : ALERT_DETAILS_FR.safetyInputDocument(op, plan.pageIndex, (await sha256Hex(plan.documentTexts.join('\n'))).slice(0, 12));
      await this.alert(ctx, 'safety_input', detail);
      return this.blocked(ctx, plan, 'safety_input', KID_MESSAGES.blocked, `input:${input.source}:${input.matches.map((m) => m.id).join(',')}`);
    }
    if (input.verdict === 'strict') {
      return this.blocked(ctx, plan, 'safety_input', KID_MESSAGES.strict, `strict:${input.matches.map((m) => m.id).join(',')}`);
    }

    // 3. local resolution (explain_word: glossary / dictionary)
    let dictionaryFallback: AIResult<unknown> | null = null;
    if (op === 'explain_word' && this.deps.dictionary) {
      const word = (req as ExplainWordRequest).word;
      const found = await this.lookupDictionary(parentId, word);
      if (found?.status === 'found') {
        const result = this.ok(ctx, plan, 'local', false, {
          explanation: found.entry.definition, example: found.entry.example, sourceQuotes: [],
        });
        if (found.entry.kidFriendly) return this.finish(ctx, plan, result, { ...this.noUsage(), provider: 'local', model: `dictionary:${found.entry.source}` }, { route: 'local', cacheHit: false });
        dictionaryFallback = result;
      }
    }

    // 4. AI off / feature off / quota / budget → LocalProvider or unavailable
    const route = routeFor(op, plan.inputChars, settings, plan.summarizeStage ? { summarizeStage: plan.summarizeStage } : undefined);
    const availability = await this.availability(ctx);
    if (availability !== null) {
      if (availability === 'quota' || availability === 'budget') {
        const cached = await this.cachedForUnavailable(ctx, plan, route);
        if (cached) return cached;
      }
      return this.localOrUnavailable(ctx, plan, availability, dictionaryFallback);
    }

    // 5. PromptInjectionGuard (alert once per content, neutralize, continue)
    const scan = scanForInjection([...plan.documentTexts, ...plan.childTexts]);
    const injectionSuspected = scan.detected;
    if (scan.detected) {
      await this.alert(ctx, 'injection_detected', ALERT_DETAILS_FR.injection(op, plan.pageIndex, scan.excerpt ?? ''));
      plan.neutralize();
    }

    // 6. route
    if (route === 'local') return this.localOrUnavailable(ctx, plan, 'not_configured', dictionaryFallback);
    const provider = this.deps.providers[route];
    if (provider?.refresh) await provider.refresh();
    if (!provider || !provider.supportsTier(route)) return this.localOrUnavailable(ctx, plan, 'not_configured', dictionaryFallback);

    // 7. cache
    const cacheKey = plan.cacheIdentity ? await this.cacheKey(ctx, plan.cacheIdentity, provider, route) : null;
    if (cacheKey) {
      const hit = await this.deps.cache.get(cacheKey, this.deps.now());
      const reusable = hit && hit.validationStatus !== 'blocked' && !(plan.summarizeStage === 'chunk' && hit.provider === 'local');
      if (hit && reusable) {
        const result = this.fromCache(ctx, plan, route, hit.output);
        if (result) {
          const outcome = await this.finish(ctx, plan, result, { ...this.noUsage(), provider: hit.provider, model: hit.model }, { route, cacheHit: true });
          return this.isAsync(route) ? this.completedJob(ctx, outcome) : outcome;
        }
      }
    }

    // 8–10. call, validate, regenerate once, cache, log
    const run = (signal: AbortSignal | undefined): Promise<AIRouterOutcome> =>
      this.execute(ctx, plan, provider, route, cacheKey, injectionSuspected, signal);
    if (this.isAsync(route)) return this.startJob(ctx, route, () => run(undefined));
    return run(opts.signal);
  }

  /** GET /api/ai/jobs/:jobId — null when unknown, expired or owned by another parent. */
  async pollJob(parentId: string, jobId: string): Promise<AIJobPoll<unknown> | null> {
    const now = this.deps.now();
    const job = await this.deps.jobs.get(parentId, jobId, now);
    if (!job) return null;
    if (job.status === 'pending') {
      if (now > job.createdAt + (job.deadlineMs ?? this.deadlines.complex) + TIMINGS.aiJobStaleMarginMs) {
        return { status: 'unavailable', reason: 'timeout', message: unavailableMessage('timeout'), meta: null };
      }
      return { status: 'pending', pollAfterMs: TIMINGS.aiJobPollMs };
    }
    return job.result as AIResult<unknown>;
  }

  // ---------------------------------------------------------------- plans

  private async buildPlan(ctx: RequestCtx, req: unknown): Promise<Plan> {
    switch (ctx.op) {
      case 'explain_word': return this.planExplainWord(req as ExplainWordRequest);
      case 'explain_text': return this.planExplainText(req as ExplainTextRequest);
      case 'simplify_text': return this.planSimplify(req as SimplifyTextRequest);
      case 'summarize': return this.planSummarize(ctx, req as SummarizeRequest);
      case 'generate_questions': return this.planQuestions(req as GenerateQuestionsRequest);
      case 'correct_answer': return this.planCorrection(req as CorrectAnswerRequest);
      case 'question_on_text': return this.planQuestionOnText(req as QuestionOnTextRequest);
      case 'recognize_handwriting': return this.planHandwriting(req as RecognizeHandwritingRequest);
    }
  }

  private async planExplainWord(original: ExplainWordRequest): Promise<Plan> {
    let req = original;
    return {
      inputChars: original.paragraph.length + original.sentence.length + original.word.length,
      childTexts: [],
      documentTexts: [original.word, original.sentence, original.paragraph],
      pageIndex: original.pageIndex,
      sourceWarning: original.ocrLowConfidence,
      cacheIdentity: {
        scope: `p${original.pageIndex}`, contentHash: null, modelIndependent: false,
        inputHash: await hashJson([original.word.trim(), original.sentence.trim(), original.paragraph.trim()]),
      },
      local: null,
      call: (provider, pctx) => provider.explainWord(req, pctx),
      validate: (parsed, env) => validateExplanation(original, parsed as ModelExplanation, env),
      neutralize: () => {
        req = { ...req, sentence: neutralizeInjection(req.sentence), paragraph: neutralizeInjection(req.paragraph) };
      },
    };
  }

  private async planExplainText(original: ExplainTextRequest): Promise<Plan> {
    let req = original;
    return {
      inputChars: original.text.length,
      childTexts: [],
      documentTexts: [original.text, original.paragraph],
      pageIndex: original.pageIndex,
      sourceWarning: original.ocrLowConfidence,
      cacheIdentity: {
        scope: `p${original.pageIndex}`, contentHash: null, modelIndependent: false,
        inputHash: await hashJson([original.text.trim(), original.paragraph.trim()]),
      },
      local: null,
      call: (provider, pctx) => provider.explainText(req, pctx),
      validate: (parsed, env) => validateExplanation(original, parsed as ModelExplanation, env),
      neutralize: () => {
        req = { ...req, text: neutralizeInjection(req.text), paragraph: neutralizeInjection(req.paragraph) };
      },
    };
  }

  private async planSimplify(original: SimplifyTextRequest): Promise<Plan> {
    let req = original;
    return {
      inputChars: original.text.length,
      childTexts: [],
      documentTexts: [original.text],
      pageIndex: original.pageIndex,
      sourceWarning: original.ocrLowConfidence,
      cacheIdentity: { scope: `p${original.pageIndex}`, contentHash: null, modelIndependent: false, inputHash: await hashJson([original.text.trim()]) },
      local: null,
      call: (provider, pctx) => provider.simplifyText(req, pctx),
      validate: (parsed, env) => validateSimplification(original, parsed as ModelSimplification, env),
      neutralize: () => {
        req = { ...req, text: neutralizeInjection(req.text) };
      },
    };
  }

  /** Cache key of a summary chunk: identical in the chunk and final stages (planHash + chunkIndex + level + profile + promptVersion). */
  private chunkCacheKey(ctx: RequestCtx, planHash: string, chunkIndex: number, level: string): Promise<string> {
    return aiCacheKey({
      documentHash: ctx.documentHash,
      scope: `parent:${ctx.parentId}:plan:${planHash}:chunk:${chunkIndex}:${level}`,
      operation: 'summarize',
      inputHash: planHash,
      profileSignature: profileSignature(ctx.learner),
      promptVersion: PROMPT_VERSION,
      model: 'any',
    });
  }

  private async planSummarize(ctx: RequestCtx, req: SummarizeRequest): Promise<Plan> {
    const stage = req.stage;
    if (stage.kind === 'chunk') {
      const original = stage.chunk;
      let chunk = original;
      return {
        inputChars: original.text.length,
        childTexts: [],
        documentTexts: [original.text],
        pageIndex: original.pageIndexes[0] ?? null,
        sourceWarning: req.ocrLowConfidence,
        summarizeStage: 'chunk',
        cacheIdentity: {
          scope: `parent:${ctx.parentId}:plan:${stage.planHash}:chunk:${original.chunkIndex}:${req.level}`,
          inputHash: stage.planHash, contentHash: await sha256Hex(original.text), modelIndependent: true,
        },
        local: () => ({ data: this.local.summarizeChunk(original, req.level) }),
        call: (provider, pctx) => provider.summarizeChunk(chunk, req.level, pctx),
        validate: (parsed, env) => validateChunkSummary(original, req.level, parsed as ModelChunkSummary, env),
        neutralize: () => {
          chunk = { ...chunk, text: neutralizeInjection(chunk.text) };
        },
        markBlocked: true,
      };
    }

    const chunks: ChunkSummaryData[] = [];
    const missing: number[] = [];
    let excluded = 0;
    for (let i = 0; i < stage.chunkCount; i++) {
      const entry = await this.deps.cache.get(await this.chunkCacheKey(ctx, stage.planHash, i, req.level), this.deps.now());
      if (!entry) {
        missing.push(i);
        continue;
      }
      if (entry.validationStatus === 'blocked') {
        excluded++;
        continue;
      }
      const parsed = ChunkSummaryDataSchema.safeParse((entry.output as { data?: unknown } | null)?.data);
      if (parsed.success) chunks.push(parsed.data);
      else missing.push(i);
    }
    const plan: Plan = {
      inputChars: chunks.reduce((n, c) => n + c.summary.length + c.keyQuotes.reduce((m, q) => m + q.quote.length, 0), 0),
      childTexts: [],
      documentTexts: [],
      pageIndex: null,
      sourceWarning: req.ocrLowConfidence || excluded > 0,
      summarizeStage: 'final',
      cacheIdentity: {
        scope: `parent:${ctx.parentId}:plan:${stage.planHash}:final:${stage.chunkCount}:${req.level}`,
        inputHash: await hashJson(chunks), contentHash: null, modelIndependent: false,
      },
      local: () => ({ data: this.local.summarizeFinal(chunks) }),
      call: (provider, pctx) => provider.summarizeFinal({ level: req.level, chunks }, pctx),
      validate: (parsed, env) => validateFinalSummary(chunks, req.level, parsed as ModelSummary, env),
      neutralize: () => undefined,
    };
    const meta = this.meta(ctx, plan, 'local', false);
    if (missing.length > 0) {
      plan.early = { status: 'unavailable', reason: 'missing_chunks', message: KID_MESSAGES.unavailable, meta: null, missingChunkIndexes: missing };
    } else if (excluded / stage.chunkCount > LIMITS.summaryMaxExcludedChunkRatio) {
      plan.early = { status: 'blocked', reason: 'validation', message: KID_MESSAGES.blocked, meta };
    }
    return plan;
  }

  private async planQuestions(original: GenerateQuestionsRequest): Promise<Plan> {
    let req = original;
    return {
      inputChars: pagesChars(original.pages),
      childTexts: [],
      documentTexts: original.pages.map((p) => p.text),
      pageIndex: original.pages[0]?.pageIndex ?? null,
      sourceWarning: original.pages.some((p) => p.ocrLowConfidence),
      cacheIdentity: {
        scope: pageScope(original.pages), contentHash: null, modelIndependent: false,
        inputHash: await hashJson([original.pages.map((p) => [p.pageIndex, p.text]), original.count, [...original.types].sort()]),
      },
      local: () => {
        const data = this.local.generateQuestions(original);
        return data ? { data } : null;
      },
      call: (provider, pctx) => provider.generateQuestions(req, pctx),
      validate: (parsed, env) => validateQuestions(original, parsed as ModelQuestions, env),
      neutralize: () => {
        req = { ...req, pages: req.pages.map((p) => ({ ...p, text: neutralizeInjection(p.text) })) };
      },
    };
  }

  private async planCorrection(full: CorrectAnswerRequest): Promise<Plan> {
    const q = full.question;
    const pages = retrieveRelevantParagraphs(full.pages, `${q.prompt} ${q.expectedAnswer} ${q.keyPoints.join(' ')} ${q.source.quote}`, LIMITS.retrieveMaxChars);
    const original: CorrectAnswerRequest = { ...full, pages: pages.length > 0 ? pages : full.pages };
    let req = original;
    return {
      inputChars: pagesChars(original.pages) + original.answerText.length,
      childTexts: [original.answerText],
      documentTexts: original.pages.map((p) => p.text),
      pageIndex: q.source.pageIndex,
      sourceWarning: original.pages.some((p) => p.ocrLowConfidence),
      cacheIdentity: {
        scope: pageScope(original.pages), contentHash: null, modelIndependent: false,
        inputHash: await hashJson([original.pages.map((p) => [p.pageIndex, p.text]), q, original.answerText.trim()]),
      },
      local: null,
      call: (provider, pctx) => provider.correctAnswer(req, pctx),
      validate: (parsed, env) => validateCorrection(original, parsed as ModelCorrection, env),
      neutralize: () => {
        req = { ...req, answerText: neutralizeInjection(req.answerText), pages: req.pages.map((p) => ({ ...p, text: neutralizeInjection(p.text) })) };
      },
    };
  }

  private async planQuestionOnText(full: QuestionOnTextRequest): Promise<Plan> {
    const retrieved = retrieveRelevantParagraphs(full.pages, full.question, LIMITS.retrieveMaxChars);
    const original: QuestionOnTextRequest = { ...full, pages: retrieved.length > 0 ? retrieved : full.pages };
    let req = original;
    return {
      inputChars: pagesChars(original.pages),
      childTexts: [original.question],
      documentTexts: original.pages.map((p) => p.text),
      pageIndex: original.pages[0]?.pageIndex ?? null,
      sourceWarning: original.pages.some((p) => p.ocrLowConfidence),
      cacheIdentity: {
        scope: pageScope(original.pages), contentHash: null, modelIndependent: false,
        inputHash: await hashJson([original.pages.map((p) => [p.pageIndex, p.text]), original.question.trim()]),
      },
      local: null,
      call: (provider, pctx) => provider.answerQuestion(req, pctx),
      validate: (parsed, env) => validateAnswer(original, parsed as ModelAnswer, env),
      neutralize: () => {
        req = { ...req, question: neutralizeInjection(req.question), pages: req.pages.map((p) => ({ ...p, text: neutralizeInjection(p.text) })) };
      },
    };
  }

  private async planHandwriting(req: RecognizeHandwritingRequest): Promise<Plan> {
    return {
      inputChars: 0,
      childTexts: [],
      documentTexts: [],
      pageIndex: null,
      sourceWarning: false,
      cacheIdentity: null,
      local: null,
      call: (provider, pctx) => provider.recognizeHandwriting(req, pctx),
      validate: (parsed) => validateHandwriting(parsed as ModelHandwriting),
      neutralize: () => undefined,
    };
  }

  // ---------------------------------------------------------------- steps

  private async lookupDictionary(parentId: string, word: string): Promise<DictionaryResult | null> {
    try {
      return (await this.deps.dictionary?.lookup(parentId, word)) ?? null;
    } catch (err) {
      this.deps.logger.warn('ai_dictionary_lookup_failed', { error: err });
      return null;
    }
  }

  private async availability(ctx: RequestCtx): Promise<AIUnavailableReason | null> {
    const { settings } = ctx;
    if (!settings.ai.enabled) return 'ai_disabled';
    if (!isAIOperationEnabled(ctx.op, settings)) return 'feature_disabled';
    const now = this.deps.now();
    const calls = await this.deps.requests.countBillableCalls(ctx.childId, dayStartUtc(now));
    if (calls >= settings.ai.dailyRequestLimitPerChild) return 'quota';
    const budgetMicros = Math.round(settings.ai.monthlyBudgetEur * MICROS_PER_EUR);
    const monthStart = monthStartUtc(now);
    const spent = await this.deps.requests.sumCostMicros(ctx.parentId, monthStart);
    if (spent >= budgetMicros) return 'budget';
    if (spent >= BUDGET_WARNING_RATIO * budgetMicros && !(await this.deps.alerts.existsSince(ctx.parentId, 'budget_warning', monthStart))) {
      await this.alert(ctx, 'budget_warning', ALERT_DETAILS_FR.budgetWarning(spent / MICROS_PER_EUR, settings.ai.monthlyBudgetEur), monthStart);
    }
    return null;
  }

  private async cacheKey(ctx: RequestCtx, identity: CacheIdentity, provider: AIProvider | null, tier: AITier): Promise<string> {
    return aiCacheKey({
      documentHash: ctx.documentHash,
      scope: identity.scope,
      operation: ctx.op,
      inputHash: identity.inputHash,
      profileSignature: profileSignature(ctx.learner),
      promptVersion: PROMPT_VERSION,
      model: identity.modelIndependent || !provider ? 'any' : provider.model(tier),
    });
  }

  /** Quota or budget reached: an answer already paid for is still served. */
  private async cachedForUnavailable(ctx: RequestCtx, plan: Plan, route: AIRoute): Promise<AIRouterOutcome | null> {
    if (!plan.cacheIdentity || route === 'local') return null;
    const provider = this.deps.providers[route];
    if (!plan.cacheIdentity.modelIndependent && !provider) return null;
    const key = await this.cacheKey(ctx, plan.cacheIdentity, provider, route);
    const hit = await this.deps.cache.get(key, this.deps.now());
    if (!hit || hit.validationStatus === 'blocked') return null;
    const result = this.fromCache(ctx, plan, route, hit.output);
    if (!result) return null;
    return this.finish(ctx, plan, result, { ...this.noUsage(), provider: hit.provider, model: hit.model }, { route, cacheHit: true });
  }

  private async localOrUnavailable(ctx: RequestCtx, plan: Plan, reason: AIUnavailableReason, dictionaryFallback: AIResult<unknown> | null): Promise<AIRouterOutcome> {
    if (plan.local && this.local.supports(ctx.op)) {
      if (plan.summarizeStage === 'chunk' && plan.cacheIdentity) {
        const key = await this.cacheKey(ctx, plan.cacheIdentity, null, 'light');
        const hit = await this.deps.cache.get(key, this.deps.now());
        const cached = hit && hit.validationStatus !== 'blocked' ? this.fromCache(ctx, plan, 'local', hit.output) : null;
        if (hit && cached) return this.finish(ctx, plan, cached, { ...this.noUsage(), provider: hit.provider, model: hit.model }, { route: 'local', cacheHit: true });
        const local = plan.local();
        if (local) {
          await this.deps.cache.put({
            cacheKey: key, operation: ctx.op, provider: 'local', model: 'deterministic', promptVersion: PROMPT_VERSION,
            inputHash: plan.cacheIdentity.inputHash, documentHash: ctx.documentHash, contentHash: plan.cacheIdentity.contentHash,
            output: { status: 'ok', data: local.data }, validationStatus: 'ok', createdAt: this.deps.now(), expiresAt: this.deps.now() + (this.deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS),
          });
          return this.finish(ctx, plan, this.ok(ctx, plan, 'local', false, local.data), { ...this.noUsage(), provider: 'local', model: 'deterministic' }, { route: 'local', cacheHit: false });
        }
      } else {
        const local = plan.local();
        if (local) {
          return this.finish(ctx, plan, this.ok(ctx, plan, 'local', false, local.data), { ...this.noUsage(), provider: 'local', model: 'deterministic' }, { route: 'local', cacheHit: false });
        }
      }
    }
    if (dictionaryFallback) {
      return this.finish(ctx, plan, dictionaryFallback, { ...this.noUsage(), provider: 'local', model: 'dictionary' }, { route: 'local', cacheHit: false });
    }
    const result: AIResult<unknown> = { status: 'unavailable', reason, message: unavailableMessage(reason), meta: null };
    return this.finish(ctx, plan, result, this.noUsage(), { route: 'local', cacheHit: false });
  }

  private fromCache(ctx: RequestCtx, plan: Plan, route: AIRoute, output: unknown): AIResult<unknown> | null {
    const stored = output as { status?: unknown; data?: unknown } | null;
    if (stored?.status === 'ok' && stored.data !== undefined) return this.ok(ctx, plan, route, true, stored.data);
    if (stored?.status === 'not_in_text') return { status: 'not_in_text', message: KID_MESSAGES.notInText, meta: this.meta(ctx, plan, route, true) };
    return null;
  }

  private startJob(ctx: RequestCtx, route: AITier, run: () => Promise<AIRouterOutcome>): Promise<AIRouterOutcome> {
    const jobId = newId();
    const now = this.deps.now();
    const deadlineMs = this.deadlines[route];
    const created = this.deps.jobs.create({
      id: jobId, parentId: ctx.parentId, childId: ctx.childId, operation: ctx.op, status: 'pending', result: null,
      createdAt: now, expiresAt: now + TIMINGS.aiJobTtlMs, deadlineMs,
    });
    const work = created.then(async () => {
      let status: 'done' | 'error' = 'done';
      let result: AIResult<unknown>;
      try {
        const outcome = await run();
        result = outcome.kind === 'result'
          ? outcome.body
          : { status: 'unavailable', reason: 'provider_error', message: KID_MESSAGES.unavailable, meta: null };
      } catch (err) {
        this.deps.logger.error('ai_job_failed', { operation: ctx.op, requestId: ctx.requestId, error: err });
        status = 'error';
        result = { status: 'unavailable', reason: 'provider_error', message: KID_MESSAGES.unavailable, meta: null };
      }
      await this.deps.jobs.complete(jobId, status, result, this.deps.now());
    }).catch((err: unknown) => {
      this.deps.logger.error('ai_job_store_failed', { operation: ctx.op, requestId: ctx.requestId, error: err });
    });
    this.inflightJobs.add(work);
    void work.finally(() => this.inflightJobs.delete(work));
    // §17.4: the client keeps polling until the deadline of the route + the stale margin.
    const waitMs = deadlineMs + TIMINGS.aiJobStaleMarginMs;
    return created.then(() => ({ kind: 'job', httpStatus: 202, body: { status: 'pending', jobId, pollAfterMs: TIMINGS.aiJobPollMs, waitMs } }));
  }

  /** Complex route answered from cache: still a 202 job (already done) so that the client flow stays uniform. */
  private async completedJob(ctx: RequestCtx, outcome: AIRouterOutcome): Promise<AIRouterOutcome> {
    if (outcome.kind !== 'result') return outcome;
    const jobId = newId();
    const now = this.deps.now();
    await this.deps.jobs.create({
      id: jobId, parentId: ctx.parentId, childId: ctx.childId, operation: ctx.op, status: 'done', result: outcome.body,
      createdAt: now, expiresAt: now + TIMINGS.aiJobTtlMs,
    });
    return { kind: 'job', httpStatus: 202, body: { status: 'pending', jobId, pollAfterMs: 0 } };
  }

  private async execute(
    ctx: RequestCtx, plan: Plan, provider: AIProvider, route: AITier, cacheKey: string | null, injectionSuspected: boolean, clientSignal: AbortSignal | undefined,
  ): Promise<AIRouterOutcome> {
    const deadline = this.deadlines[route];
    const startedAt = this.deps.now();
    const controller = new AbortController();
    let deadlineHit = false;
    let clientGone = false;
    const timer = setTimeout(() => {
      deadlineHit = true;
      controller.abort(new DeadlineAbort('deadline'));
    }, deadline);
    const onClientAbort = (): void => {
      clientGone = true;
      controller.abort(new ClientAbort('client_closed'));
    };
    if (clientSignal?.aborted) onClientAbort();
    else clientSignal?.addEventListener('abort', onClientAbort, { once: true });

    const usage: Usage = { provider: provider.id, model: provider.model(route), inputTokens: null, outputTokens: null, costMicros: null };
    let feedback: string[] | null = null;
    let lastFailure: { stages: ValidationStage[]; issues: GuardIssue[] } | null = null;
    try {
      for (const attempt of [1, 2] as const) {
        const remaining = deadline - (this.deps.now() - startedAt);
        if (attempt === 2 && (controller.signal.aborted || remaining < (this.deps.minRetryMs ?? DEFAULT_MIN_RETRY_MS))) break;
        let response: ProviderResponse<{ status: ModelStatus }>;
        try {
          response = await plan.call(provider, {
            operation: ctx.op, parentId: ctx.parentId, tier: route, learner: ctx.learner, signal: controller.signal, retryFeedback: feedback,
            deadlineMs: Math.max(1, remaining), injectionSuspected,
          });
        } catch (err) {
          if (clientGone) return this.finishAborted(ctx, plan, usage, route);
          const kind = isAITransportError(err) ? err.kind : null;
          const reason: AIUnavailableReason = deadlineHit || kind === 'timeout' ? 'timeout' : kind === 'rate_limited' ? 'busy' : 'provider_error';
          this.deps.logger.warn('ai_provider_error', { operation: ctx.op, requestId: ctx.requestId, kind: kind ?? 'unknown', attempt });
          const result: AIResult<unknown> = { status: 'unavailable', reason, message: unavailableMessage(reason), meta: this.meta(ctx, plan, route, false) };
          return this.finish(ctx, plan, result, usage, { route, cacheHit: false, rejectionDetail: `transport:${kind ?? 'unknown'}` });
        }
        usage.model = response.model || usage.model;
        usage.inputTokens = addNullable(usage.inputTokens, response.inputTokens);
        usage.outputTokens = addNullable(usage.outputTokens, response.outputTokens);
        usage.costMicros = addNullable(usage.costMicros, response.costMicros);

        if (response.refusal || response.parsed?.status === 'cannot_help') {
          await this.markChunkBlocked(ctx, plan, cacheKey, usage);
          return this.finish(ctx, plan, { status: 'blocked', reason: 'refusal', message: KID_MESSAGES.blocked, meta: this.meta(ctx, plan, route, false) }, usage, {
            route, cacheHit: false, rejectionDetail: response.refusal ? 'refusal' : 'cannot_help',
          });
        }
        if (response.parsed?.status === 'not_in_text') {
          if (ctx.op === 'recognize_handwriting') {
            return this.finish(ctx, plan, { status: 'not_in_text', message: AI_KID_MESSAGES_FR.handwritingUnreadable, meta: this.meta(ctx, plan, route, false) }, usage, { route, cacheHit: false });
          }
          if (cacheKey) await this.putCache(ctx, plan, cacheKey, usage, { status: 'not_in_text' }, 'not_in_text');
          return this.finish(ctx, plan, { status: 'not_in_text', message: KID_MESSAGES.notInText, meta: this.meta(ctx, plan, route, false) }, usage, { route, cacheHit: false });
        }

        const outcome: ValidationOutcome<unknown> = response.parsed
          ? plan.validate(response.parsed, {
            learner: ctx.learner, safetyLevel: ctx.settings.safety.level, selfReferenceTerms: provider.selfReferenceTerms,
            isKnownWord: (w) => this.deps.isKnownWord(w), attempt,
          })
          : {
            ok: false, stages: ['schema'],
            issues: [{
              code: response.truncated ? 'schema_truncated' : 'schema_invalid', detail: 'json',
              feedback: response.truncated ? 'Ta réponse était trop longue et a été coupée : fais plus court.' : 'Ta réponse doit être un objet JSON complet et conforme au schéma.',
            }],
          };

        if (outcome.ok) {
          if (ctx.op === 'recognize_handwriting') {
            const blocked = await this.checkRecognizedText(ctx, plan, route, (outcome.data as { text: string }).text, usage);
            if (blocked) return blocked;
          }
          if (cacheKey) await this.putCache(ctx, plan, cacheKey, usage, { status: 'ok', data: outcome.data }, outcome.readabilityWarning ? 'readability_warning' : 'ok');
          return this.finish(ctx, plan, this.ok(ctx, plan, route, false, outcome.data), usage, {
            route, cacheHit: false, readabilityWarning: outcome.readabilityWarning,
            rejectionDetail: outcome.droppedQuestions > 0 ? `dropped_questions:${outcome.droppedQuestions}` : null,
          });
        }
        lastFailure = outcome;
        feedback = feedbackOf(outcome.issues);
        this.deps.logger.info('ai_validation_failed', { operation: ctx.op, requestId: ctx.requestId, attempt, detail: rejectionDetailOf(outcome.stages, outcome.issues) });
      }

      if (clientGone && lastFailure === null) return this.finishAborted(ctx, plan, usage, route);
      const stages: ValidationStage[] = lastFailure?.stages ?? ['schema'];
      const unsafe = stages.includes('safety') || stages.includes('injection');
      const reason: AIBlockedReason = unsafe ? 'safety_output' : 'validation';
      const detail = rejectionDetailOf(stages, lastFailure?.issues ?? []);
      if (unsafe) {
        const ref = (await sha256Hex(JSON.stringify([ctx.op, plan.documentTexts, plan.childTexts, detail]))).slice(0, 12);
        const safetyStage = stages.includes('safety');
        await this.alert(ctx, safetyStage ? 'safety_output' : 'injection_detected', safetyStage ? ALERT_DETAILS_FR.safetyOutput(ctx.op, ref) : ALERT_DETAILS_FR.injectionOutput(ctx.op, ref));
      }
      await this.markChunkBlocked(ctx, plan, cacheKey, usage);
      return this.finish(ctx, plan, { status: 'blocked', reason, message: KID_MESSAGES.blocked, meta: this.meta(ctx, plan, route, false) }, usage, {
        route, cacheHit: false, rejectionDetail: detail,
      });
    } finally {
      clearTimeout(timer);
      clientSignal?.removeEventListener('abort', onClientAbort);
    }
  }

  private async checkRecognizedText(ctx: RequestCtx, plan: Plan, route: AIRoute, text: string, usage: Usage): Promise<AIRouterOutcome | null> {
    const verdict = checkInputSafety({ childTexts: [text], documentTexts: [], level: ctx.settings.safety.level });
    if (verdict.verdict === 'ok') return null;
    if (verdict.verdict === 'adult_redirect') {
      await this.alert(ctx, 'adult_redirect', ALERT_DETAILS_FR.adultRedirect(ctx.op, text));
      return this.finish(ctx, plan, { status: 'blocked', reason: 'adult_redirect', message: KID_MESSAGES.adultRedirect, meta: this.meta(ctx, plan, route, false) }, usage, { route, cacheHit: false, rejectionDetail: 'recognized_text' });
    }
    if (verdict.verdict === 'block') await this.alert(ctx, 'safety_input', ALERT_DETAILS_FR.safetyInputChild(ctx.op, text));
    const message = verdict.verdict === 'strict' ? KID_MESSAGES.strict : KID_MESSAGES.blocked;
    return this.finish(ctx, plan, { status: 'blocked', reason: 'safety_input', message, meta: this.meta(ctx, plan, route, false) }, usage, { route, cacheHit: false, rejectionDetail: `recognized_text:${verdict.verdict}` });
  }

  private async putCache(ctx: RequestCtx, plan: Plan, cacheKey: string, usage: Usage, output: unknown, status: 'ok' | 'not_in_text' | 'readability_warning' | 'blocked'): Promise<void> {
    if (!plan.cacheIdentity) return;
    const now = this.deps.now();
    try {
      await this.deps.cache.put({
        cacheKey, operation: ctx.op, provider: usage.provider, model: usage.model, promptVersion: PROMPT_VERSION,
        inputHash: plan.cacheIdentity.inputHash, documentHash: ctx.documentHash, contentHash: plan.cacheIdentity.contentHash,
        output, validationStatus: status, createdAt: now, expiresAt: now + (this.deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS),
      });
    } catch (err) {
      this.deps.logger.error('ai_cache_write_failed', { operation: ctx.op, requestId: ctx.requestId, error: err });
    }
  }

  private async markChunkBlocked(ctx: RequestCtx, plan: Plan, cacheKey: string | null, usage: Usage): Promise<void> {
    if (!plan.markBlocked || !plan.cacheIdentity) return;
    const key = cacheKey ?? (await this.cacheKey(ctx, plan.cacheIdentity, null, 'light'));
    await this.putCache(ctx, plan, key, usage, { status: 'blocked' }, 'blocked');
  }

  private async blocked(ctx: RequestCtx, plan: Plan, reason: AIBlockedReason, message: string, detail: string): Promise<AIRouterOutcome> {
    await this.markChunkBlocked(ctx, plan, null, this.noUsage());
    const result: AIResult<unknown> = { status: 'blocked', reason, message, meta: this.meta(ctx, plan, 'local', false) };
    return this.finish(ctx, plan, result, this.noUsage(), { route: 'local', cacheHit: false, rejectionDetail: detail });
  }

  private async alert(ctx: RequestCtx, kind: SafetyAlertInput['kind'], detail: string, dedupSince?: number): Promise<void> {
    try {
      await this.deps.alerts.insertOnce({
        parentId: ctx.parentId, childId: ctx.childId, documentId: ctx.documentId, kind, detail, createdAt: this.deps.now(),
        ...(dedupSince !== undefined ? { dedupSince } : {}),
      });
    } catch (err) {
      this.deps.logger.error('ai_alert_write_failed', { kind, requestId: ctx.requestId, error: err });
    }
  }

  // ---------------------------------------------------------------- results & log

  private meta(ctx: RequestCtx, plan: Plan, route: AIRoute, cached: boolean): AIMeta {
    return { cached, route, promptVersion: PROMPT_VERSION, sourceWarning: plan.sourceWarning, requestId: ctx.requestId };
  }

  private ok(ctx: RequestCtx, plan: Plan, route: AIRoute, cached: boolean, data: unknown): AIResult<unknown> {
    return { status: 'ok', data, meta: this.meta(ctx, plan, route, cached) };
  }

  private noUsage(): Usage {
    return { provider: 'none', model: '', inputTokens: null, outputTokens: null, costMicros: null };
  }

  private async finishAborted(ctx: RequestCtx, plan: Plan, usage: Usage, route: AIRoute): Promise<AIRouterOutcome> {
    await this.log(ctx, plan, 'aborted', usage, { route, cacheHit: false, rejectionReason: 'client_closed' });
    return { kind: 'aborted' };
  }

  private async finish(
    ctx: RequestCtx, plan: Plan, result: AIResult<unknown>, usage: Usage,
    info: { route: AIRoute; cacheHit: boolean; readabilityWarning?: boolean; rejectionDetail?: string | null },
  ): Promise<AIRouterOutcome> {
    const rejectionReason = result.status === 'blocked' || result.status === 'unavailable' ? result.reason : null;
    await this.log(ctx, plan, result.status, usage, { ...info, rejectionReason });
    return { kind: 'result', httpStatus: 200, body: result };
  }

  private async log(
    ctx: RequestCtx, plan: Plan, status: AIRequestStatus, usage: Usage,
    info: { route: AIRoute; cacheHit: boolean; readabilityWarning?: boolean; rejectionReason: string | null; rejectionDetail?: string | null },
  ): Promise<void> {
    const record: AIRequestRecord = {
      id: ctx.requestId, parentId: ctx.parentId, childId: ctx.childId, documentId: ctx.documentId, operation: ctx.op,
      route: info.route, provider: usage.provider, model: usage.model, promptVersion: PROMPT_VERSION, cacheHit: info.cacheHit,
      status, rejectionReason: info.rejectionReason, rejectionDetail: info.rejectionDetail ?? null, inputChars: plan.inputChars,
      inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costMicros: usage.costMicros,
      readabilityWarning: info.readabilityWarning ?? false, durationMs: this.deps.now() - ctx.startedAt, createdAt: ctx.startedAt,
    };
    try {
      await this.deps.requests.insert(record);
    } catch (err) {
      this.deps.logger.error('ai_request_log_failed', { operation: ctx.op, requestId: ctx.requestId, error: err });
    }
  }
}

/** First millisecond of the UTC day containing `now` (daily quota). */
export function dayStartUtc(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
