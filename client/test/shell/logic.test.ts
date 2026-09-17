import {
  DEFAULT_EXERCISE_PREFERENCES, DEFAULT_PARENT_SETTINGS, DEFAULT_READING_PREFERENCES, DEFAULT_TTS_PREFERENCES,
  type ActivitySummary, type AuthStatus, type ChildProfile, type DocumentMeta, type ReadingProgress,
} from '@aide/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/http';
import {
  inviteCodeError, isValidEmail, pinFormatError, pinShortWarning, sanitizePinInput, toRegisterRequest, toSetupRequest, validateLoginForm,
  validateRegisterForm, validateSetupForm,
} from '../../src/features/auth/authForms';
import { isBookOfChild, listChildBooks, pickContinueReading } from '../../src/features/library/books';
import { computeActivityStats, periodRange, sortAlerts } from '../../src/features/parent/activityStats';
import {
  childToForm, emptyChildForm, formToCreateRequest, formToProfile, roundToStep, toggleQuestionType, validateChildForm,
} from '../../src/features/parent/childForm';
import { formatBytes, formatDuration } from '../../src/features/parent/format';
import {
  countWords, filterGlossary, formToGlossaryEntry, normalizeHeadword, parseForms, validateGlossaryForm,
} from '../../src/features/parent/glossaryForm';
import { lockRemainingText } from '../../src/features/parent/lockout';
import { completeSettings, sameSettings } from '../../src/features/parent/settingsModel';
import { describeError, describeErrorCode } from '../../src/state/errors';
import { homePathFor, readerPath, resolveGuard } from '../../src/state/guards';

const signedIn: AuthStatus = {
  setupRequired: false, authenticated: true, parent: { id: 'p1', email: 'a@example.org', displayName: 'A', createdAt: 1, isOwner: true },
  parentUnlockedUntil: null, pinSet: true, pinLockedUntil: null, registrationOpen: false,
};

function child(patch: Partial<ChildProfile> = {}): ChildProfile {
  return {
    id: 'c1', parentId: 'p1', firstName: 'Léa', age: 10, avatar: '🦊', readingLevel: 'intermediaire', explanationDifficulty: 'simple',
    reading: { ...DEFAULT_READING_PREFERENCES }, tts: { ...DEFAULT_TTS_PREFERENCES }, exercises: { ...DEFAULT_EXERCISE_PREFERENCES },
    createdAt: 1, updatedAt: 10, deletedAt: null, ...patch,
  };
}

describe('guards', () => {
  const base = { ready: true, authStatus: signedIn, hasSelectedChild: true };

  it('waits for the cached session', () => {
    expect(resolveGuard('child', { ...base, ready: false })).toEqual({ kind: 'wait' });
  });

  it('redirects from / according to the session', () => {
    expect(homePathFor({ ...base, authStatus: { ...signedIn, setupRequired: true, authenticated: false } })).toBe('/installation');
    expect(homePathFor({ ...base, authStatus: null })).toBe('/connexion');
    expect(homePathFor({ ...base, hasSelectedChild: false })).toBe('/enfant');
    expect(homePathFor(base)).toBe('/accueil');
    expect(resolveGuard('root', base)).toEqual({ kind: 'redirect', to: '/accueil' });
  });

  it('protects child screens and the parent area', () => {
    expect(resolveGuard('child', base)).toEqual({ kind: 'allow' });
    expect(resolveGuard('child', { ...base, hasSelectedChild: false })).toEqual({ kind: 'redirect', to: '/enfant' });
    expect(resolveGuard('child', { ...base, authStatus: { ...signedIn, authenticated: false } })).toEqual({ kind: 'redirect', to: '/connexion' });
    expect(resolveGuard('auth', { ...base, hasSelectedChild: false })).toEqual({ kind: 'allow' });
    expect(resolveGuard('auth', { ...base, authStatus: null })).toEqual({ kind: 'redirect', to: '/connexion' });
  });

  it('keeps setup and login pages for the right state only', () => {
    expect(resolveGuard('setup', base)).toEqual({ kind: 'redirect', to: '/' });
    expect(resolveGuard('setup', { ...base, authStatus: null })).toEqual({ kind: 'allow' });
    expect(resolveGuard('guest', base)).toEqual({ kind: 'redirect', to: '/' });
    expect(resolveGuard('guest', { ...base, authStatus: { ...signedIn, authenticated: false } })).toEqual({ kind: 'allow' });
    expect(resolveGuard('guest', { ...base, authStatus: { ...signedIn, setupRequired: true } })).toEqual({ kind: 'redirect', to: '/installation' });
  });

  it('builds reader URLs with a 0-based page index', () => {
    expect(readerPath('doc 1')).toBe('/lire/doc%201');
    expect(readerPath('d', 0)).toBe('/lire/d?page=1');
    expect(readerPath('d', 4)).toBe('/lire/d?page=5');
    expect(readerPath('d', null)).toBe('/lire/d');
  });
});

