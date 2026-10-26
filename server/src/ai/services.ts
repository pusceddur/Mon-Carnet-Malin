// Wiring of the AI layer from AppDeps (memoized per AppDeps instance: one plugin load, one word list).
import { AI_DEADLINES } from '@aide/shared';
import { getChild } from '../db/repositories/children';
import { getParentSettings } from '../db/repositories/settings';
import { createAICacheRepository } from '../db/repositories/aiCache';
import { createAIJobsRepository } from '../db/repositories/aiJobs';
import { createAIRequestsRepository } from '../db/repositories/aiRequests';
import { createFreeQuestionsRepository } from '../db/repositories/freeQuestions';
import { createWritingCorrectionsRepository } from '../db/repositories/writingCorrections';
import { createSafetyAlertsRepository } from '../db/repositories/safetyAlerts';
import { createDictionaryService } from '../dictionary/DictionaryService';
import type { AIProviderName } from '../config';
import type { AppDeps } from '../types';
import { QueueTransport } from '../worker/QueueTransport';
import { WORKER_PROTOCOL } from '../worker/protocol';
import { getWorkerRuntime } from '../worker/runtime';
import type { AIProvider } from './AIProvider';
import { AIRouter, type AIStore } from './AIRouter';
import { LocalProvider } from './LocalProvider';
import { MockProvider } from './MockProvider';
import { FailoverTransport } from './FailoverTransport';
import { OpenAICompatibleTransport } from './OpenAICompatibleTransport';
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
      return child ? { readingLevel: child.readingLevel, explanationDifficulty: child.explanationDifficulty } : null;
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
  const chains = {
    light: [config.ai.providerLight, config.ai.fallbackLight].filter((n): n is AIProviderName => n !== null),
    complex: [config.ai.providerComplex, config.ai.fallbackComplex].filter((n): n is AIProviderName => n !== null),
  };
  const names = new Set([...chains.light, ...chains.complex]);

  // One transport per provider named anywhere, shared by both tiers (one plugin load, one worker queue).
  const transports = new Map<AIProviderName, AITransport>();
  if (names.has('plugin')) {
    const plugin = await loadAIPlugin(config.ai.pluginPath, logger);
    if (plugin) transports.set('plugin', plugin);
    else logger.warn('ai_plugin_not_available', { light: chains.light, complex: chains.complex });
  }
  if (names.has('openai')) {
    if (config.openai) {
      transports.set('openai', new OpenAICompatibleTransport({ config: config.openai, logger: logger.child({ component: 'ai_openai' }) }));
    } else {
      logger.warn('ai_openai_not_configured', { light: chains.light, complex: chains.complex });
    }
  }
  if (names.has('worker')) {
    const queue = createQueueTransport(deps);
    if (!queue.isConfigured()) logger.warn('ai_worker_not_configured', { light: chains.light, complex: chains.complex });
    transports.set('worker', queue);
  }
  const mock = names.has('mock') ? new MockProvider() : null;
  if (mock) transports.set('mock', mock.mock);

  const built = new Map<string, AIProvider>();
  const providerOf = (chain: readonly AIProviderName[]): AIProvider | null => {
    const members = chain.flatMap((name) => {
      const transport = transports.get(name);
      return transport ? [{ name, transport }] : [];
    });
    const first = members[0];
    if (!first) return null;
    const key = members.map((m) => m.name).join('>');
    const existing = built.get(key);
    if (existing) return existing;
    let provider: AIProvider;
    if (members.length === 1) {
      provider = first.name === 'mock' && mock ? mock : new RemoteProvider(first.transport, first.name, { forwardParentId: first.name === 'worker' });
    } else {
      // IA 1 then IA 2 (AI_FALLBACK): the request log names the first; the model column says which one answered.
      const failover = new FailoverTransport(
        members.map((m) => ({ transport: m.transport, receivesParentId: m.name === 'worker' })),
        { logger: logger.child({ component: 'ai_failover' }), now: () => deps.now() },
      );
      provider = new RemoteProvider(failover, first.name, { forwardParentId: true });
    }
    built.set(key, provider);
    return provider;
  };
  const providers = { light: providerOf(chains.light), complex: providerOf(chains.complex) };
  // §17.4: the worker has its own deadlines, and every request it serves goes through an asynchronous job.
  // `worker.deadlines[tier]` is the budget of one run on the worker (routes/worker.ts deadlineFor); the end-to-end
  // deadline of the router adds the queue wait, otherwise a job sent while the worker is busy with another one spends
  // its own budget queueing and times out before it is ever leased. With the worker as second AI, the first one's
  // attempt comes on top (OPENAI_TIMEOUT_MS keeps it short).
  const deadlineOf = (tier: AITier): number => {
    if (!chains[tier].includes('worker')) return AI_DEADLINES[tier];
    const worker = config.worker.deadlines[tier] + WORKER_PROTOCOL.queueGraceMs;
    return chains[tier][0] === 'worker' ? worker : worker + (config.openai?.timeoutMs ?? AI_DEADLINES[tier]);
  };

  const router = new AIRouter({
    now: () => deps.now(),
    logger: logger.child({ component: 'ai' }),
    store: createAIStore(deps),
    cache: createAICacheRepository(deps.db),
    requests: createAIRequestsRepository(deps.db),
    alerts: createSafetyAlertsRepository(deps.db),
    jobs: createAIJobsRepository(deps.db),
    freeQuestions: createFreeQuestionsRepository(deps.db),
    writingCorrections: createWritingCorrectionsRepository(deps.db),
    providers,
    local: new LocalProvider(),
    dictionary: createDictionaryService(deps),
    isKnownWord: loadKnownWords(logger),
    asyncRoutes: chains.light.includes('worker') ? 'all' : 'complex',
    deadlines: { light: deadlineOf('light'), complex: deadlineOf('complex') },
  });
  const health = aiHealthOf({ providers });
  logger.info('ai_services_ready', { light: health.light, complex: health.complex, chainLight: chains.light, chainComplex: chains.complex });
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
