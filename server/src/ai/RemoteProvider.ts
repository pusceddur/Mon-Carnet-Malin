// Provider-neutral AIProvider built on an AITransport (§15.1): French prompts, JSON Schema, zod parsing.
import type {
  CorrectAnswerRequest, CorrectWritingRequest, ExplainTextRequest, ExplainWordRequest, FreeQuestionRequest, GenerateQuestionsRequest, QuestionOnTextRequest,
  RecognizeHandwritingRequest, SimplifyTextRequest, SummaryLevel, TextChunk,
} from '@aide/shared';
import type { z } from 'zod';
import type { AIProvider, ProviderCallContext, ProviderId, ProviderResponse, SummarizeFinalInput } from './AIProvider';
import type { AITier, AITransport, AITransportOperation, AITransportRequest } from './plugin';
import {
  chunkDocumentBlock, chunkSummariesBlock, correctAnswerUserText, documentBlock, explainTextUserText, explainWordUserText,
  correctWritingUserText, freeQuestionUserText, generateQuestionsUserText, handwritingUserText, plainDocumentBlock, questionOnTextUserText, simplifyUserText,
  summarizeChunkUserText, summarizeFinalUserText, type UserTextOptions,
} from './prompts/build.fr';
import { systemPrompt } from './prompts/system.fr';
import {
  MODEL_SCHEMA_BY_TRANSPORT_OPERATION, modelJsonSchema, type ModelAnswer, type ModelChunkSummary, type ModelCorrection, type ModelExplanation,
  type ModelFreeAnswer, type ModelHandwriting, type ModelQuestions, type ModelSimplification, type ModelSummary, type ModelWriting,
} from './schemas';

/** Output token budgets per operation (the transport may add thinking headroom on the complex tier). */
export const MAX_OUTPUT_TOKENS: Record<AITransportOperation, number> = {
  explain_word: 700,
  explain_text: 1000,
  simplify_text: 2500,
  summarize: 2500,
  summarize_chunk: 1200,
  summarize_final: 2500,
  generate_questions: 6000,
  correct_answer: 800,
  question_on_text: 900,
  recognize_handwriting: 600,
  free_question: 900,
  correct_writing: 3000,
};

interface CallSpec {
  operation: AITransportOperation;
  documentText: string | null;
  userText: string;
  images?: AITransportRequest['images'];
}

export interface RemoteProviderOptions {
  /** Pass the owner of the request to the transport (built-in worker queue only). */
  forwardParentId?: boolean;
}

export class RemoteProvider implements AIProvider {
  constructor(
    private readonly transport: AITransport,
    readonly id: ProviderId = 'plugin',
    private readonly options: RemoteProviderOptions = {},
  ) {}

  get selfReferenceTerms(): readonly string[] {
    return this.transport.selfReferenceTerms;
  }

  isConfigured(): boolean {
    return this.transport.isConfigured();
  }

  supportsTier(tier: AITier): boolean {
    return this.transport.isConfigured() && this.transport.supports(tier);
  }

  async refresh(): Promise<void> {
    try {
      await this.transport.refresh?.();
    } catch {
      // Availability stays as cached.
    }
  }

  /** Cache-key model label: the transport name + tier (the exact model id is only known after a call). */
  model(tier: AITier): string {
    return `${this.transport.name}:${tier}`;
  }

  private userTextOptions(ctx: ProviderCallContext): UserTextOptions {
    return { learner: ctx.learner, retryFeedback: ctx.retryFeedback, injectionSuspected: ctx.injectionSuspected };
  }

  private async call<S extends z.ZodType>(spec: CallSpec, schema: S, ctx: ProviderCallContext): Promise<ProviderResponse<z.output<S>>> {
    const response = await this.transport.complete({
      tier: ctx.tier,
      operation: spec.operation,
      system: systemPrompt(spec.operation),
      documentText: spec.documentText,
      userText: spec.userText,
      jsonSchema: modelJsonSchema(spec.operation),
      maxOutputTokens: MAX_OUTPUT_TOKENS[spec.operation],
      ...(spec.images ? { images: spec.images } : {}),
      signal: ctx.signal,
      deadlineMs: ctx.deadlineMs,
      ...(this.options.forwardParentId && ctx.parentId !== undefined ? { parentId: ctx.parentId } : {}),
    });
    let parsed: z.output<S> | null = null;
    if (!response.refusal && response.json !== null && response.json !== undefined) {
      const result = schema.safeParse(response.json);
      parsed = result.success ? result.data : null;
    }
    return {
      raw: response.json,
      parsed,
      refusal: response.refusal,
      truncated: response.truncated,
      model: response.model,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      costMicros: response.costMicros,
    };
  }

