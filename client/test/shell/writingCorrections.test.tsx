// §24 « Écriture corrigée » in Activité: count per kind, the mistakes made again, each corrected text with what changed.
import type { ChildProfile, WritingCorrectionHistory } from '@aide/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parent } from '../../src/i18n/fr/parent';
import { useSessionStore } from '../../src/state/session';
import { cleanup, render, waitFor } from './render';

const api = vi.hoisted(() => ({ getWritingCorrectionHistory: vi.fn() }));
vi.mock('../../src/api/activity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/api/activity')>()),
  getWritingCorrectionHistory: api.getWritingCorrectionHistory,
}));

const { WritingCorrectionsSection } = await import('../../src/features/parent/WritingCorrectionsSection');
const t = parent.activity.writing;

const HISTORY: WritingCorrectionHistory = {
  entries: [
    {
      id: 'w1', childId: 'c1', documentId: 'd1', createdAt: Date.UTC(2026, 8, 19, 12), originalText: 'jevais ecrire\n\nfin', correctedText: 'Je vais écrire.\n\nFin.',
      changes: [
        { line: 0, from: 'jevais', to: 'Je vais', kind: 'espace', rule: null },
        { line: 0, from: 'ecrire', to: 'écrire.', kind: 'accent', rule: 'écrire prend un accent aigu' },
      ],
    },
    { id: 'w2', childId: 'c1', documentId: null, createdAt: Date.UTC(2026, 8, 18, 12), originalText: 'Bonjour.', correctedText: 'Bonjour.', changes: [] },
  ],
  counts: { accent: 3, orthographe: 0, grammaire: 1, ponctuation: 0, majuscule: 0, espace: 1 },
  frequent: [{ from: 'ecrire', to: 'écrire', kind: 'accent', count: 3 }],
};

function child(id: string, firstName: string): ChildProfile {
  return { id, firstName } as ChildProfile;
}

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ children: [child('c1', 'Zoé')] });
});

afterEach(async () => {
  await cleanup();
});

describe('§24 « Écriture corrigée »', () => {
  it('shows the counts, the repeated mistakes and each text with its corrections', async () => {
    api.getWritingCorrectionHistory.mockResolvedValue(HISTORY);
    const container = await render(<WritingCorrectionsSection preferredChildId={null} refreshToken={0} />);
    await waitFor(() => expect(container.textContent).toContain(t.frequentTitle));
    expect(api.getWritingCorrectionHistory).toHaveBeenCalledWith('c1', expect.anything());
    const summary = Array.from(container.querySelectorAll('.writing-summary li')).map((li) => li.textContent);
    expect(summary).toEqual(['Accents : 3', 'Grammaire : 1', 'Espaces et mots collés : 1']);
    expect(container.textContent).toContain('3 fois');
    const first = container.querySelectorAll('.writing-log')[0]!;
    expect(first.textContent).toContain('2 corrections');
    expect(Array.from(first.querySelectorAll('del')).map((d) => d.textContent)).toEqual(['jevais', 'ecrire']);
    expect(Array.from(first.querySelectorAll('ins')).map((d) => d.textContent)).toEqual(['Je vais', 'écrire.']);
    expect(first.textContent).toContain('écrire prend un accent aigu');
    expect(first.querySelector('.writing-log__text')?.textContent).toBe('jevais ecrire\n\nfin');
    expect(container.querySelectorAll('.writing-log')[1]!.textContent).toContain(t.noFault);
  });

  it('says when nothing was corrected yet', async () => {
    api.getWritingCorrectionHistory.mockResolvedValue({ ...HISTORY, entries: [], frequent: [] });
    const container = await render(<WritingCorrectionsSection preferredChildId={null} refreshToken={0} />);
    await waitFor(() => expect(container.textContent).toContain(t.empty));
  });
});
