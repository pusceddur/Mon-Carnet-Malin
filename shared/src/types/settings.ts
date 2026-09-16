import type { Millis } from './domain';

export interface ParentSettings {
  ai: {
    enabled: boolean;                                   // default true
    features: { explainWord: boolean; explainText: boolean; simplify: boolean; summarize: boolean;
                questions: boolean; correctAnswers: boolean; questionOnText: boolean };  // default all true
    dailyRequestLimitPerChild: number;                  // default 60
    allowComplexModel: boolean;                         // default true (if false: complex -> LocalProvider)
    handwritingRecognition: boolean;                    // default false (C3)
  };
  ocr: { autoServerFallback: boolean /*default true*/; lowConfidenceThreshold: number /*default 70*/ };
  privacy: { syncAnnotations: boolean /*true*/; syncDocumentText: boolean /*true*/; uploadOriginals: boolean /*false*/ };
  updatedAt: Millis;
}
