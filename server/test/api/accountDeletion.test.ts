// §30 « Supprimer le compte »: the account goes, everything of the family goes with it, and the devices are told.
import { newId } from '@aide/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { PARENT_TABLES } from '../../src/db/repositories/accountDeletion';
import { runRetention } from '../../src/maintenance/retention';
import { uploadsDir } from '../../src/paths';
import {
  type Agent, createTestContext, login, newChild, newParent, PASSWORD, type TestContext, unlock, XRW,
} from '../platform/helpers';

let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.close();
  ctx = null;
});

async function setup(): Promise<{ ctx: TestContext; agent: Agent; parentId: string; childId: string }> {
  ctx = await createTestContext();
  const { parent, agent } = await newParent(ctx, `suppression-${newId().slice(0, 8)}@example.fr`);
  const child = await newChild(agent, 'Zoé');
  return { ctx, agent, parentId: parent.id, childId: child.id };
}

function remove(agent: Agent, password = PASSWORD) {
  return agent.post('/api/auth/account/delete').set(XRW).send({ password });
}

describe('POST /api/auth/account/delete', () => {
  it('needs the Réglages open and the password', async () => {
    const { agent } = await setup();

    expect((await remove(agent)).status).toBe(403); // locked

    await unlock(agent);
    expect((await remove(agent, 'pas le bon mot de passe')).status).toBe(403);
    expect((await ctx!.db('users').count({ n: '*' }).first())?.n).toBe(1);
  });

  it('removes the account and everything of the family', async () => {
    const { agent, parentId, childId } = await setup();
    // Something in as many tables as a short session touches.
    await unlock(agent);
    await agent.post('/api/glossary').set(XRW).send({ headword: 'frise', definition: 'une bande de dessins' });
    await agent.put(`/api/children/${childId}/preferences`).set(XRW).send({ reading: { fontSizePx: 30 } });

    const response = await remove(agent);
    expect(response.status).toBe(200);

    expect((await ctx!.db('users').count({ n: '*' }).first())?.n).toBe(0);
    expect((await ctx!.db('sessions').count({ n: '*' }).first())?.n).toBe(0);
    for (const table of PARENT_TABLES) {
      const left = await ctx!.db(table).where('parent_id', parentId).count({ n: '*' }).first();
      expect({ table, n: Number(left?.n ?? 0) }).toEqual({ table, n: 0 });
    }
  });

  it('tells a device that was switched off, then forgets the token once no session could still be alive', async () => {
    ctx = await createTestContext();
    const email = `eteint-${newId().slice(0, 8)}@example.fr`;
    const { agent } = await newParent(ctx, email);
    // The family's other iPad, signed in and then switched off before the account was deleted.
    const otherDevice = await login(ctx, email);

    await unlock(agent);
    expect((await remove(agent)).status).toBe(200);

    const after = await otherDevice.get('/api/auth/status');
    expect(after.status).toBe(410);
    expect(after.body).toMatchObject({ error: { code: 'account_deleted' } });

    // One row per session the family had open: the token of each device that could still show up.
    expect((await ctx!.db('deleted_accounts').count({ n: '*' }).first())?.n).toBe(2);
    ctx!.advance(181 * 24 * 60 * 60_000);
    await runRetention({ db: ctx!.db, now: ctx!.clock.now, uploadsRoot: uploadsDir(ctx!.config) });
    expect((await ctx!.db('deleted_accounts').count({ n: '*' }).first())?.n).toBe(0);
  });

  it('refuses the account that installed the server while other families are still on it', async () => {
    ctx = await createTestContext();
    const { agent: owner } = await newParent(ctx, `proprietaire-${newId().slice(0, 8)}@example.fr`);
    await newParent(ctx, `autre-${newId().slice(0, 8)}@example.fr`);

    await unlock(owner);
    const response = await remove(owner);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: { code: 'owner_account' } });
  });

  it('knows every table that holds rows of a family', async () => {
    ctx = await createTestContext();
    // A table added later and forgotten in PARENT_TABLES would leave a child's work behind. The schema is the
    // source of truth here, not the list.
    const rows = (await ctx.db('sqlite_master').select('name').where('type', 'table')) as { name: string }[];
    const missing: string[] = [];
    for (const { name } of rows) {
      if (name.startsWith('sqlite_') || name.startsWith('knex_')) continue;
      const columns = await ctx.db(name).columnInfo();
      if ('parent_id' in columns && !(PARENT_TABLES as readonly string[]).includes(name)) missing.push(name);
    }
    expect(missing).toEqual([]);
  });
});
