// §20 « Appareils connectés »: what the account can see of its sessions (never the token nor its hash).
import { createHash } from 'node:crypto';
import type { DeviceKind, DeviceSession } from '@aide/shared';
import type { SessionRecord } from '../db/repositories/sessions';

/** Short public id of a session, derived from its stored hash (the cookie token cannot be found from it). */
export function publicSessionId(sessionId: string): string {
  return createHash('sha256').update(`device:${sessionId}`, 'utf8').digest('hex').slice(0, 16);
}

/** Device family and browser from the user agent. An iPad in Safari presents itself as a Mac: the app names it. */
export function describeUserAgent(userAgent: string | null): { device: DeviceKind; browser: string } {
  const ua = userAgent ?? '';
  const device: DeviceKind = /iPad/.test(ua)
    ? 'ipad'
    : /iPhone|iPod/.test(ua)
      ? 'iphone'
      : /Android/.test(ua)
        ? 'android'
        : /Windows/.test(ua)
          ? 'windows'
          : /Macintosh|Mac OS X/.test(ua)
            ? 'mac'
            : /Linux|X11/.test(ua)
              ? 'linux'
              : 'other';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\/|FxiOS/.test(ua)
      ? 'Firefox'
      : /Chrome\/|CriOS/.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : ua === '' ? '' : 'Autre';
  return { device, browser };
}

export function toDeviceSession(session: SessionRecord, currentSessionId: string): DeviceSession {
  const { device, browser } = describeUserAgent(session.userAgent);
  return {
    id: publicSessionId(session.id),
    current: session.id === currentSessionId,
    name: session.deviceName,
    device,
    browser,
    ip: session.ip,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
  };
}
