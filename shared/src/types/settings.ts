import type { Millis } from './domain';

export type SafetyLevel = 'standard' | 'strict';

// §15.10 (replaces §5 settings.ts). Defaults in DEFAULT_PARENT_SETTINGS (constants.ts).
export interface ParentSettings {
  ai: {
    enabled: boolean;                                   // default true
    features: { explainWord: boolean; explainText: boolean; simplify: boolean; summarize: boolean;
                questions: boolean; correctAnswers: boolean; questionOnText: boolean };  // default all true
    dailyRequestLimitPerChild: number;                  // default 60
    monthlyBudgetEur: number;                           // default 10
    allowComplexModel: boolean;                         // default true (if false: complex -> LocalProvider)
    deepQuestions: boolean;                             // default false (question_on_text may use the complex route)
    handwritingRecognition: boolean;                    // default false (C3)
  };
  ocr: { autoServerFallback: boolean /*default true*/; lowConfidenceThreshold: number /*default 70*/; aiTranscription: boolean /*default true, §17*/ };
  privacy: { syncAnnotations: boolean /*true*/; syncDocumentText: boolean /*true*/; uploadPageImages: boolean /*true*/; uploadOriginals: boolean /*false*/ };
  safety: { level: SafetyLevel /*'standard'*/ };
  reader: { freeSelection: boolean /*false*/ };
  updatedAt: Millis;
}
