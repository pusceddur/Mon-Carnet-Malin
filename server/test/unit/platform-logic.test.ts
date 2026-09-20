import { DEFAULT_EXERCISE_PREFERENCES, DEFAULT_PARENT_SETTINGS, DEFAULT_READING_PREFERENCES, DEFAULT_TTS_PREFERENCES, TIMINGS } from '@aide/shared';
import { describe, expect, it } from 'vitest';
import { parseCreateParentArgs } from '../../src/auth/createParent';
import { isLocked, LOGIN_LOCKOUT, LOCKOUT, lockUntilAfterFailure } from '../../src/auth/lockout';
import { timingSafeEqualString } from '../../src/auth/passwords';
import { hashSessionToken, newSessionToken } from '../../src/auth/sessions';
import { loadConfig } from '../../src/config';
import { monthStartUtc } from '../../src/db/repositories/activity';
import { mergeExercisePreferences, mergeReadingPreferences, mergeTtsPreferences } from '../../src/db/repositories/children';
import { mergeParentSettings } from '../../src/db/repositories/settings';
import { parseCursor } from '../../src/db/sync/pull';
import { clampUpdatedAt, PUSH_ORDER, rawEntityKey } from '../../src/db/sync/push';
import {
  attachmentDisposition, detectMime, resolveStoragePath, safeSegment, sanitizeFileName, stripJpegMetadata,
} from '../../src/db/storage/uploads';

describe('lockout', () => {
  it('the password lock stops at 15 minutes (§20)', () => {
    const now = 1_000_000;
    expect(lockUntilAfterFailure(5, now, LOGIN_LOCKOUT)).toBe(now + 60_000);
    expect(lockUntilAfterFailure(30, now, LOGIN_LOCKOUT)).toBe(now + 15 * 60_000);
  });

  it('no lock before 5 failures, then 1 min doubling, capped at 24 h', () => {
    const now = 1_000_000;
    expect(lockUntilAfterFailure(4, now)).toBeNull();
    expect(lockUntilAfterFailure(5, now)).toBe(now + 60_000);
    expect(lockUntilAfterFailure(6, now)).toBe(now + 120_000);
    expect(lockUntilAfterFailure(7, now)).toBe(now + 240_000);
    expect(lockUntilAfterFailure(15, now)).toBe(now + 60_000 * 1024);
    expect(lockUntilAfterFailure(16, now)).toBe(now + LOCKOUT.maxLockMs);
    expect(lockUntilAfterFailure(500, now)).toBe(now + LOCKOUT.maxLockMs);
    expect(isLocked(now + 1, now)).toBe(true);
    expect(isLocked(now, now)).toBe(false);
    expect(isLocked(null, now)).toBe(false);
  });
});

describe('session tokens and secrets', () => {
  it('tokens are 32 random bytes in base64url, stored as sha256 hex', () => {
    const a = newSessionToken();
    const b = newSessionToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a.token, 'base64url')).toHaveLength(32);
    expect(a.id).toMatch(/^[0-9a-f]{64}$/);
    expect(a.id).toBe(hashSessionToken(a.token));
    expect(a.token).not.toBe(b.token);
  });

  it('timing-safe comparison handles different lengths', () => {
    expect(timingSafeEqualString('abc', 'abc')).toBe(true);
    expect(timingSafeEqualString('abc', 'abcd')).toBe(false);
    expect(timingSafeEqualString('', 'x')).toBe(false);
  });
});

