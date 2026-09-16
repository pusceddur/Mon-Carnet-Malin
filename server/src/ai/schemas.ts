// STUB: server-ai
// JSON shapes produced by the model (to be defined by server-ai with zod + JSON schema). Placeholders only.
import type { SourceRef, Question, Verdict } from '@aide/shared';

export type ModelStatus = 'ok' | 'not_in_text' | 'cannot_help';

export interface ModelExplanation { status: ModelStatus; explanation: string; example: string | null; sourceQuotes: string[] }
export interface ModelSimplification { status: ModelStatus; simplifiedText: string }
export interface ModelChunkSummary { status: ModelStatus; summary: string; sourceQuotes: string[] }
export interface ModelSummary { status: ModelStatus; summary: string; keyPoints: string[]; sourceRefs: SourceRef[] }
export interface ModelQuestions { status: ModelStatus; questions: Question[] }
export interface ModelCorrection { status: ModelStatus; verdict: Verdict; feedback: string; rereadRef: SourceRef | null }
export interface ModelAnswer { status: ModelStatus; answer: string; sourceRefs: SourceRef[] }
