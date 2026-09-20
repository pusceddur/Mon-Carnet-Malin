import { KID_MESSAGES, LIMITS, PROMPT_VERSION, type AIMeta } from '@aide/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  countsAsAiRequest,
  messageFor,
  runDefinition,
  runExplain,
  runQuestion,
  runSimplify,
  type HelpDeps,
  type HelpTextContext,
} from '../../src/features/reader/helpActions';
import { help } from '../../src/i18n/fr/help';

const meta = (overrides: Partial<AIMeta> = {}): AIMeta => ({ cached: false, route: 'light', promptVersion: PROMPT_VERSION, sourceWarning: false, requestId: 'r', ...overrides });

function deps(overrides: Partial<HelpDeps> = {}): HelpDeps {
  return {
    requestAI: vi.fn(async () => ({ status: 'unavailable' as const, reason: 'offline' as const, message: KID_MESSAGES.offline, meta: null })) as unknown as HelpDeps['requestAI'],
    ...overrides,
  };
}

const ctx: HelpTextContext = {
  childId: 'child-1', documentId: 'doc-1', documentHash: null, pageIndex: 2, text: 'photosynthèse', isSingleWord: true,
  sentence: 'La photosynthèse nourrit la plante.', paragraph: 'La photosynthèse nourrit la plante. Elle pousse.', ocrLowConfidence: false,
};

describe('help actions', () => {
  it('definition: the AI defines the word in its sentence (explain_word), messages when it cannot', async () => {
    const requestAI = vi.fn(async () => ({ status: 'ok' as const, data: { explanation: 'Une montagne qui crache du feu.', example: 'Le volcan fume.', sourceQuotes: [] }, meta: meta() }));
    const outcome = await runDefinition({ ...ctx, text: 'volcans' }, {}, deps({ requestAI: requestAI as unknown as HelpDeps['requestAI'] }));
    expect(outcome).toEqual({
      kind: 'definition', headword: 'volcans', definition: 'Une montagne qui crache du feu.', example: 'Le volcan fume.', partOfSpeech: null, attribution: null, kidFriendly: true,
    });
    expect(requestAI).toHaveBeenCalledWith('explain_word', expect.objectContaining({ word: 'volcans', sentence: ctx.sentence, paragraph: ctx.paragraph, pageIndex: 2 }), expect.anything());
    expect(countsAsAiRequest('definition', outcome)).toBe(true);
    expect(await runDefinition(ctx, {}, deps())).toMatchObject({ kind: 'message', text: KID_MESSAGES.offline, canRetry: true });
  });

  it('explain: a single word is explained by the AI in its paragraph (explain_text), never from a local glossary', async () => {
    const requestAI = vi.fn(async () => ({ status: 'ok' as const, data: { explanation: 'Explication.', example: null, sourceQuotes: ['La photosynthèse'] }, meta: meta({ sourceWarning: true }) }));
    const d = deps({ requestAI: requestAI as unknown as HelpDeps['requestAI'] });
    const outcome = await runExplain(ctx, {}, d);
    expect(outcome).toMatchObject({ kind: 'explanation', text: 'Explication.', sourceWarning: true });
    expect(requestAI).toHaveBeenCalledWith('explain_text', expect.objectContaining({ text: 'photosynthèse', paragraph: ctx.paragraph, pageIndex: 2 }), expect.anything());
    expect(countsAsAiRequest('explain', outcome)).toBe(true);
  });

  it('explain: a passage goes to explain_text (clipped to the selection limit)', async () => {
    const requestAI = vi.fn(async () => ({ status: 'not_in_text' as const, message: '', meta: meta() }));
    const long = 'mot '.repeat(2000);
    const outcome = await runExplain({ ...ctx, text: long, isSingleWord: false }, {}, deps({ requestAI: requestAI as unknown as HelpDeps['requestAI'] }));
    expect(outcome).toEqual({ kind: 'message', text: KID_MESSAGES.notInText, tone: 'info', canRetry: false });
    const body = (requestAI.mock.calls[0] as unknown as [string, { text: string }])[1];
    expect((requestAI.mock.calls[0] as unknown as [string])[0]).toBe('explain_text');
    expect(body.text).toHaveLength(LIMITS.selectionMaxChars);
  });

  it('simplify: a single word is simplified within its sentence; low OCR confidence is flagged', async () => {
    const requestAI = vi.fn(async () => ({ status: 'ok' as const, data: { simplifiedText: 'La plante mange la lumière.' }, meta: meta() }));
    const outcome = await runSimplify({ ...ctx, ocrLowConfidence: true }, {}, deps({ requestAI: requestAI as unknown as HelpDeps['requestAI'] }));
    expect(outcome).toEqual({ kind: 'simplified', text: 'La plante mange la lumière.', sourceWarning: true });
    expect(requestAI).toHaveBeenCalledWith('simplify_text', expect.objectContaining({ text: ctx.sentence }), expect.anything());
  });

  it('question: refuses empty questions and books without text, then answers with source refs', async () => {
    const qctx = { childId: 'c', documentId: 'd', documentHash: null, pages: [{ pageIndex: 0, text: 'Le chat dort.', contentHash: 'a'.repeat(64), ocrLowConfidence: false }] };
    expect(await runQuestion(qctx, '   ', {}, deps())).toMatchObject({ kind: 'message', text: help.question.empty });
    expect(await runQuestion({ ...qctx, pages: [] }, 'Qui dort ?', {}, deps())).toMatchObject({ kind: 'message', text: help.question.noText });
    const requestAI = vi.fn(async () => ({ status: 'ok' as const, data: { answer: 'Le chat.', sourceRefs: [{ pageIndex: 0, quote: 'Le chat dort.' }] }, meta: meta() }));
    const outcome = await runQuestion(qctx, `${'x'.repeat(250)}`, {}, deps({ requestAI: requestAI as unknown as HelpDeps['requestAI'] }));
    expect(outcome).toEqual({ kind: 'answer', text: 'Le chat.', refs: [{ pageIndex: 0, quote: 'Le chat dort.' }], sourceWarning: false });
    const body = (requestAI.mock.calls[0] as unknown as [string, { question: string }])[1];
    expect(body.question).toHaveLength(LIMITS.questionOnTextMaxChars);
  });

  it('maps AI statuses to kind messages', () => {
    expect(messageFor({ status: 'blocked', reason: 'adult_redirect', message: '', meta: meta() })).toMatchObject({ text: KID_MESSAGES.adultRedirect, tone: 'adult' });
    expect(messageFor({ status: 'blocked', reason: 'refusal', message: '', meta: meta() })).toMatchObject({ text: KID_MESSAGES.blocked, canRetry: false });
    expect(messageFor({ status: 'unavailable', reason: 'quota', message: '', meta: null })).toMatchObject({ text: KID_MESSAGES.quota, canRetry: false });
    expect(messageFor({ status: 'unavailable', reason: 'timeout', message: '', meta: null })).toMatchObject({ text: KID_MESSAGES.unavailable, canRetry: true });
    expect(messageFor({ status: 'unavailable', reason: 'offline', message: 'Serveur', meta: null })).toMatchObject({ text: 'Serveur', canRetry: true });
    // Definitions come from the AI now (2026-09-19): they count as AI requests.
    expect(countsAsAiRequest('definition', { kind: 'definition_not_found' })).toBe(true);
  });
});