describe('config', () => {
  it('TRUST_PROXY hop count, upload quota and hash rounds', () => {
    const base = { NODE_ENV: 'test', DATABASE_URL: 'sqlite::memory:' };
    expect(loadConfig(base).trustProxy).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(loadConfig({ ...base, TRUST_PROXY: '0' }).trustProxy).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'yes please' })).toThrow(/TRUST_PROXY/);
    expect(loadConfig(base).uploadQuotaBytes).toBe(2000 * 1024 * 1024);
    expect(loadConfig({ ...base, UPLOAD_QUOTA_MB: '5' }).uploadQuotaBytes).toBe(5 * 1024 * 1024);
    expect(loadConfig(base).passwordHashRounds).toBeLessThan(10);
    expect(loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'mysql://u:p@localhost:3306/db' }).passwordHashRounds).toBeGreaterThanOrEqual(12);
  });

  it('AI providers and external worker settings (§17.4)', () => {
    const base = { NODE_ENV: 'test', DATABASE_URL: 'sqlite::memory:' };
    const sha = 'AB'.repeat(32);
    expect(loadConfig(base).ai).toMatchObject({ providerLight: 'local', providerComplex: 'local' });
    expect(loadConfig(base).worker).toEqual({ tokenSha256: null, selfReferenceTerms: [], deadlines: { light: 90_000, complex: 240_000 } });

    // Default provider: plugin path first, then a configured worker, then local.
    const worker = loadConfig({ ...base, WORKER_TOKEN_SHA256: sha });
    expect(worker.ai).toMatchObject({ providerLight: 'worker', providerComplex: 'worker' });
    expect(worker.worker.tokenSha256).toBe('ab'.repeat(32));
    expect(loadConfig({ ...base, WORKER_TOKEN_SHA256: sha, AI_PLUGIN_PATH: './plugins/p.cjs' }).ai.providerLight).toBe('plugin');
    expect(loadConfig({ ...base, WORKER_TOKEN_SHA256: sha, AI_PROVIDER: 'mock' }).ai.providerComplex).toBe('mock');
    expect(loadConfig({ ...base, AI_PROVIDER: 'worker' }).ai).toMatchObject({ providerLight: 'worker', providerComplex: 'worker' });
    expect(loadConfig({ ...base, AI_PROVIDER_LIGHT: 'worker', AI_PROVIDER_COMPLEX: 'local' }).ai).toMatchObject({ providerLight: 'worker', providerComplex: 'local' });

    const tuned = loadConfig({
      ...base, WORKER_TOKEN_SHA256: sha, WORKER_SELF_REFERENCE_TERMS: ' Robotix , Robotix Pro,,Robotix ', WORKER_DEADLINE_LIGHT_MS: '60000',
      WORKER_DEADLINE_COMPLEX_MS: '300000',
    });
    expect(tuned.worker).toEqual({ tokenSha256: 'ab'.repeat(32), selfReferenceTerms: ['Robotix', 'Robotix Pro'], deadlines: { light: 60_000, complex: 300_000 } });

    expect(() => loadConfig({ ...base, WORKER_TOKEN_SHA256: 'abc' })).toThrow(/WORKER_TOKEN_SHA256/);
    expect(() => loadConfig({ ...base, AI_PROVIDER: 'robot' })).toThrow(/AI_PROVIDER/);
    expect(() => loadConfig({ ...base, WORKER_DEADLINE_LIGHT_MS: '100' })).toThrow(/WORKER_DEADLINE_LIGHT_MS/);
    expect(() => loadConfig({ ...base, WORKER_DEADLINE_COMPLEX_MS: 'soon' })).toThrow(/WORKER_DEADLINE_COMPLEX_MS/);
  });
});

describe('settings and preferences merge with defaults', () => {
  it('fills missing sections and keys, drops unknown keys, resets invalid sections', () => {
    expect(mergeParentSettings(undefined)).toEqual(DEFAULT_PARENT_SETTINGS);
    const merged = mergeParentSettings({
      ai: { enabled: false, features: { summarize: false }, dailyRequestLimitPerChild: '99', legacyFlag: true },
      privacy: { syncAnnotations: false },
      ocr: { lowConfidenceThreshold: 500, autoServerFallback: false },
      unknownSection: { a: 1 },
    }, 42);
    expect(merged.updatedAt).toBe(42);
    expect(merged.ai.enabled).toBe(false);
    expect(merged.ai.features.summarize).toBe(false);
    expect(merged.ai.features.explainWord).toBe(true);
    expect(merged.ai.dailyRequestLimitPerChild).toBe(DEFAULT_PARENT_SETTINGS.ai.dailyRequestLimitPerChild);
    expect(merged.ai).not.toHaveProperty('legacyFlag');
    expect(merged.privacy).toEqual({ ...DEFAULT_PARENT_SETTINGS.privacy, syncAnnotations: false });
    expect(merged.ocr).toEqual(DEFAULT_PARENT_SETTINGS.ocr);
    expect(merged.safety).toEqual({ level: 'standard' });
    expect(merged).not.toHaveProperty('unknownSection');
  });

  it('child preferences: partial or legacy values merge over defaults', () => {
    expect(mergeReadingPreferences({ fontSizePx: 30 })).toEqual({ ...DEFAULT_READING_PREFERENCES, fontSizePx: 30 });
    expect(mergeReadingPreferences({ fontSizePx: 300 })).toEqual(DEFAULT_READING_PREFERENCES);
    expect(mergeTtsPreferences({ rate: 1, voiceURI: 'legacy' })).toEqual({ ...DEFAULT_TTS_PREFERENCES, rate: 1 });
    expect(mergeExercisePreferences('garbage')).toEqual(DEFAULT_EXERCISE_PREFERENCES);
  });
});

