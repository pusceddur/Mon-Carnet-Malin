// STUB: server-ai (interface from contract §8.1)
import type {
  AIOperation, AIPageInput, ChildProfile, CorrectAnswerRequest, ExplainTextRequest, ExplainWordRequest, GenerateQuestionsRequest,
  QuestionOnTextRequest, SimplifyTextRequest, SummaryLevel, TextChunk,
} from '@aide/shared';
import type {
  ModelAnswer, ModelChunkSummary, ModelCorrection, ModelExplanation, ModelQuestions, ModelSimplification, ModelSummary,
} from './schemas';

export type ProviderId = 'plugin' | 'local' | 'mock';
export interface ProviderCallContext { operation: AIOperation; tier: 'light' | 'complex'; child: ChildProfile; signal: AbortSignal; retryFeedback: string[] | null }
export interface ProviderResponse<T> { raw: unknown; parsed: T | null; refusal: boolean; model: string; inputTokens: number | null; outputTokens: number | null }
export interface AIProvider {
  readonly id: ProviderId;
  isConfigured(): boolean;
  model(tier: 'light' | 'complex'): string;
  explainWord(req: ExplainWordRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelExplanation>>;
  explainText(req: ExplainTextRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelExplanation>>;
  simplifyText(req: SimplifyTextRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelSimplification>>;
  summarizeChunk(chunk: TextChunk, level: SummaryLevel, ctx: ProviderCallContext): Promise<ProviderResponse<ModelChunkSummary>>;
  summarizeFinal(input: { level: SummaryLevel; chunkSummaries: string[]; pages: AIPageInput[] }, ctx: ProviderCallContext): Promise<ProviderResponse<ModelSummary>>;
  generateQuestions(req: GenerateQuestionsRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelQuestions>>;
  correctAnswer(req: CorrectAnswerRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelCorrection>>;
  answerQuestion(req: QuestionOnTextRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelAnswer>>;
}
