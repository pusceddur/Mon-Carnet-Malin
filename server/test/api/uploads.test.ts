import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PARENT_SETTINGS, type ParentSettings } from '@aide/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { uploadsDir } from '../../src/paths';
import { type Agent, createTestContext, makeDocument, newParent, sync, type TestContext, unlock, XRW } from '../platform/helpers';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x20), Buffer.from('\n%%EOF\n')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4096, 1), Buffer.from([0xff, 0xd9])]);
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).map((d) => join(d.parentPath, d.name));
}

async function setPrivacy(agent: Agent, privacy: Partial<ParentSettings['privacy']>): Promise<void> {
  await unlock(agent);
  const res = await agent.put('/api/settings').set(XRW).send({ ...DEFAULT_PARENT_SETTINGS, privacy: { ...DEFAULT_PARENT_SETTINGS.privacy, ...privacy } });
  expect(res.status).toBe(200);
}

describe('document uploads (§15.6)', () => {
  let ctx: TestContext;
  let agent: Agent;
  let parentId: string;
  let root: string;

  beforeEach(async () => {
    ctx = await createTestContext({ env: { UPLOAD_QUOTA_MB: '1' } });
    const p = await newParent(ctx, 'upload@example.fr');
    agent = p.agent;
    parentId = p.parent.id;
    root = uploadsDir(ctx.config);
  });
  afterEach(async () => ctx.close());

  const postFile = (a: Agent, documentId: string, index: string, content: Buffer, filename: string, contentType: string) =>
    a.post(`/api/documents/${documentId}/files`).set(XRW).field('index', index).attach('file', content, { filename, contentType });

  it('originals: disabled by default, need a synced document, reject wrong magic bytes, then store and serve safely', async () => {
    const doc = makeDocument(parentId);
    const disabled = await postFile(agent, doc.id, '0', PDF, 'cours.pdf', 'application/pdf');
    expect(disabled.status).toBe(403);
    expect(disabled.body.error.code).toBe('uploads_disabled');

    await setPrivacy(agent, { uploadOriginals: true });
    const notSynced = await postFile(agent, doc.id, '0', PDF, 'cours.pdf', 'application/pdf');
    expect(notSynced.status).toBe(404);
    expect(notSynced.body.error.code).toBe('document_not_synced');

    await sync(agent, { changes: { documents: [doc] } });
    const fake = await postFile(agent, doc.id, '0', Buffer.from('<html><script>alert(1)</script></html>'), 'cours.pdf', 'application/pdf');
    expect(fake.status).toBe(415);
    expect(fake.body.error.code).toBe('unsupported_file');
    expect(filesUnder(root)).toEqual([]);

    const badIndex = await postFile(agent, doc.id, '1000', PDF, 'cours.pdf', 'application/pdf');
    expect(badIndex.status).toBe(400);
    expect(filesUnder(root)).toEqual([]);

    const ok = await postFile(agent, doc.id, '0', PDF, 'Leçon « volcans ».pdf', 'text/plain');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });
    const row = await ctx.db('document_files').where({ document_id: doc.id, file_index: 0 }).first();
    expect(row).toMatchObject({ parent_id: parentId, mime: 'application/pdf', size: PDF.length });
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.storage_path).toMatch(new RegExp(`^${parentId}/${doc.id}/file-0-[0-9a-f-]+\\.pdf$`));
    expect(row.storage_path).not.toContain('volcans');
    expect(filesUnder(root)).toHaveLength(1);

    const download = await agent.get(`/api/documents/${doc.id}/files/0`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toBe('application/pdf');
    expect(download.headers['content-disposition']).toMatch(/^attachment; filename="Lecon .*"; filename\*=UTF-8''Le%C3%A7on/);
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.compare(download.body as Buffer, PDF)).toBe(0);

    // Replacing the same index removes the previous file.
    expect((await postFile(agent, doc.id, '0', PDF, 'v2.pdf', 'application/pdf')).status).toBe(200);
    expect(filesUnder(root)).toHaveLength(1);
    expect((await agent.get(`/api/documents/${doc.id}/files/1`)).status).toBe(404);
  });

  it('files of another parent are unreachable, and deleted documents stop serving files', async () => {
    const doc = makeDocument(parentId);
    await setPrivacy(agent, { uploadOriginals: true });
    await sync(agent, { changes: { documents: [doc] } });
    expect((await postFile(agent, doc.id, '0', PDF, 'a.pdf', 'application/pdf')).status).toBe(200);

    const other = await newParent(ctx, 'autre@example.fr');
    await setPrivacy(other.agent, { uploadOriginals: true, uploadPageImages: true });
    expect((await other.agent.get(`/api/documents/${doc.id}/files/0`)).status).toBe(404);
    const write = await postFile(other.agent, doc.id, '0', PDF, 'b.pdf', 'application/pdf');
    expect(write.status).toBe(404);
    expect(write.body.error.code).toBe('document_not_synced');
    // A large refused body is still answered with its status (the body is read off first, no connection reset).
    const bigJpeg = Buffer.concat([JPEG, Buffer.alloc(4 * 1024 * 1024, 7)]);
    const refused = await other.agent.put(`/api/documents/${doc.id}/pages/0/image`).set(XRW).attach('image', bigJpeg, 'p.jpg');
    expect(refused.status).toBe(404);
    expect(refused.body.error.code).toBe('document_not_synced');
    const anonymous = await request(ctx.app).put(`/api/documents/${doc.id}/pages/0/image`).set(XRW).attach('image', bigJpeg, 'p.jpg');
    expect(anonymous.status).toBe(401);

    await unlock(agent);
    expect((await agent.delete(`/api/documents/${doc.id}`).set(XRW).send()).status).toBe(200);
    expect((await agent.get(`/api/documents/${doc.id}/files/0`)).status).toBe(404);
  });

  it('page images: JPEG/PNG/WebP only, 5 MB max, quota enforced, served with safe headers', async () => {
    const doc = makeDocument(parentId);
    await sync(agent, { changes: { documents: [doc] } });

    const put = (content: Buffer, name = 'page.jpg', pageIndex = '2') =>
      agent.put(`/api/documents/${doc.id}/pages/${pageIndex}/image`).set(XRW).attach('image', content, name);

    // A JPEG with an EXIF segment (GPS) is stored without it.
    const exifPayload = Buffer.concat([Buffer.from('Exif', 'latin1'), Buffer.from([0, 0]), Buffer.from('GPSLatitude 48.8', 'latin1')]);
    const exifSegment = Buffer.concat([Buffer.from([0xff, 0xe1, 0, exifPayload.length + 2]), exifPayload]);
    const photo = Buffer.concat([JPEG.subarray(0, 2), exifSegment, Buffer.from([0xff, 0xda, 0, 4, 1, 2]), Buffer.alloc(100, 5), Buffer.from([0xff, 0xd9])]);
    expect((await put(photo, 'photo.jpg', '1')).status).toBe(200);
    const storedPhoto = await agent.get(`/api/documents/${doc.id}/pages/1/image`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect((storedPhoto.body as Buffer).includes(Buffer.from('GPSLatitude'))).toBe(false);
    expect((storedPhoto.body as Buffer).length).toBe(photo.length - exifSegment.length);
    const photoRow = await ctx.db('document_page_images').where({ document_id: doc.id, page_index: 1 }).first();
    expect(Number(photoRow.size)).toBe(photo.length - exifSegment.length);

    expect((await put(JPEG)).status).toBe(200);
    const res = await agent.get(`/api/documents/${doc.id}/pages/2/image`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect((await agent.get(`/api/documents/${doc.id}/pages/3/image`)).status).toBe(404);

    const pdfAsImage = await put(PDF, 'page.jpg');
    expect(pdfAsImage.status).toBe(415);
    expect((await put(JPEG, 'page.jpg', 'x')).status).toBe(400);

    const tooBig = await put(Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]));
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error.code).toBe('payload_too_large');

    // Quota of 1 MB for this context.
    const bigPng = Buffer.concat([PNG_HEAD, Buffer.alloc(1100 * 1024)]);
    const quota = await put(bigPng, 'page.png', '4');
    expect(quota.status).toBe(413);
    expect(quota.body.error.code).toBe('quota_exceeded');
    expect(filesUnder(root)).toHaveLength(2);

    await setPrivacy(agent, { uploadPageImages: false });
    const off = await put(JPEG);
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe('uploads_disabled');
  });
});
