// Detection of the installed iPad app (native shell around the same web app).
import { Capacitor } from '@capacitor/core';

/** True inside the native iPad app, false in Safari / the home-screen web app / tests. */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** True when the native shell exposes the plugin `name`. */
export function isNativePluginAvailable(name: string): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable(name);
  } catch {
    return false;
  }
}
