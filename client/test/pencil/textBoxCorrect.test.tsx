// §24 « Corriger » in a text box: shown when switched on in the Options, corrects the text in place, can be undone.
import { DEFAULT_PARENT_SETTINGS, type TextBoxAnnotation, type WritingChange } from '@aide/shared';
import { useRef, type JSX } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import { ToastProvider } from '../../src/design/components';
import { pencil as strings } from '../../src/i18n/fr/pencil';
import { TextBoxLayer } from '../../src/pencil';
import { addTextBox } from '../../src/pencil/AnnotationStore';
import { correctionMessage } from '../../src/pencil/TextBoxLayer';
import { clearHistory } from '../../src/pencil/history';
import { resetPencilStore } from '../../src/pencil/store';
import { useSessionStore } from '../../src/state/session';
import { buttonByLabel, cleanup, click, mockRect, pointerEvent, render, waitFor } from './helpers';
import { act } from 'react';

const ai = vi.hoisted(() => ({ requestAI: vi.fn() }));
vi.mock('../../src/ai/aiClient', () => ({ requestAI: ai.requestAI }));
vi.mock('../../src/tts/SpeechEngine', () => ({ speechEngine: { speakOnce: vi.fn() } }));
vi.mock('../../src/sync/SyncEngine', () => ({
  saveEntity: async (table: string, entity: unknown) => {
    const { db: localDb } = await import('../../src/db/localDb');
    await localDb.table(table).put(entity);
  },
}));

const t = strings.textBox;
const FRAME = { left: 0, top: 0, width: 1000, height: 1400 };
const TEXT = 'coucou ici il y a un test\n\njevais ecrire';
const CORRECTED = 'Coucou, ici il y a un test.\n\nJe vais écrire.';
const CHANGES: WritingChange[] = [
  { line: 0, from: 'coucou', to: 'Coucou,', kind: 'ponctuation', rule: null },
  { line: 0, from: 'test', to: 'test.', kind: 'ponctuation', rule: null },
  { line: 2, from: 'jevais', to: 'Je vais', kind: 'espace', rule: null },
  { line: 2, from: 'ecrire', to: 'écrire.', kind: 'accent', rule: 'écrire prend un accent aigu' },
];

function Host(): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  return (
    <ToastProvider>
      <div
        ref={(el) => {
          frameRef.current = el;
          if (el) mockRect(el, FRAME);
        }}
      >
        <TextBoxLayer documentId="doc-1" childId="child-1" pageIndex={2} frameRef={frameRef} frameWidth={FRAME.width} editing readable />
      </div>
    </ToastProvider>
  );
}

async function openBox(text = TEXT): Promise<{ container: HTMLElement; box: TextBoxAnnotation }> {
  const box = await addTextBox({ documentId: 'doc-1', childId: 'child-1', pageIndex: 2, x: 0.1, y: 0.2, width: 0.4, fontSize: 0.022, color: '#1d4ed8', text });
  const { container } = await render(<Host />);
  const element = await waitFor(() => container.querySelector('.tb-box'));
  await act(async () => {
    element.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', clientX: 150, clientY: 290 }));
  });
  return { container, box };
}

const stored = async (id: string): Promise<TextBoxAnnotation> => (await db.annotations.get(id)) as TextBoxAnnotation;
const settings = (correctWriting: boolean) => ({
  ...DEFAULT_PARENT_SETTINGS, ai: { ...DEFAULT_PARENT_SETTINGS.ai, features: { ...DEFAULT_PARENT_SETTINGS.ai.features, correctWriting } },
});

beforeEach(async () => {
  await db.open();
  await db.annotations.clear();
  clearHistory();
  resetPencilStore();
  ai.requestAI.mockReset();
  useSessionStore.setState({ parentSettings: settings(true) });
});

afterEach(cleanup);

afterAll(() => {
  db.close();
});

describe('§24 « Corriger » in a text box', () => {
  it('corrects the text in place, says what kind of mistakes, and can undo', async () => {
    ai.requestAI.mockResolvedValue({ status: 'ok', data: { correctedText: CORRECTED, changes: CHANGES }, meta: {} });
    const { box } = await openBox();
    await click(await waitFor(() => buttonByLabel(t.correct)));
    await waitFor(async () => (await stored(box.id)).text === CORRECTED);
    expect(ai.requestAI).toHaveBeenCalledWith('correct_writing', {
      childId: 'child-1', documentId: 'doc-1', documentHash: null, text: TEXT, annotationId: box.id, pageIndex: 2,
    });
    const message = correctionMessage(CHANGES);
    expect(message).toBe('J’ai corrigé 4 petites fautes (ponctuation, espaces, accents).');
    await waitFor(() => expect(document.body.textContent).toContain(message));

    await click(buttonByLabel(t.undo) ?? Array.from(document.querySelectorAll('button')).find((b) => b.textContent === t.undo));
    await waitFor(async () => (await stored(box.id)).text === TEXT);
  });

  it('says so when there is no mistake, and shows the messages of the AI', async () => {
    ai.requestAI
      .mockResolvedValueOnce({ status: 'ok', data: { correctedText: 'Bonjour.', changes: [] }, meta: {} })
      .mockResolvedValueOnce({ status: 'unavailable', reason: 'offline', message: 'Pas de connexion.', meta: null });
    const { box } = await openBox('Bonjour.');
    await click(await waitFor(() => buttonByLabel(t.correct)));
    await waitFor(() => expect(document.body.textContent).toContain(t.correctNone));
    await waitFor(() => expect(buttonByLabel(t.correct)?.disabled).toBe(false));
    await click(buttonByLabel(t.correct));
    await waitFor(() => expect(document.body.textContent).toContain('Pas de connexion.'));
    expect((await stored(box.id)).text).toBe('Bonjour.');
  });

  it('is hidden when switched off in the Options or when the AI is off', async () => {
    useSessionStore.setState({ parentSettings: settings(false) });
    await openBox();
    await waitFor(() => buttonByLabel(t.read));
    expect(buttonByLabel(t.correct)).toBeNull();
    await cleanup();

    useSessionStore.setState({ parentSettings: { ...DEFAULT_PARENT_SETTINGS, ai: { ...DEFAULT_PARENT_SETTINGS.ai, enabled: false } } });
    await openBox();
    await waitFor(() => buttonByLabel(t.read));
    expect(buttonByLabel(t.correct)).toBeNull();
  });
});