  explainWord(req: ExplainWordRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelExplanation>> {
    const context = req.paragraph.trim() !== '' ? req.paragraph : req.sentence.trim() !== '' ? req.sentence : req.word;
    return this.call({
      operation: 'explain_word',
      documentText: plainDocumentBlock(context),
      userText: explainWordUserText(req.word, req.sentence, this.userTextOptions(ctx)),
    }, MODEL_SCHEMA_BY_TRANSPORT_OPERATION.explain_word, ctx);
  }

  explainText(req: ExplainTextRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelExplanation>> {
    const context = req.paragraph.trim() !== '' && req.paragraph.length >= req.text.length ? req.paragraph : req.text;
    return this.call({
      operation: 'explain_text',
      documentText: plainDocumentBlock(context),
      userText: explainTextUserText(req.text, this.userTextOptions(ctx)),
    }, MODEL_SCHEMA_BY_TRANSPORT_OPERATION.explain_text, ctx);
  }

  simplifyText(req: SimplifyTextRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelSimplification>> {
    return this.call({
      operation: 'simplify_text',
      documentText: plainDocumentBlock(req.text),
      userText: simplifyUserText(this.userTextOptions(ctx)),
    }, MODEL_SCHEMA_BY_TRANSPORT_OPERATION.simplify_text, ctx);
  }

  summarizeChunk(chunk: TextChunk, level: SummaryLevel, ctx: ProviderCallContext): Promise<ProviderResponse<ModelChunkSummary>> {
    return this.call({
      operation: 'summarize_chunk',
      documentText: chunkDocumentBlock(chunk),
      userText: summarizeChunkUserText(chunk.chunkIndex, level, this.userTextOptions(ctx)),
    }, MODEL_SCHEMA_BY_TRANSPORT_OPERATION.summarize_chunk, ctx);
  }

  summarizeFinal(input: SummarizeFinalInput, ctx: ProviderCallContext): Promise<ProviderResponse<ModelSummary>> {
    return this.call({
      operation: 'summarize_final',
      documentText: chunkSummariesBlock(input.chunks),
      userText: summarizeFinalUserText(input.chunks.length, input.level, this.userTextOptions(ctx)),
    }, MODEL_SCHEMA_BY_TRANSPORT_OPERATION.summarize_final, ctx);
  }

  generateQuestions(req: GenerateQuestionsRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelQuestions>> {
    return this.call({
      operation: 'generate_questions',
      documentText: documentBlock(req.pages),
      userText: generateQuestionsUserText(req, this.userTextOptions(ctx)),
    }, MODEL_SCHEMA_BY_TRANSPORT_OPERATION.generate_questions, ctx);
  }

  correctAnswer(req: CorrectAnswerRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelCorrection>> {
    return this.call({
      operation: 'correct_answer',
      documentText: documentBlock(req.pages),
      userText: correctAnswerUserText(req, this.userTextOptions(ctx)),
    }, MODEL_SCHEMA_BY_TRANSPORT_OPERATION.correct_answer, ctx);
  }

  answerQuestion(req: QuestionOnTextRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelAnswer>> {
    return this.call({
      operation: 'question_on_text',
      documentText: documentBlock(req.pages),
      userText: questionOnTextUserText(req, this.userTextOptions(ctx)),
    }, MODEL_SCHEMA_BY_TRANSPORT_OPERATION.question_on_text, ctx);
  }

  recognizeHandwriting(req: RecognizeHandwritingRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelHandwriting>> {
    return this.call({
      operation: 'recognize_handwriting',
      documentText: null,
      userText: handwritingUserText(this.userTextOptions(ctx)),
      images: [{ mediaType: 'image/png', base64: req.imagePngBase64 }],
    }, MODEL_SCHEMA_BY_TRANSPORT_OPERATION.recognize_handwriting, ctx);
  }

  /** No document: the (untrusted) question goes in the variable user text, inside its own tags. */
  answerFreeQuestion(req: FreeQuestionRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelFreeAnswer>> {
    return this.call({
      operation: 'free_question',
      documentText: null,
      userText: freeQuestionUserText(req, this.userTextOptions(ctx)),
    }, MODEL_SCHEMA_BY_TRANSPORT_OPERATION.free_question, ctx);
  }

  /** No document: the child's lines go in the variable user text, inside their own tags. */
  correctWriting(req: CorrectWritingRequest, ctx: ProviderCallContext): Promise<ProviderResponse<ModelWriting>> {
    return this.call({
      operation: 'correct_writing',
      documentText: null,
      userText: correctWritingUserText(req.text, this.userTextOptions(ctx)),
    }, MODEL_SCHEMA_BY_TRANSPORT_OPERATION.correct_writing, ctx);
  }
}
