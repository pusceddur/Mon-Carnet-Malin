// §20 name of this device in « Appareils connectés » (an iPad in Safari presents itself as a Mac to the server).
import { isNativeApp } from './nativeApp';
import { isIPad, isStandalonePwa, type NavigatorLike } from './support';

export interface DeviceNameEnv {
  navigator?: NavigatorLike;
  native?: boolean;
  standalone?: boolean;
}

function browserOf(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Firefox\/|FxiOS/.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS/.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'navigateur';
}

/** « iPad · app installée », « iPad · Safari », « Ordinateur Windows · Chrome »… */
export function describeThisDevice(env: DeviceNameEnv = {}): string {
  const nav = env.navigator ?? (typeof navigator === 'undefined' ? undefined : navigator);
  const ua = nav?.userAgent ?? '';
  const device = isIPad(nav)
    ? 'iPad'
    : /iPhone|iPod/.test(ua)
      ? 'iPhone'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Ordinateur Windows'
          : /Macintosh|Mac OS X/.test(ua)
            ? 'Mac'
            : /Linux|X11/.test(ua)
              ? 'Ordinateur Linux'
              : 'Appareil';
  const native = env.native ?? isNativeApp();
  const standalone = env.standalone ?? isStandalonePwa();
  const where = native ? 'app iPad' : standalone ? 'app installée' : browserOf(ua);
  return `${device} · ${where}`.slice(0, 60);
}
