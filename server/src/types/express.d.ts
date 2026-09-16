declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth. */
      auth?: { userId: string; sessionId: string; parentUnlockedUntil: number | null };
    }
  }
}

export {};
