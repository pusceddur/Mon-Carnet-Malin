// AI_FALLBACK: a second AI behind the first. The first one answers whenever it can; when it cannot — unreachable,
// over its limit, too slow, or refusing the request outright — the same request goes to the second one, inside the
// same deadline. The router sees a single transport and its rules (validation, one regeneration, local fallback)
// stay as they are.
import type { Logger } from '../logger';
import { AITransportError, isAITransportError, type AITier, type AITransport, type AITransportRequest, type AITransportResponse } from './plugin';

export interface FailoverMember {
  transport: AITransport;
  /** Only the built-in worker queue may know who asked (job ownership); every other member is called without it. */
  receivesParentId: boolean;
}

export interface FailoverTransportOptions {
  logger: Logger;
  now(): number;
  /** After a failure, how long the member is skipped, so that each request does not wait for it again. */
  cooldownMs?: number;
}

/** Long enough to skip a machine that is off, short enough to notice it came back. */
const DEFAULT_COOLDOWN_MS = 60_000;
/** Below this, there is no point starting the next member: it could not answer in time. */
const MIN_REMAINING_MS = 3_000;

export class FailoverTransport implements AITransport {
  readonly name: string;
  readonly selfReferenceTerms: readonly string[];
  private readonly downUntil = new Map<FailoverMember, number>();

  constructor(private readonly members: readonly FailoverMember[], private readonly options: FailoverTransportOptions) {
    this.name = members.map((m) => m.transport.name).join('>');
    this.selfReferenceTerms = [...new Set(members.flatMap((m) => m.transport.selfReferenceTerms))];
  }

  isConfigured(): boolean {
    return this.members.some((m) => m.transport.isConfigured());
  }

  supports(tier: AITier): boolean {
    return this.members.some((m) => this.usable(m, tier));
  }

  async refresh(): Promise<void> {
    await Promise.all(this.members.map((m) => m.transport.refresh?.().catch(() => undefined)));
  }

  async complete(req: AITransportRequest): Promise<AITransportResponse> {
    const startedAt = this.options.now();
    const ready = this.members.filter((m) => this.usable(m, req.tier));
    // All of them resting after a failure: trying them again beats answering « unavailable » without asking.
    const candidates = ready.length > 0 ? ready : this.members.filter((m) => m.transport.isConfigured() && m.transport.supports(req.tier));
    let lastError: unknown = new AITransportError('unavailable', 'no AI available');

    for (const [index, member] of candidates.entries()) {
      const remaining = req.deadlineMs - (this.options.now() - startedAt);
      if (req.signal.aborted) throw new AITransportError('timeout', 'aborted');
      if (index > 0 && remaining < MIN_REMAINING_MS) break;
      const { parentId, ...rest } = req;
      try {
        const response = await member.transport.complete({
          ...rest,
          deadlineMs: Math.max(1, remaining),
          ...(member.receivesParentId && parentId !== undefined ? { parentId } : {}),
        });
        this.downUntil.delete(member);
        // Which of the two answered, for the server log (ai_requests.model): never shown to the family.
        return { ...response, model: `${member.transport.name}:${response.model}` };
      } catch (err) {
        // The caller gave up (client gone, router deadline): nobody is waiting for the second answer.
        if (req.signal.aborted) throw err;
        lastError = err;
        const kind = isAITransportError(err) ? err.kind : 'unknown';
        // A request it cannot take (an image for a text-only model) says nothing about the next one.
        if (kind !== 'bad_request') this.downUntil.set(member, this.options.now() + (this.options.cooldownMs ?? DEFAULT_COOLDOWN_MS));
        const next = candidates[index + 1];
        this.options.logger.warn('ai_failover', { operation: req.operation, failed: member.transport.name, kind, next: next?.transport.name ?? null });
      }
    }
    throw lastError;
  }

  private usable(member: FailoverMember, tier: AITier): boolean {
    const resting = (this.downUntil.get(member) ?? 0) > this.options.now();
    return !resting && member.transport.isConfigured() && member.transport.supports(tier);
  }
}
