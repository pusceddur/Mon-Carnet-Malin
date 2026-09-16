import { useEffect, type JSX } from 'react';
import { RouterProvider } from 'react-router';
import { processingQueue } from './documents/ProcessingQueue';
import { router } from './routes';
import { useSessionStore } from './state/session';
import { startSync } from './sync/SyncEngine';

export default function App(): JSX.Element {
  useEffect(() => {
    // Boot sequence. These calls must be idempotent (React StrictMode runs effects twice in development).
    void useSessionStore.getState().init();
    processingQueue.start();
    return startSync();
  }, []);

  return <RouterProvider router={router} />;
}
