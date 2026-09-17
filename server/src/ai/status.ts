import type { AppDeps } from '../types';
import { getAIServices, refreshedAIHealthOf } from './services';

/**
 * AI availability per tier for GET /api/health (true when a configured provider serves the tier). Never throws.
 * The worker presence is read from a per-process cache refreshed at most every few seconds: the health check stays fast.
 */
export async function aiHealth(deps: AppDeps): Promise<{ light: boolean; complex: boolean }> {
  try {
    return await refreshedAIHealthOf(await getAIServices(deps));
  } catch (err) {
    deps.logger.error('ai_health_failed', { error: err });
    return { light: false, complex: false };
  }
}
