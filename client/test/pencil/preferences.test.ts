import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import { PENCIL_PREFERENCES_KEY, sanitizePreferences, startPencilPreferences, type PencilPreferences } from '../../src/pencil/preferences';
import { resetPencilStore, usePencilStore } from '../../src/pencil/store';

vi.mock('../../src/sync/SyncEngine', () => ({ saveEntity: async () => undefined }));

const DEFAULTS: PencilPreferences = {
  colorByTool: { pencil: '#1f2937', pen: '#2563eb', highlighter: '#fde047' },
  thicknessByTool: { pencil: 'moyen', pen: 'moyen', highlighter: 'moyen' },
  eraserMode: 'stroke',
  fingerDraws: false,
  penDetected: false,
};

describe('pencil preferences', () => {
  beforeAll(async () => {
    await db.open();
    resetPencilStore();
  });

  afterAll(() => {
    db.close();
  });

  it('keeps only valid stored values', () => {
    expect(sanitizePreferences(null, DEFAULTS)).toEqual(DEFAULTS);
    expect(
      sanitizePreferences(
        {
          colorByTool: { pencil: '#DC2626', pen: '#fde047', highlighter: 42 },
          thicknessByTool: { pencil: 'epais', pen: 'gigantesque' },
          eraserMode: 'page',
          fingerDraws: true,
          penDetected: 'oui',
        },
        DEFAULTS,
      ),
    ).toEqual({ ...DEFAULTS, colorByTool: { ...DEFAULTS.colorByTool, pencil: '#dc2626' }, thicknessByTool: { ...DEFAULTS.thicknessByTool, pencil: 'epais' }, fingerDraws: true });
  });

  it('restores the stored choices on start and saves later changes', async () => {
    await db.kv.put({ key: PENCIL_PREFERENCES_KEY, value: { ...DEFAULTS, colorByTool: { ...DEFAULTS.colorByTool, pencil: '#16a34a' }, fingerDraws: true, eraserMode: 'partial' } });
    await startPencilPreferences();
    expect(usePencilStore.getState()).toMatchObject({ color: '#16a34a', fingerDraws: true, eraserMode: 'partial', tool: 'pencil' });
    expect(startPencilPreferences()).toBe(startPencilPreferences());

    vi.useFakeTimers();
    try {
      usePencilStore.getState().setThickness('fin');
      await vi.advanceTimersByTimeAsync(400);
    } finally {
      vi.useRealTimers();
    }
    await vi.waitFor(async () => {
      const stored = (await db.kv.get(PENCIL_PREFERENCES_KEY))?.value as PencilPreferences;
      expect(stored.thicknessByTool.pencil).toBe('fin');
    });
  });
});