describe('errors', () => {
  it('maps known codes, keeps French server messages for unknown codes', () => {
    expect(describeError(new ApiError(0, 'offline', 'x'))).toBe('Pas de connexion Internet pour le moment.');
    expect(describeError(new ApiError(403, 'parent_locked', 'Verrouillé'))).toContain('verrouillé');
    expect(describeError(new ApiError(400, 'weird_code', 'Message du serveur.'))).toBe('Message du serveur.');
    expect(describeError(new Error('boom'))).toBe('Une erreur est survenue. Réessayez dans un instant.');
    expect(describeErrorCode('timeout')).toContain('trop de temps');
    expect(describeErrorCode('nope')).toContain('synchronisation');
  });
});

describe('auth forms', () => {
  it('validates the setup form in French', () => {
    const errors = validateSetupForm({ setupToken: '', displayName: ' ', email: 'x', password: 'court', passwordConfirm: '', pin: '12', pinConfirm: '' });
    expect(errors).toMatchObject({
      setupToken: 'Ce champ est obligatoire.',
      displayName: 'Ce champ est obligatoire.',
      email: 'Adresse e-mail non valide.',
      password: 'Au moins 10 caractères.',
      pin: 'Entre 4 et 8 chiffres.',
    });
    const ok = { setupToken: ' t ', displayName: ' Parent ', email: ' Parent@Example.org ', password: 'motdepasse!', passwordConfirm: 'motdepasse!', pin: '123456', pinConfirm: '123456' };
    expect(validateSetupForm(ok)).toEqual({});
    expect(validateSetupForm({ ...ok, pinConfirm: '123457' }).pinConfirm).toBe('Les codes ne sont pas identiques.');
    expect(validateSetupForm({ ...ok, passwordConfirm: 'x' }).passwordConfirm).toBe('Les mots de passe ne sont pas identiques.');
    expect(toSetupRequest(ok)).toEqual({ setupToken: 't', displayName: 'Parent', email: 'parent@example.org', password: 'motdepasse!', pin: '123456' });
  });

  it('validates the invitation sign-up form and invitation codes', () => {
    const ok = {
      inviteCode: ' k7qm-3fxa-9trd ', displayName: ' Alex ', email: ' Alex@Example.org ', password: 'motdepasse!', passwordConfirm: 'motdepasse!',
      pin: '246810', pinConfirm: '246810',
    };
    expect(validateRegisterForm(ok)).toEqual({});
    expect(toRegisterRequest(ok)).toEqual({ inviteCode: 'k7qm-3fxa-9trd', displayName: 'Alex', email: 'alex@example.org', password: 'motdepasse!', pin: '246810' });
    expect(validateRegisterForm({ ...ok, inviteCode: '  ', email: 'x' })).toEqual({ inviteCode: 'Ce champ est obligatoire.', email: 'Adresse e-mail non valide.' });
    expect(inviteCodeError('court')).toBe('De 8 à 64 lettres, chiffres ou tirets.');
    expect(inviteCodeError('code avec espaces')).not.toBeNull();
    expect(inviteCodeError('A'.repeat(65))).not.toBeNull();
    expect(inviteCodeError('MON-CODE-2026')).toBeNull();
  });

  it('warns about short PINs and sanitizes PIN input', () => {
    expect(pinFormatError('1234')).toBeNull();
    expect(pinShortWarning('1234')).toBe('Un code à 6 chiffres est plus sûr.');
    expect(pinShortWarning('123456')).toBeNull();
    expect(pinFormatError('123456789')).not.toBeNull();
    expect(sanitizePinInput('12a3 4567890')).toBe('12345678');
    expect(isValidEmail('parent@example.org')).toBe(true);
    expect(validateLoginForm({ email: '', password: '' })).toEqual({ email: 'Ce champ est obligatoire.', password: 'Ce champ est obligatoire.' });
  });
});

describe('books', () => {
  const doc = (id: string, patch: Partial<DocumentMeta> = {}): DocumentMeta => ({
    id, ownerParentId: 'p1', childIds: ['c1'], title: id, kind: 'pdf', sourceHash: 'x', pageCount: 3, status: 'ready',
    createdAt: 1, updatedAt: 1, deletedAt: null, ...patch,
  });
  const progress = (documentId: string, updatedAt: number, childId = 'c1'): ReadingProgress => ({
    childId, documentId, pageIndex: 2, blockIndex: 0, sentenceIndex: 0, updatedAt,
  });

  it('lists the child books, last read first then newest, and picks the book to continue', () => {
    const documents = [
      doc('old', { createdAt: 1 }),
      doc('new', { createdAt: 5 }),
      doc('read', { createdAt: 2 }),
      doc('other-child', { childIds: ['c2'] }),
      doc('deleted', { deletedAt: 3 }),
    ];
    const items = listChildBooks(documents, [progress('read', 9), progress('new', 9, 'c2')], 'c1');
    expect(items.map((i) => i.document.id)).toEqual(['read', 'new', 'old']);
    expect(items[0]?.progress?.pageIndex).toBe(2);
    expect(pickContinueReading(documents, [progress('read', 9)], 'c1')?.document.id).toBe('read');
    expect(pickContinueReading(documents, [progress('deleted', 9)], 'c1')).toBeNull();
    expect(isBookOfChild(doc('x', { childIds: [] }), 'c1')).toBe(false);
  });
});

