// §19.3 « Mes devoirs »: purpose of a document set at creation, « J'ai terminé » synced without the parent code.
import type { DocumentMeta } from '@aide/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, makeDocument, newParent, pullAll, sync, type TestContext } from '../platform/helpers';

let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.close();
  ctx = null;
});

async function row(c: TestContext, id: string): Promise<Record<string, unknown>> {
  return c.db('documents').where('id', id).first();
}

describe('homework documents (§19.3)', () => {
  it('a homework sheet is created by the child session and marked done / to do again without the parent code', async () => {
    ctx = await createTestContext();
    const c = ctx;
    const { parent, agent } = await newParent(c, 'devoirs@example.fr');
    const sheet = makeDocument(parent.id, { kind: 'images', purpose: 'homework', homeworkDoneAt: null, title: 'Fiche de maths' });
    expect((await sync(agent, { changes: { documents: [sheet] } })).rejected).toEqual([]);
    expect(await row(c, sheet.id)).toMatchObject({ purpose: 'homework', homework_done_at: null });

    const done = { ...sheet, homeworkDoneAt: c.clock.now, updatedAt: c.clock.now + 1 };
    expect((await sync(agent, { changes: { documents: [done] } })).rejected).toEqual([]);
    expect(await row(c, sheet.id)).toMatchObject({ homework_done_at: c.clock.now });

    const again = { ...sheet, homeworkDoneAt: null, updatedAt: c.clock.now + 2 };
    expect((await sync(agent, { changes: { documents: [again] } })).rejected).toEqual([]);
    expect(await row(c, sheet.id)).toMatchObject({ homework_done_at: null });

    const { pages } = await pullAll(agent);
    expect(pages.flatMap((p) => p.changes.documents).at(-1)).toMatchObject({ id: sheet.id, purpose: 'homework', homeworkDoneAt: null });
  });

  it('the purpose never changes after creation; a book has no « terminé »; older devices create books', async () => {
    ctx = await createTestContext();
    const c = ctx;
    const { parent, agent } = await newParent(c, 'livres@example.fr');
    const book = makeDocument(parent.id, { kind: 'pdf' });
    await sync(agent, { changes: { documents: [book] } });
    const changed = { ...book, purpose: 'homework' as const, homeworkDoneAt: c.clock.now, title: 'Nouveau titre', updatedAt: c.clock.now + 1 };
    expect((await sync(agent, { changes: { documents: [changed] } })).rejected).toEqual([]);
    expect(await row(c, book.id)).toMatchObject({ title: 'Nouveau titre', purpose: 'reading', homework_done_at: null });

    const { purpose: _purpose, homeworkDoneAt: _doneAt, ...older } = makeDocument(parent.id);
    expect((await sync(agent, { changes: { documents: [older as DocumentMeta] } })).rejected).toEqual([]);
    expect(await row(c, older.id)).toMatchObject({ purpose: 'reading', homework_done_at: null });
  });
});
