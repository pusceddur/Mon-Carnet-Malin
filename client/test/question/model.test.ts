import { DEFAULT_PARENT_SETTINGS, KID_MESSAGES, LIMITS, PROMPT_VERSION, type AIMeta, type ParentSettings } from '@aide/shared';
import { describe, expect, it } from 'vitest';
import {
  buildFreeQuestionRequest,
  cleanQuestion,
  freeQuestionEnabled,
  isAskable,
  spokenAnswer,
  toQuestionOutcome,
  usableSuggestions,
} from '../../src/features/question/model';

const META: AIMeta = { cached: false, route: 'light', promptVersion: PROMPT_VERSION, sourceWarning: false, requestId: 'r1' };

function settings(ai: Partial<ParentSettings['ai']> = {}, features: Partial<ParentSettings['ai']['features']> = {}): ParentSettings {
  return {
    ...DEFAULT_PARENT_SETTINGS,
    ai: { ...DEFAULT_PARENT_SETTINGS.ai, ...ai, features: { ...DEFAULT_PARENT_SETTINGS.ai.features, ...features } },
  };
}

describe('free question model', () => {
  it('is enabled by default, off with the flag or with the AI, and on for settings cached before the flag existed', () => {
    expect(freeQuestionEnabled(null)).toBe(true);
    expect(freeQuestionEnabled(settings())).toBe(true);
    expect(freeQuestionEnabled(settings({}, { freeQuestion: false }))).toBe(false);
    expect(freeQuestionEnabled(settings({ enabled: false }))).toBe(false);
    const legacy = settings();
    delete (legacy.ai.features as Partial<ParentSettings['ai']['features']>).freeQuestion;
    expect(freeQuestionEnabled(legacy)).toBe(true);
  });

  it('cleans dictated questions and checks the length limit', () => {
    expect(cleanQuestion('  Pourquoi\nle ciel\t est bleu ?  ')).toBe('Pourquoi le ciel est bleu ?');
    expect(isAskable('   ')).toBe(false);
    expect(isAskable('a'.repeat(LIMITS.freeQuestionMaxChars))).toBe(true);
    expect(isAskable('a'.repeat(LIMITS.freeQuestionMaxChars + 1))).toBe(false);
  });

  it('builds a request without document, with the previous exchange bounded by the limits', () => {
    const request = buildFreeQuestionRequest('c1', {
      question: ' Et  les étoiles ? ',
      previous: { question: 'Pourquoi le ciel est bleu ?', answer: 'x'.repeat(LIMITS.answerMaxChars + 50) },
      mode: 'simpler',
    });
    expect(request).toEqual({
      childId: 'c1',
      documentId: null,
      documentHash: null,
      question: 'Et les étoiles ?',
      previous: { question: 'Pourquoi le ciel est bleu ?', answer: 'x'.repeat(LIMITS.answerMaxChars) },
      mode: 'simpler',
    });
    expect(buildFreeQuestionRequest('c1', { question: 'Bonjour ?', previous: null, mode: 'normal' }).previous).toBeNull();
  });

  it('keeps at most three distinct, askable suggestions', () => {
    expect(usableSuggestions(['A ?', ' ', 'A ?', 'x'.repeat(LIMITS.freeQuestionMaxChars + 1), 'B ?', 'C ?', 'D ?'])).toEqual(['A ?', 'B ?', 'C ?']);
  });

  it('maps every result to a child outcome, with the free-question messages by default', () => {
    const answer = toQuestionOutcome({ status: 'ok', data: { answer: ' Le ciel. ', example: '  ', suggestions: ['Et la mer ?'] }, meta: META });
    expect(answer).toEqual({ kind: 'answer', answer: 'Le ciel.', example: null, suggestions: ['Et la mer ?'] });
    expect(spokenAnswer({ kind: 'answer', answer: 'Réponse.', example: 'Exemple.', suggestions: [] })).toBe('Réponse.\nExemple.');

    expect(toQuestionOutcome({ status: 'blocked', reason: 'safety_input', message: '', meta: META }))
      .toEqual({ kind: 'blocked', message: KID_MESSAGES.questionBlocked });
    expect(toQuestionOutcome({ status: 'blocked', reason: 'adult_redirect', message: '', meta: META }))
      .toEqual({ kind: 'adult_redirect', message: KID_MESSAGES.questionAdultRedirect });
    expect(toQuestionOutcome({ status: 'blocked', reason: 'safety_input', message: KID_MESSAGES.questionStrict, meta: META }))
      .toEqual({ kind: 'blocked', message: KID_MESSAGES.questionStrict });

    expect(toQuestionOutcome({ status: 'unavailable', reason: 'offline', message: KID_MESSAGES.offline, meta: null }))
      .toEqual({ kind: 'unavailable', message: KID_MESSAGES.offline, offline: true, canRetry: true });
    expect(toQuestionOutcome({ status: 'unavailable', reason: 'quota', message: KID_MESSAGES.quota, meta: null }))
      .toMatchObject({ kind: 'unavailable', canRetry: false });
    expect(toQuestionOutcome({ status: 'unavailable', reason: 'feature_disabled', message: '', meta: null }))
      .toEqual({ kind: 'unavailable', message: KID_MESSAGES.unavailable, offline: false, canRetry: false });
    expect(toQuestionOutcome({ status: 'ok', data: { answer: '  ', example: null, suggestions: [] }, meta: META }))
      .toMatchObject({ kind: 'unavailable', canRetry: true });
  });
});
