// Provider contract (§8.1 amended by §15.1/§15.4): providers never receive the child's name or id, only an AILearner.
import type {
  AILearner, AIOperation, ChunkSummaryData, CorrectAnswerRequest, ExplainTextRequest, ExplainWordRequest, GenerateQuestionsRequest,
  QuestionOnTextRequest, RecognizeHandwritingRequest, SimplifyTextRequest, SummaryLevel, TextChunk,
} from '@aide/shared';
import type { AITier } from './plugin';
import type {
  ModelAnswer, ModelChunkSummary, ModelCorrection, ModelExplanation, ModelHandwriting, ModelQuestions, ModelSimplification, ModelSummary,
} from './schemas';

export type ProviderId = 'plugin' | 'local' | 'mock' | 'worker';

export interface ProviderCallContext {
  operation: AIOperation;
  /** Owner of the request (job ownership in the worker queue); never sent to an external provider. */
  parentId?: string;
  tier: AITier;
  learner: AILearner;
  signal: AbortSignal;
  /** French feedback from the validators for the single regeneration, null on the first attempt. */
  retryFeedback: string[] | null;
  /** Time left before the end-to-end deadline (regeneration included). */
  deadlineMs: number;
  /** The document contains instruction-like sentences (already wrapped in ⟦ ⟧ by the router). */
  injectionSuspected: boolean;
}

export interface ProviderResponse<T> {
  raw: unknown;
  parsed: T | null;
  refusal: boolean;
  truncated: boolean;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicros: number | null;
}

export interface SummarizeFinalInput {
  level: SummaryLevel;
  chunks: ChunkSummaryData[];
}

export interface AIProvider {
  readonly id: ProviderId;
  isConfigured(): boolean;
  supportsTier(tier: AITier): boolean;
  /** Optional: refreshes the cached availability read by `supportsTier` (never throws). */
  refresh?(): Promise<void>;
  model(tier: AITier): string;
  /** Brand/model names the provider could use to talk about itself (SafetyGuard). */
  readonly selfReferenceTerms: readonly string[];
  explainWord(req: ExplainWordRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelExplanation>>;
  explainText(req: ExplainTextRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelExplanation>>;
  simplifyText(req: SimplifyTextRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelSimplification>>;
  summarizeChunk(chunk: TextChunk, level: SummaryLevel, ctx: ProviderCallContext): Promise<ProviderResponse<ModelChunkSummary>>;
  summarizeFinal(input: SummarizeFinalInput, ctx: ProviderCallContext): Promise<ProviderResponse<ModelSummary>>;
  generateQuestions(req: GenerateQuestionsRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelQuestions>>;
  correctAnswer(req: CorrectAnswerRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelCorrection>>;
  answerQuestion(req: QuestionOnTextRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelAnswer>>;
  recognizeHandwriting(req: RecognizeHandwritingRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelHandwriting>>;
}
