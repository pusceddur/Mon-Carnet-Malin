import { useEffect, type JSX } from 'react';
import { setDeviceName } from './api/auth';
import { RouterProvider } from 'react-router';
import { useToast } from './design/components';
import { applyTheme } from './design/reading';
import { processingQueue } from './documents/ProcessingQueue';
import { home } from './i18n/fr/home';
import { describeThisDevice } from './platform/deviceName';
import { isStandalonePwa, requestPersistentStorage } from './platform/support';
import { router } from './routes';
import { purgeStaleOfflineCaches } from './state/offlineAssets';
import { usePwaStore } from './state/pwa';
import { useSelectedChild, useSessionStore } from './state/session';
import { startSync } from './sync/SyncEngine';
import './App.css';

let booted = false;

/** One-time boot (safe under StrictMode double effects and remounts). */
function bootOnce(): void {
  if (booted) return;
  booted = true;
  void useSessionStore.getState().init();
  try {
    processingQueue.start();
  } catch {
    // The reader still works with already processed pages.
  }
  // Home-screen apps get persistent storage without a prompt; in a Safari tab the parent asks from « Compte ».
  if (isStandalonePwa()) void requestPersistentStorage();
  void purgeStaleOfflineCaches(typeof caches === 'undefined' ? undefined : caches);
}

/** Offers the waiting service worker update without ever reloading on its own. */
function UpdateNotice(): null {
  const needRefresh = usePwaStore((s) => s.needRefresh);
  const toast = useToast();
  useEffect(() => {
    if (!needRefresh) return;
    toast.show({
      message: home.update.message,
      tone: 'info',
      durationMs: 15_000,
      action: { label: home.update.action, onClick: () => void usePwaStore.getState().applyUpdate() },
    });
    usePwaStore.getState().dismissUpdate();
  }, [needRefresh, toast]);
  return null;
}

/** The selected child's paper colour applies to the whole app (system preference otherwise). */
function ThemeSync(): null {
  const theme = useSelectedChild()?.reading.theme ?? null;
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return null;
}

/** §20: names this device in « Appareils connectés » once per start and account (best effort). */
function DeviceNameSync(): null {
  const parentId = useSessionStore((s) => (s.authStatus?.authenticated ? (s.authStatus.parent?.id ?? null) : null));
  useEffect(() => {
    if (parentId !== null) void setDeviceName({ name: describeThisDevice() }).catch(() => undefined);
  }, [parentId]);
  return null;
}

export default function App(): JSX.Element {
  useEffect(() => {
    bootOnce();
    // startSync is reference-counted: the StrictMode cleanup/re-run pair leaves exactly one running loop.
    return startSync();
  }, []);

  return (
    <>
      <ThemeSync />
      <DeviceNameSync />
      <UpdateNotice />
      <RouterProvider router={router} />
    </>
  );
}