describe('sync helpers', () => {
  it('push order follows §15.2', () => {
    expect(PUSH_ORDER).toEqual(['children', 'documents', 'pages', 'exercises', 'annotations', 'answers', 'progress', 'sessions']);
  });

  it('clamps only beyond the allowed clock skew', () => {
    const t = 1_000_000;
    expect(clampUpdatedAt(t + TIMINGS.syncMaxClockSkewMs, t)).toBe(t + TIMINGS.syncMaxClockSkewMs);
    expect(clampUpdatedAt(t + TIMINGS.syncMaxClockSkewMs + 1, t)).toBe(t);
    expect(clampUpdatedAt(t - 5, t)).toBe(t - 5);
  });

  it('entity keys for rejections, even on malformed input', () => {
    expect(rawEntityKey('pages', { documentId: 'd1', pageIndex: 3 })).toBe('d1:3');
    expect(rawEntityKey('progress', { childId: 'c1', documentId: 'd1' })).toBe('c1:d1');
    expect(rawEntityKey('annotations', { id: 'x' })).toBe('x');
    expect(rawEntityKey('annotations', null)).toBe('?');
    expect(rawEntityKey('documents', { id: 'z'.repeat(500) })).toHaveLength(100);
  });

  it('cursor parsing', () => {
    expect(parseCursor(null)).toBe(0);
    expect(parseCursor('42')).toBe(42);
    expect(parseCursor('-1')).toBeNull();
    expect(parseCursor('1e3')).toBeNull();
  });
});

