import {
  DEFAULT_EXERCISE_PREFERENCES, DEFAULT_READING_PREFERENCES, DEFAULT_TTS_PREFERENCES, type AIMeta, type Answer, type ChildProfile,
  type DocumentMeta, type Exercise, type InkAnnotation, type PageContent, type Question,
} from '@aide/shared';

type QuestionOf<T extends Question['type']> = Extract<Question, { type: T }>;

export const CHILD_ID = 'child-1';
export const DOC_ID = 'doc-1';

export function makeChild(overrides: Partial<ChildProfile> = {}): ChildProfile {
  return {
    id: CHILD_ID,
    parentId: 'parent-1',
    firstName: 'Léa',
    age: 10,
    avatar: '🦊',
    readingLevel: 'intermediaire',
    explanationDifficulty: 'simple',
    reading: { ...DEFAULT_READING_PREFERENCES },
    tts: { ...DEFAULT_TTS_PREFERENCES },
    exercises: { ...DEFAULT_EXERCISE_PREFERENCES, enabledTypes: [...DEFAULT_EXERCISE_PREFERENCES.enabledTypes] },
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...overrides,
  };
}

export function makeDoc(overrides: Partial<DocumentMeta> = {}): DocumentMeta {
  return {
    id: DOC_ID,
    ownerParentId: 'parent-1',
    childIds: [CHILD_ID],
    title: 'Le cycle de l’eau',
    kind: 'pdf',
    textMode: 'faithful',
    purpose: 'reading',
    homeworkDoneAt: null,
    sourceHash: 'a'.repeat(64),
    pageCount: 3,
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...overrides,
  };
}

export function makePage(pageIndex: number, text: string, overrides: Partial<PageContent> = {}): PageContent {
  return {
    documentId: DOC_ID,
    pageIndex,
    status: 'ready',
    textSource: 'pdf-text',
    blocks: text.length > 0 ? [{ kind: 'paragraph', text }] : [],
    confidence: null,
    contentHash: `hash-${pageIndex}`,
    width: null,
    height: null,
    warnings: [],
    updatedAt: 1,
    ...overrides,
  };
}

export const PAGE_TEXTS = [
  'Le soleil chauffe l’eau de la mer. L’eau devient de la vapeur.',
  'La vapeur monte dans le ciel et forme des nuages.',
  'Quand les nuages sont lourds, il pleut. L’eau retourne à la mer.',
];

export const QCM: QuestionOf<'qcm'> = {
  id: 'q1', type: 'qcm', prompt: 'Qui chauffe l’eau de la mer ?', choices: ['La lune', 'Le soleil', 'Le vent'], correctIndex: 1,
  explanation: 'Le texte dit que le soleil chauffe l’eau.', source: { pageIndex: 0, quote: 'Le soleil chauffe l’eau de la mer.' },
};
export const VRAI_FAUX: QuestionOf<'vrai_faux'> = {
  id: 'q2', type: 'vrai_faux', prompt: 'La vapeur descend dans la mer.', answer: false,
  explanation: 'La vapeur monte dans le ciel.', source: { pageIndex: 1, quote: 'La vapeur monte dans le ciel et forme des nuages.' },
};
export const ASSOCIATION: QuestionOf<'association'> = {
  id: 'q3', type: 'association', prompt: 'Relie chaque élément à ce qu’il fait.',
  pairs: [{ left: 'Le soleil', right: 'chauffe l’eau' }, { left: 'La vapeur', right: 'monte' }, { left: 'Les nuages', right: 'donnent la pluie' }],
  source: { pageIndex: 1, quote: 'La vapeur monte dans le ciel et forme des nuages.' },
};
export const ORDRE: QuestionOf<'ordre'> = {
  id: 'q4', type: 'ordre', prompt: 'Remets les étapes dans l’ordre.',
  itemsInOrder: ['L’eau devient de la vapeur.', 'La vapeur forme des nuages.', 'Il pleut.'],
  source: { pageIndex: 2, quote: 'Quand les nuages sont lourds, il pleut.' },
};
export const LIBRE: QuestionOf<'reponse_libre'> = {
  id: 'q5', type: 'reponse_libre', prompt: 'Pourquoi pleut-il ?', expectedAnswer: 'Parce que les nuages sont lourds.',
  keyPoints: ['les nuages', 'lourds'], source: { pageIndex: 2, quote: 'Quand les nuages sont lourds, il pleut.' },
};

export function makeExercise(questions: Question[], overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'ex-1', childId: CHILD_ID, documentId: DOC_ID, pageIndexes: [0, 1, 2], questions, origin: 'ai',
    createdAt: 100, updatedAt: 100, deletedAt: null, ...overrides,
  };
}

export function makeAnswer(questionId: string, overrides: Partial<Answer> = {}): Answer {
  return {
    id: `a-${questionId}`, exerciseId: 'ex-1', questionId, childId: CHILD_ID,
    response: { type: 'qcm', choiceIndex: 0 }, inputMethod: 'toucher', inkAnnotationId: null,
    verdict: 'correct', feedback: 'Bravo !', correctedBy: 'local', rereadRef: null,
    createdAt: 200, updatedAt: 200, ...overrides,
  };
}

export function makeInk(id: string, points: [number, number][], overrides: Partial<InkAnnotation> = {}): InkAnnotation {
  return {
    id, type: 'ink', childId: CHILD_ID, documentId: DOC_ID, tool: 'pencil', color: '#1f2937', width: 0.004, opacity: 1,
    space: { kind: 'answer', exerciseId: 'ex-1', questionId: 'q5' },
    points: points.map(([x, y]) => ({ x, y, p: 0.5 })),
    createdAt: 10, updatedAt: 10, deletedAt: null, ...overrides,
  };
}

export const META: AIMeta = { cached: false, route: 'light', promptVersion: 'test', sourceWarning: false, requestId: 'r1' };
