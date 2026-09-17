// Wiring of the AI layer from AppDeps (memoized per AppDeps instance: one plugin load, one word list).
import { AI_DEADLINES } from '@aide/shared';
import { getChild } from '../db/repositories/children';
import { getParentSettings } from '../db/repositories/settings';
import { createAICacheRepository } from '../db/repositories/aiCache';
import { createAIJobsRepository } from '../db/repositories/aiJobs';
import { createAIRequestsRepository } from '../db/repositories/aiRequests';
import { createSafetyAlertsRepository } from '../db/repositories/safetyAlerts';
import { createDictionaryService } from '../dictionary/DictionaryService';
import type { AppDeps } from '../types';
import { QueueTransport } from '../worker/QueueTransport';
import { getWorkerRuntime } from '../worker/runtime';
import type { AIProvider } from './AIProvider';
import { AIRouter, type AIStore } from './AIRouter';
import { LocalProvider } from './LocalProvider';
import { MockProvider } from './MockProvider';
import { loadAIPlugin, type AITier, type AITransport } from './plugin';
import { RemoteProvider } from './RemoteProvider';
import { loadKnownWords } from './wordList';

export interface AIServices {
  router: AIRouter;
  providers: { light: AIProvider | null; complex: AIProvider | null };
}

export function aiHealthOf(services: Pick<AIServices, 'providers'>): { light: boolean; complex: boolean } {
  const serves = (tier: AITier): boolean => services.providers[tier]?.supportsTier(tier) ?? false;
  return { light: serves('light'), complex: serves('complex') };
}

/** Refreshes the cached availability of the providers (worker presence), then reports it. Never throws. */
export async function refreshedAIHealthOf(services: Pick<AIServices, 'providers'>): Promise<{ light: boolean; complex: boolean }> {
  const providers = [...new Set([services.providers.light, services.providers.complex])];
  await Promise.all(providers.map((p) => p?.refresh?.().catch(() => undefined)));
  return aiHealthOf(services);
}

export function createAIStore(deps: AppDeps): AIStore {
  return {
    async getLearner(parentId, childId) {
      const child = await getChild(deps.db, parentId, childId);
      return child ? { age: child.age, readingLevel: child.readingLevel, explanationDifficulty: child.explanationDifficulty } : null;
    },
    getSettings: (parentId) => getParentSettings(deps.db, parentId),
  };
}

/** The built-in worker queue transport of `deps` (§17.4). */
export function createQueueTransport(deps: AppDeps): QueueTransport {
  return new QueueTransport({
    db: deps.db,
    now: () => deps.now(),
    logger: deps.logger.child({ component: 'worker_transport' }),
    runtime: getWorkerRuntime(deps),
    configured: deps.config.worker.tokenSha256 !== null,
    selfReferenceTerms: deps.config.worker.selfReferenceTerms,
  });
}

async function buildServices(deps: AppDeps): Promise<AIServices> {
  const { config, logger } = deps;
  const names = [config.ai.providerLight, config.ai.providerComplex];
  let transport: AITransport | null = null;
  if (names.includes('plugin')) {
    transport = await loadAIPlugin(config.ai.pluginPath, logger);
    if (!transport) logger.warn('ai_plugin_not_available', { light: config.ai.providerLight, complex: config.ai.providerComplex });
  }
  const remote = transport ? new RemoteProvider(transport, 'plugin') : null;
  const mock = names.includes('mock') ? new MockProvider() : null;
  let worker: RemoteProvider | null = null;
  if (names.includes('worker')) {
    const queue = createQueueTransport(deps);
    if (!queue.isConfigured()) logger.warn('ai_worker_not_configured', { light: config.ai.providerLight, complex: config.ai.providerComplex });
    worker = new RemoteProvider(queue, 'worker', { forwardParentId: true });
  }
  const pick = (name: string): AIProvider | null => {
    switch (name) {
      case 'plugin': return remote;
      case 'mock': return mock;
      case 'worker': return worker;
      default: return null;
    }
  };
  const providers = { light: pick(config.ai.providerLight), complex: pick(config.ai.providerComplex) };
  // §17.4: the worker has its own deadlines, and every request it serves goes through an asynchronous job.
  const deadlineOf = (tier: AITier): number => (config.ai[tier === 'light' ? 'providerLight' : 'providerComplex'] === 'worker'
    ? config.worker.deadlines[tier]
    : AI_DEADLINES[tier]);

  const router = new AIRouter({
    now: () => deps.now(),
    logger: logger.child({ component: 'ai' }),
    store: createAIStore(deps),
    cache: createAICacheRepository(deps.db),
    requests: createAIRequestsRepository(deps.db),
    alerts: createSafetyAlertsRepository(deps.db),
    jobs: createAIJobsRepository(deps.db),
    providers,
    local: new LocalProvider(),
    dictionary: createDictionaryService(deps),
    isKnownWord: loadKnownWords(logger),
    asyncRoutes: config.ai.providerLight === 'worker' ? 'all' : 'complex',
    deadlines: { light: deadlineOf('light'), complex: deadlineOf('complex') },
  });
  const health = aiHealthOf({ providers });
  logger.info('ai_services_ready', { light: health.light, complex: health.complex, providerLight: config.ai.providerLight, providerComplex: config.ai.providerComplex });
  return { router, providers };
}

const services = new WeakMap<AppDeps, Promise<AIServices>>();

/** The services of `deps` if they were already built (never builds them: graceful shutdown). */
export function peekAIServices(deps: AppDeps): Promise<AIServices> | null {
  return services.get(deps) ?? null;
}

export function getAIServices(deps: AppDeps): Promise<AIServices> {
  let pending = services.get(deps);
  if (!pending) {
    pending = buildServices(deps);
    services.set(deps, pending);
  }
  return pending;
}