describe('upload storage helpers', () => {
  it('detects allowed types by magic bytes only', () => {
    expect(detectMime(Buffer.from('%PDF-1.4 rest'))).toBe('application/pdf');
    expect(detectMime(Buffer.from([0xff, 0xd8, 0xff, 0xdb]))).toBe('image/jpeg');
    expect(detectMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(detectMime(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1'))).toBe('image/webp');
    expect(detectMime(Buffer.from('\u0000\u0000\u0000\u0018ftypheic\u0000\u0000', 'latin1'))).toBe('image/heic');
    expect(detectMime(Buffer.from('\u0000\u0000\u0000\u0018ftypisom\u0000\u0000', 'latin1'))).toBeNull();
    // §20 EPUB: zip whose first entry is « mimetype » = application/epub+zip (not any zip).
    const zipHeader = (name: string, content: string): Buffer => {
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(name.length, 26);
      return Buffer.concat([header, Buffer.from(name + content, 'latin1')]);
    };
    expect(detectMime(zipHeader('mimetype', 'application/epub+zip'))).toBe('application/epub+zip');
    expect(detectMime(zipHeader('mimetype', 'application/zip-xxxxx'))).toBeNull();
    expect(detectMime(zipHeader('document', 'application/epub+zip'))).toBeNull();
    expect(detectMime(Buffer.from('GIF89a'))).toBeNull();
    expect(detectMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(detectMime(Buffer.alloc(0))).toBeNull();
  });

  it('strips EXIF/XMP segments from JPEG files and keeps everything else byte for byte', () => {
    const segment = (marker: number, payload: Buffer) => {
      const header = Buffer.from([0xff, marker, 0, 0]);
      header.writeUInt16BE(payload.length + 2, 2);
      return Buffer.concat([header, payload]);
    };
    const soi = Buffer.from([0xff, 0xd8]);
    const jfif = segment(0xe0, Buffer.from('JFIF-data', 'latin1'));
    const exif = segment(0xe1, Buffer.concat([Buffer.from('Exif', 'latin1'), Buffer.from([0, 0]), Buffer.from('GPS 48.85N 2.35E', 'latin1')]));
    const xmp = segment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/ <x:xmpmeta/>', 'latin1'));
    const dqt = segment(0xdb, Buffer.alloc(65, 3));
    const scan = Buffer.concat([segment(0xda, Buffer.alloc(10, 1)), Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]), Buffer.from([0xff, 0xd9])]);

    const withMeta = Buffer.concat([soi, jfif, exif, xmp, dqt, scan]);
    const stripped = stripJpegMetadata(withMeta);
    expect(stripped).not.toBeNull();
    expect(Buffer.compare(stripped as Buffer, Buffer.concat([soi, jfif, dqt, scan]))).toBe(0);
    expect((stripped as Buffer).includes(Buffer.from('GPS'))).toBe(false);
    expect(detectMime(stripped as Buffer)).toBe('image/jpeg');

    expect(stripJpegMetadata(Buffer.concat([soi, jfif, dqt, scan]))).toBeNull();
    expect(stripJpegMetadata(Buffer.concat([soi, jfif, exif.subarray(0, 6)]))).toBeNull();
    expect(stripJpegMetadata(Buffer.from('%PDF-1.4'))).toBeNull();
  });

  it('storage paths never leave the uploads root', () => {
    const root = process.platform === 'win32' ? 'C:\\data\\uploads' : '/data/uploads';
    expect(safeSegment('2b1f7c1e-8d3a-4f0e-9a51-0c5d8e7f6a21')).toBe('2b1f7c1e-8d3a-4f0e-9a51-0c5d8e7f6a21');
    expect(safeSegment('../../etc')).toMatch(/^[0-9a-f]{32}$/);
    expect(() => resolveStoragePath(root, '../secret.txt')).toThrow();
    expect(() => resolveStoragePath(root, 'a/../../b')).toThrow();
    expect(() => resolveStoragePath(root, '')).toThrow();
    expect(resolveStoragePath(root, 'p/d/file.pdf').startsWith(root)).toBe(true);
  });

  it('file names are sanitized and encoded for Content-Disposition', () => {
    expect(sanitizeFileName('../../x\u0000"y".pdf', 'f')).toBe('....xy.pdf');
    expect(sanitizeFileName('   ', 'fallback')).toBe('fallback');
    expect(attachmentDisposition('Élève (1).pdf')).toBe("attachment; filename=\"Eleve (1).pdf\"; filename*=UTF-8''%C3%89l%C3%A8ve%20%281%29.pdf");
  });
});

describe('misc', () => {
  it('month start in UTC', () => {
    expect(monthStartUtc(Date.UTC(2026, 8, 16, 10))).toBe(Date.UTC(2026, 8, 1));
    expect(monthStartUtc(Date.UTC(2027, 0, 1, 0, 0, 0))).toBe(Date.UTC(2027, 0, 1));
  });

  it('create-parent takes secrets from named environment variables only', () => {
    expect(parseCreateParentArgs(['--email', 'p@example.fr', '--name', 'Parent', '--password-env', 'PW', '--pin-env', 'PIN_CODE']))
      .toEqual({ email: 'p@example.fr', name: 'Parent', passwordEnv: 'PW', pinEnv: 'PIN_CODE' });
    expect(parseCreateParentArgs(['--email', 'p@example.fr', '--name', 'P', '--password', 'secret'])).toHaveProperty('error');
    expect(parseCreateParentArgs(['--email', 'p@example.fr', '--name', 'P', '--password-env', 'PW'])).toEqual({ error: 'missing required option' });
    expect(parseCreateParentArgs(['--email', 'e', '--name', 'n', '--password-env', 'A-B', '--pin-env', 'C'])).toHaveProperty('error');
  });
});
