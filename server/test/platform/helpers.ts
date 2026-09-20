import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Annotation, type Answer, type ChildProfile, type DocumentMeta, type Exercise, newId, type PageContent, type ParentUser,
  type ReadingProgress, type ReadingSession, type SyncChanges, type SyncResponse,
} from '@aide/shared';
import type { Express } from 'express';
import type { Knex } from 'knex';
import request from 'supertest';
import { createApp } from '../../src/app';
import { createParentAccount } from '../../src/auth/createParent';
import { type AppConfig, loadConfig } from '../../src/config';
import { createDb, runMigrations } from '../../src/db/knex';
import type { Mailer } from '../../src/email/mailer';
import { silentLogger } from '../../src/logger';

export const PASSWORD = 'motdepasse-solide-42';
export const PIN = '482913';
export const XRW = { 'X-Requested-With': 'aide' } as const;
export const HASH_A = 'a'.repeat(64);
export const HASH_B = 'b'.repeat(64);
/** 2026-09-16 10:00 UTC */
export const T0 = Date.UTC(2026, 8, 16, 10, 0, 0);

export type Agent = ReturnType<typeof request.agent>;

export interface TestContext {
  app: Express;
  db: Knex;
  config: AppConfig;
  dataDir: string;
  clock: { now: number };
  advance(ms: number): void;
  close(): Promise<void>;
}

export async function createTestContext(
  opts: { env?: Record<string, string>; rateLimits?: boolean; clientDist?: string; mailer?: Mailer } = {},
): Promise<TestContext> {
  const dataDir = mkdtempSync(join(tmpdir(), 'aide-platform-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'sqlite::memory:',
    CLIENT_DIST_DIR: opts.clientDist ?? './__no_client_dist__',
    DATA_DIR: dataDir,
    ...opts.env,
  });
  const db = createDb(config.databaseUrl);
  await runMigrations(db);
  const clock = { now: T0 };
  const app = createApp({ config, db, logger: silentLogger, now: () => clock.now, disableRateLimits: !opts.rateLimits, mailer: opts.mailer });
  return {
    app,
    db,
    config,
    dataDir,
    clock,
    advance: (ms) => {
      clock.now += ms;
    },
    close: async () => {
      await db.destroy();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Creates a parent directly in the database and returns a logged-in (locked) agent. */
export async function newParent(ctx: TestContext, email: string): Promise<{ parent: ParentUser; agent: Agent }> {
  const parent = await createParentAccount(
    ctx.db,
    { email, displayName: 'Parent', password: PASSWORD, pin: PIN },
    { now: ctx.clock.now, rounds: ctx.config.passwordHashRounds },
  );
  const agent = await login(ctx, email);
  return { parent, agent };
}

export async function login(ctx: TestContext, email: string, password = PASSWORD): Promise<Agent> {
  const agent = request.agent(ctx.app);
  const res = await agent.post('/api/auth/login').set(XRW).send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

export async function unlock(agent: Agent, pin = PIN): Promise<void> {
  const res = await agent.post('/api/auth/unlock').set(XRW).send({ pin });
  if (res.status !== 200) throw new Error(`unlock failed: ${res.status} ${JSON.stringify(res.body)}`);
}

export async function lock(agent: Agent): Promise<void> {
  await agent.post('/api/auth/lock').set(XRW).send();
}

/** Creates a child through the API (unlocks then locks again). */
export async function newChild(agent: Agent, firstName = 'Lou'): Promise<ChildProfile> {
  await unlock(agent);
  const res = await agent.post('/api/children').set(XRW).send({ firstName });
  if (res.status !== 201) throw new Error(`child creation failed: ${res.status}`);
  await lock(agent);
  return res.body as ChildProfile;
}

export function emptyChanges(): SyncChanges {
  return { documents: [], pages: [], annotations: [], progress: [], sessions: [], exercises: [], answers: [], children: [] };
}

export async function sync(
  agent: Agent,
  opts: { cursor?: string | null; changes?: Partial<SyncChanges>; deviceId?: string } = {},
): Promise<SyncResponse> {
  const res = await agent
    .post('/api/sync')
    .set(XRW)
    .send({ cursor: opts.cursor ?? null, deviceId: opts.deviceId ?? 'device-test', changes: { ...emptyChanges(), ...opts.changes } });
  if (res.status !== 200) throw new Error(`sync failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as SyncResponse;
}

/** Pulls until hasMore is false; returns every page. */
export async function pullAll(agent: Agent, cursor: string | null = null): Promise<{ pages: SyncResponse[]; cursor: string }> {
  const pages: SyncResponse[] = [];
  let current = cursor;
  for (let i = 0; i < 100; i++) {
    const res = await sync(agent, { cursor: current });
    pages.push(res);
    current = res.cursor;
    if (!res.hasMore) break;
  }
  return { pages, cursor: current ?? '0' };
}

export function makeDocument(parentId: string, overrides: Partial<DocumentMeta> = {}): DocumentMeta {
  return {
    id: newId(),
    ownerParentId: parentId,
    childIds: [],
    title: 'Les volcans',
    kind: 'pdf',
    textMode: 'faithful',
    purpose: 'reading',
    homeworkDoneAt: null,
    sourceHash: HASH_A,
    pageCount: 2,
    status: 'ready',
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...overrides,
  };
}

export function makePage(documentId: string, overrides: Partial<PageContent> = {}): PageContent {
  return {
    documentId,
    pageIndex: 0,
    status: 'ready',
    textSource: 'pdf-text',
    blocks: [{ kind: 'paragraph', text: 'Le volcan crache de la lave très chaude.' }],
    confidence: null,
    contentHash: HASH_B,
    width: null,
    height: null,
    warnings: [],
    updatedAt: T0,
    ...overrides,
  };
}

export function makeHighlight(childId: string, documentId: string, overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: newId(),
    type: 'highlight',
    childId,
    documentId,
    color: '#fde047',
    pageIndex: 0,
    blockIndex: 0,
    start: 3,
    end: 9,
    blockTextHash: HASH_B,
    text: 'volcan',
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...overrides,
  } as Annotation;
}

export function makeProgress(childId: string, documentId: string, overrides: Partial<ReadingProgress> = {}): ReadingProgress {
  return { childId, documentId, pageIndex: 1, blockIndex: 0, sentenceIndex: 2, updatedAt: T0, ...overrides };
}

export function makeReadingSession(childId: string, documentId: string, overrides: Partial<ReadingSession> = {}): ReadingSession {
  return {
    id: newId(),
    childId,
    documentId,
    startedAt: T0,
    endedAt: T0 + 60_000,
    pagesViewed: [0, 1],
    ttsSeconds: 30,
    wordsLookedUp: 2,
    aiRequests: 1,
    updatedAt: T0,
    ...overrides,
  };
}

export function makeExercise(childId: string, documentId: string, overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: newId(),
    childId,
    documentId,
    pageIndexes: [0],
    questions: [
      { id: 'q1', type: 'vrai_faux', prompt: 'Le volcan crache de la lave ?', source: { pageIndex: 0, quote: 'Le volcan crache de la lave' }, answer: true, explanation: 'Oui.' },
    ],
    origin: 'local',
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...overrides,
  };
}

export function makeAnswer(childId: string, exerciseId: string, overrides: Partial<Answer> = {}): Answer {
  return {
    id: newId(),
    exerciseId,
    questionId: 'q1',
    childId,
    response: { type: 'vrai_faux', value: true },
    inputMethod: 'toucher',
    inkAnnotationId: null,
    verdict: 'correct',
    feedback: 'Bravo !',
    correctedBy: 'local',
    rereadRef: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}