describe('activity stats', () => {
  const summary: ActivitySummary = {
    sessions: [
      { id: 's1', childId: 'c1', documentId: 'd1', startedAt: 0, endedAt: 30 * 60_000, pagesViewed: [0, 1, 1], ttsSeconds: 120, wordsLookedUp: 3, aiRequests: 1, updatedAt: 1 },
      { id: 's2', childId: 'c1', documentId: 'd1', startedAt: 0, endedAt: 10 * 60 * 60_000, pagesViewed: [1, 2], ttsSeconds: 0, wordsLookedUp: 2, aiRequests: 0, updatedAt: 1 },
      { id: 's3', childId: 'c2', documentId: 'd2', startedAt: 10, endedAt: 5, pagesViewed: [0], ttsSeconds: 5, wordsLookedUp: 0, aiRequests: 0, updatedAt: 1 },
    ],
    aiRequests: [
      { id: 'a', createdAt: 1, childId: 'c1', operation: 'explain_word', route: 'light', provider: 'x', model: 'x', status: 'blocked', rejectionReason: null, cacheHit: false, durationMs: 1 },
      { id: 'b', createdAt: 1, childId: 'c1', operation: 'explain_word', route: 'light', provider: 'x', model: 'x', status: 'ok', rejectionReason: null, cacheHit: true, durationMs: 1 },
      { id: 'c', createdAt: 1, childId: 'c2', operation: 'summarize', route: 'complex', provider: 'x', model: 'x', status: 'ok', rejectionReason: null, cacheHit: false, durationMs: 1 },
    ],
    alerts: [
      { id: 'al1', createdAt: 5, childId: 'c1', kind: 'safety_input', detail: '', seenAt: 6 },
      { id: 'al2', createdAt: 3, childId: 'c1', kind: 'adult_redirect', detail: '', seenAt: null },
      { id: 'al3', createdAt: 7, childId: null, kind: 'budget_warning', detail: '', seenAt: null },
    ],
    ocrIssues: [],
    budget: { monthToDateEur: 8.5, monthlyBudgetEur: 10 },
  };

  it('aggregates reading time (capped), distinct pages, lookups and AI requests by status', () => {
    const all = computeActivityStats(summary);
    expect(all.sessionCount).toBe(3);
    expect(all.readingMs).toBe(30 * 60_000 + 4 * 60 * 60_000);
    expect(all.pagesRead).toBe(4);
    expect(all.wordsLookedUp).toBe(5);
    expect(all.ttsSeconds).toBe(125);
    expect(all.ai).toEqual({ total: 3, cacheHits: 1, byStatus: [{ status: 'ok', count: 2 }, { status: 'blocked', count: 1 }] });
    expect(all.unseenAlerts).toBe(2);
    expect(all.budget).toEqual({ spentEur: 8.5, budgetEur: 10, percent: 85, level: 'warning' });

    const c2 = computeActivityStats(summary, 'c2');
    expect(c2.pagesRead).toBe(1);
    expect(c2.readingMs).toBe(0);
    expect(c2.ai.total).toBe(1);
  });

  it('reports the budget level and sorts alerts unseen first', () => {
    expect(computeActivityStats({ ...summary, budget: { monthToDateEur: 12, monthlyBudgetEur: 10 } }).budget.level).toBe('reached');
    expect(computeActivityStats({ ...summary, budget: { monthToDateEur: 1, monthlyBudgetEur: 10 } }).budget.level).toBe('ok');
    expect(computeActivityStats({ ...summary, budget: { monthToDateEur: 0.5, monthlyBudgetEur: 0 } }).budget.level).toBe('reached');
    expect(sortAlerts(summary.alerts).map((a) => a.id)).toEqual(['al3', 'al2', 'al1']);
  });

  it('computes period ranges', () => {
    const now = new Date(2026, 8, 16, 12).getTime();
    expect(periodRange('week', now)).toEqual({ from: now - 7 * 86_400_000, to: now });
    expect(periodRange('calendarMonth', now).from).toBe(new Date(2026, 8, 1).getTime());
  });

  it('formats durations, bytes and lock times in French', () => {
    expect(formatDuration(20_000)).toBe('< 1 min');
    expect(formatDuration(45 * 60_000)).toBe('45 min');
    expect(formatDuration(125 * 60_000)).toBe('2 h 5 min');
    expect(formatBytes(512)).toBe('512 o');
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3,5 Mo');
    expect(lockRemainingText(4_200)).toBe('5 s');
    expect(lockRemainingText(61_000)).toBe('2 min');
    expect(lockRemainingText(2 * 3_600_000 + 60_000)).toBe('2 h 1 min');
  });
});

