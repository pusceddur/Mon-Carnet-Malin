import { describe, expect, it } from 'vitest';
import { DEFAULT_EXERCISE_PREFERENCES, DEFAULT_READING_PREFERENCES, DEFAULT_TTS_PREFERENCES } from '../../src/constants';
import { syncEntityKey } from '../../src/sync/keys';
import type { Annotation } from '../../src/types/annotations';
import type { SyncChanges } from '../../src/types/api';
import type { Answer, Exercise } from '../../src/types/exercises';

describe('syncEntityKey', () => {
  it('builds composite keys for pages and progress', () => {
    const page: SyncChanges['pages'][number] = {
      documentId: 'doc-1', pageIndex: 12, status: 'ready', textSource: 'manual', blocks: [], confidence: null, contentHash: null,
      width: null, height: null, warnings: [], updatedAt: 5,
    };
    expect(syncEntityKey('pages', page)).toBe('doc-1:12');
    expect(syncEntityKey('progress', { childId: 'child-1', documentId: 'doc-1', pageIndex: 0, blockIndex: 0, sentenceIndex: 0, updatedAt: 1 })).toBe('child-1:doc-1');
  });

  it('uses the id for every other table', () => {
    const annotation: Annotation = {
      id: 'ann-1', type: 'highlight', childId: 'c', documentId: 'd', color: '#fde047', pageIndex: 0, blockIndex: 0, start: 0, end: 3,
      blockTextHash: 'h', text: 'Les', createdAt: 1, updatedAt: 1, deletedAt: null,
    };
    const exercise: Exercise = { id: 'ex-1', childId: 'c', documentId: 'd', pageIndexes: [0], questions: [], origin: 'local', createdAt: 1, updatedAt: 1, deletedAt: null };
    const answer: Answer = {
      id: 'ans-1', exerciseId: 'ex-1', questionId: 'local-1', childId: 'c', response: { type: 'vrai_faux', value: true }, inputMethod: 'toucher',
      inkAnnotationId: null, verdict: 'correct', feedback: 'Bravo', correctedBy: 'local', rereadRef: null, createdAt: 1, updatedAt: 1,
    };
    expect(syncEntityKey('annotations', annotation)).toBe('ann-1');
    expect(syncEntityKey('exercises', exercise)).toBe('ex-1');
    expect(syncEntityKey('answers', answer)).toBe('ans-1');
    expect(syncEntityKey('sessions', {
      id: 'ses-1', childId: 'c', documentId: 'd', startedAt: 1, endedAt: 2, pagesViewed: [], ttsSeconds: 0, wordsLookedUp: 0, aiRequests: 0, updatedAt: 2,
    })).toBe('ses-1');
    expect(syncEntityKey('documents', {
      id: 'doc-1', ownerParentId: 'p', childIds: [], title: 'Livre', kind: 'pdf', textMode: 'faithful', purpose: 'reading', homeworkDoneAt: null, sourceHash: 'x', pageCount: 1, status: 'ready',
      createdAt: 1, updatedAt: 1, deletedAt: null,
    })).toBe('doc-1');
    expect(syncEntityKey('children', {
      id: 'child-1', parentId: 'p', nickname: 'Léo', avatar: '🦊', readingLevel: 'intermediaire', explanationDifficulty: 'simple',
      reading: DEFAULT_READING_PREFERENCES, tts: DEFAULT_TTS_PREFERENCES, exercises: DEFAULT_EXERCISE_PREFERENCES, createdAt: 1, updatedAt: 1, deletedAt: null,
    })).toBe('child-1');
  });
});
