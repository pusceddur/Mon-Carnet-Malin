import type { Id, Millis } from './domain';

export type QuestionType = 'qcm' | 'vrai_faux' | 'reponse_libre' | 'association' | 'ordre';
export interface SourceRef { pageIndex: number; quote: string }
interface QuestionBase { id: string; prompt: string; source: SourceRef }
export type Question =
  | (QuestionBase & { type: 'qcm'; choices: string[]; correctIndex: number; explanation: string })
  | (QuestionBase & { type: 'vrai_faux'; answer: boolean; explanation: string })
  | (QuestionBase & { type: 'reponse_libre'; expectedAnswer: string; keyPoints: string[] })
  | (QuestionBase & { type: 'association'; pairs: { left: string; right: string }[] })
  | (QuestionBase & { type: 'ordre'; itemsInOrder: string[] });
export interface Exercise {
  id: Id; childId: Id; documentId: Id; pageIndexes: number[];
  questions: Question[]; origin: 'ai' | 'local';
  createdAt: Millis; updatedAt: Millis; deletedAt: Millis | null;
}
export type AnswerResponse =
  | { type: 'qcm'; choiceIndex: number }
  | { type: 'vrai_faux'; value: boolean }
  | { type: 'reponse_libre'; text: string }
  | { type: 'association'; pairs: { left: string; right: string }[] }
  | { type: 'ordre'; items: string[] };
export type Verdict = 'correct' | 'partiel' | 'incorrect';
export interface Answer {
  id: Id; exerciseId: Id; questionId: string; childId: Id;
  response: AnswerResponse; inputMethod: 'toucher' | 'clavier' | 'ecriture' | 'dictee';
  inkAnnotationId: Id | null;
  verdict: Verdict | null; feedback: string | null; correctedBy: 'local' | 'ai' | null;
  rereadRef: SourceRef | null;
  createdAt: Millis; updatedAt: Millis;
}