describe('child form', () => {
  it('validates the profile and builds requests', () => {
    const form = emptyChildForm();
    expect(validateChildForm(form)).toEqual({ firstName: true });
    const filled = { ...form, firstName: '  Léo  ', age: 16 };
    expect(validateChildForm(filled)).toEqual({ age: true });
    expect(validateChildForm({ ...filled, age: 9, exercises: { ...filled.exercises, enabledTypes: [] } })).toEqual({ questionTypes: true });
    const request = formToCreateRequest({ ...filled, age: 9 });
    expect(request.firstName).toBe('Léo');
    expect(request.reading).toEqual(DEFAULT_READING_PREFERENCES);
  });

  it('round-trips an existing profile and bumps updatedAt', () => {
    const existing = child();
    const form = childToForm(existing);
    form.reading.fontSizePx = 30;
    const profile = formToProfile(existing, form, 5);
    expect(profile.id).toBe('c1');
    expect(profile.parentId).toBe('p1');
    expect(profile.reading.fontSizePx).toBe(30);
    expect(existing.reading.fontSizePx).toBe(24);
    expect(profile.updatedAt).toBe(11);
    expect(formToProfile(existing, form, 1_000).updatedAt).toBe(1_000);
  });

  it('keeps question types in canonical order and rounds slider values', () => {
    expect(toggleQuestionType(['ordre', 'qcm'], 'vrai_faux', true)).toEqual(['qcm', 'vrai_faux', 'ordre']);
    expect(toggleQuestionType(['qcm', 'ordre'], 'qcm', false)).toEqual(['ordre']);
    expect(roundToStep(1.7000000000000002, 0.1)).toBe(1.7);
    expect(roundToStep(0.060000000000000005, 0.02)).toBe(0.06);
  });
});

describe('glossary form', () => {
  it('normalizes and validates entries', () => {
    expect(normalizeHeadword('  Photosynthèse ')).toBe('photosynthèse');
    expect(parseForms('Volcans, volcanique ;volcans,')).toEqual(['volcans', 'volcanique']);
    expect(countWords('  Une montagne  qui crache du feu. ')).toBe(6);
    const values = { headword: 'Volcan', partOfSpeech: 'nom' as const, kidDefinition: 'Une montagne qui crache du feu.', example: '', forms: 'volcans, volcan' };
    expect(validateGlossaryForm(values, [], null)).toEqual({});
    expect(validateGlossaryForm(values, ['volcan'], null)).toEqual({ headword: 'duplicate' });
    expect(validateGlossaryForm(values, ['volcan'], 'volcan')).toEqual({});
    expect(validateGlossaryForm({ ...values, kidDefinition: Array.from({ length: 31 }, () => 'mot').join(' ') }, [], null)).toEqual({ kidDefinition: 'tooManyWords' });
    expect(formToGlossaryEntry(values)).toEqual({ headword: 'volcan', partOfSpeech: 'nom', kidDefinition: 'Une montagne qui crache du feu.', example: null, forms: ['volcans'] });
    const entries = [formToGlossaryEntry(values), formToGlossaryEntry({ ...values, headword: 'abeille', forms: '' })];
    expect(filterGlossary(entries, '').map((e) => e.headword)).toEqual(['abeille', 'volcan']);
    expect(filterGlossary(entries, 'VOLCANS').map((e) => e.headword)).toEqual(['volcan']);
  });
});

describe('settings model', () => {
  it('completes partial settings with defaults and compares without updatedAt', () => {
    const partial = { ai: { enabled: false }, updatedAt: 7 } as unknown as Parameters<typeof completeSettings>[0];
    const complete = completeSettings(partial);
    expect(complete.ai.enabled).toBe(false);
    expect(complete.ai.features).toEqual(DEFAULT_PARENT_SETTINGS.ai.features);
    expect(complete.reader.freeSelection).toBe(false);
    expect(complete.updatedAt).toBe(7);
    expect(completeSettings(null)).toEqual(DEFAULT_PARENT_SETTINGS);
    expect(sameSettings({ ...DEFAULT_PARENT_SETTINGS, updatedAt: 1 }, { ...DEFAULT_PARENT_SETTINGS, updatedAt: 2 })).toBe(true);
    expect(sameSettings(DEFAULT_PARENT_SETTINGS, complete)).toBe(false);
  });
});
