// In-process transport for tests, e2e and the offline evaluation: canned outputs or a deterministic generator.
import { segmentSentences, tokenizeWords } from '@aide/shared';
import { AITransportError, type AITier, type AITransport, type AITransportErrorKind, type AITransportOperation, type AITransportRequest, type AITransportResponse } from './plugin';

export type CannedOutput =
  | { json: unknown; model?: string; inputTokens?: number; outputTokens?: number; costMicros?: number; delayMs?: number }
  | { refusal: true; delayMs?: number }
  | { truncated: true; delayMs?: number }
  | { error: AITransportErrorKind; delayMs?: number }
  | ((req: AITransportRequest) => AITransportResponse | Promise<AITransportResponse>);

export interface MockTransportOptions {
  name?: string;
  configured?: boolean;
  tiers?: readonly AITier[];
  selfReferenceTerms?: readonly string[];
  /** Used when no canned output is queued for the operation. Defaults to the deterministic generator. */
  fallback?: ((req: AITransportRequest) => AITransportResponse | Promise<AITransportResponse>) | null;
  defaultDelayMs?: number;
  costMicrosPerCall?: number;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AITransportError('timeout', 'aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AITransportError('timeout', 'aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Text between <texte_du_document> tags without our own markup. */
export function documentTextOf(req: AITransportRequest): string {
  const raw = req.documentText ?? '';
  const inner = /<texte_du_document>([\s\S]*)<\/texte_du_document>/.exec(raw)?.[1] ?? raw;
  return inner.replace(/<[^>]+>/g, '\n').replace(/[⟦⟧]/g, '').replace(/\n{2,}/g, '\n').trim();
}

function firstPageIndex(req: AITransportRequest): number {
  const m = /<(?:page index|extrait pages|citation page)="(\d+)/.exec(req.documentText ?? '');
  return m ? Number(m[1]) : 0;
}

/** Verbatim sentences of the document, each cut to at most `maxWords` words. */
export function verbatimSentences(text: string, maxWords = 18): string[] {
  const out: string[] = [];
  const spans = segmentSentences(text);
  const pieces = spans.length > 0 ? spans.map((s) => text.slice(s.start, s.end)) : [text];
  for (const piece of pieces.flatMap((p) => p.split(/\n+/))) {
    const tokens = tokenizeWords(piece);
    if (tokens.length === 0) continue;
    const cut = tokens.length > maxWords ? piece.slice(0, tokens[maxWords - 1]!.end) : piece;
    out.push(cut.trim());
  }
  return out;
}

const EXPLANATION = 'Ce passage donne une information importante du texte. Relis la phrase citée pour bien la comprendre.';
const FREE_ANSWER = "C'est une bonne question. Les scientifiques observent le monde et font des expériences pour trouver la réponse. Tu peux en apprendre plus dans un livre documentaire.";
const FREE_ANSWER_SIMPLER = 'Les scientifiques regardent le monde avec attention. Ils essaient, puis ils vérifient.';
const FREE_EXAMPLE = 'Comme toi quand tu testes si un objet flotte dans le bain.';
const FREE_SUGGESTIONS = ['Comment travaillent les scientifiques ?', 'Où trouver un livre documentaire ?'];

/** Deterministic valid outputs built from the request (quotes are verbatim document sentences). */
export function generateMockOutput(req: AITransportRequest): unknown {
  const sentences = verbatimSentences(documentTextOf(req));
  const quote = sentences[0] ?? '';
  const page = firstPageIndex(req);
  switch (req.operation) {
    case 'explain_word':
    case 'explain_text':
      return { status: 'ok', explanation: EXPLANATION, example: null, sourceQuotes: quote ? [quote] : [] };
    case 'simplify_text':
      return { status: 'ok', simplifiedText: documentTextOf(req) };
    case 'summarize_chunk':
      return { status: 'ok', summary: sentences.slice(0, 2).join(' '), keyQuotes: quote ? [quote] : [] };
    case 'summarize':
    case 'summarize_final': {
      const quotes = [...(req.documentText ?? '').matchAll(/<citation page="(\d+)">([\s\S]*?)<\/citation>/g)].map((m) => ({ pageIndex: Number(m[1]), quote: m[2] ?? '' }));
      const summaries = [...(req.documentText ?? '').matchAll(/<resume>([\s\S]*?)<\/resume>/g)].map((m) => m[1] ?? '');
      const keyPoints = summaries.map((summary) => verbatimSentences(summary, 15)[0] ?? '').filter((k) => k !== '').slice(0, 3);
      return { status: 'ok', summary: summaries.join(' '), keyPoints, sourceRefs: quotes.slice(0, 3) };
    }
    case 'generate_questions': {
      const count = Number(/Nombre de questions : (\d+)/.exec(req.userText)?.[1] ?? '3');
      const wantsVf = /vrai_faux/.test(req.userText) || !/qcm/.test(req.userText);
      const questions = sentences.slice(0, count).map((s) => ({
        type: wantsVf ? 'vrai_faux' : 'qcm',
        prompt: wantsVf ? `Vrai ou faux : « ${s} »` : `Cette phrase est-elle dans le texte : « ${s} » ?`,
        source: { pageIndex: page, quote: s },
        choices: wantsVf ? null : ['Oui', 'Non'],
        correctIndex: wantsVf ? null : 0,
        answer: wantsVf ? true : null,
        explanation: 'Relis cette phrase dans le texte.',
        expectedAnswer: null, keyPoints: null, pairs: null, itemsInOrder: null,
      }));
      return { status: 'ok', questions };
    }
    case 'correct_answer':
      return { status: 'ok', verdict: 'partiel', feedback: 'Tu as bien commencé. Relis le passage pour compléter ta réponse.', rereadRef: quote ? { pageIndex: page, quote } : null };
    case 'question_on_text':
      return quote
        ? { status: 'ok', answer: 'La réponse se trouve dans cette phrase du texte.', sourceRefs: [{ pageIndex: page, quote }] }
        : { status: 'not_in_text', answer: '', sourceRefs: [] };
    case 'recognize_handwriting':
      return { status: 'ok', text: 'réponse écrite' };
    case 'correct_writing': {
      // Capital letter at the start of each line and a full stop at its end: a valid correction of any text.
      const json = /<texte_de_l_enfant>\n([\s\S]*?)\n<\/texte_de_l_enfant>/.exec(req.userText)?.[1] ?? '[]';
      const lines = (JSON.parse(json) as string[]).map((line) => {
        if (line.trim() === '') return '';
        const capital = line.charAt(0).toUpperCase() + line.slice(1);
        return /[.!?…]$/.test(capital) ? capital : `${capital}.`;
      });
      return { status: 'ok', lines, notes: [{ from: 'x', to: 'X', rule: 'Majuscule au début de la phrase.' }] };
    }
    case 'free_question':
      return /Réexplique beaucoup plus simplement/.test(req.userText)
        ? { status: 'ok', answer: FREE_ANSWER_SIMPLER, example: FREE_EXAMPLE, suggestions: [] }
        : { status: 'ok', answer: FREE_ANSWER, example: null, suggestions: FREE_SUGGESTIONS };
  }
}

export class MockTransport implements AITransport {
  readonly name: string;
  readonly selfReferenceTerms: readonly string[];
  readonly requests: AITransportRequest[] = [];
  private readonly queues = new Map<AITransportOperation, CannedOutput[]>();
  private readonly configured: boolean;
  private readonly tiers: readonly AITier[];
  private readonly fallback: ((req: AITransportRequest) => AITransportResponse | Promise<AITransportResponse>) | null;
  private readonly defaultDelayMs: number;
  private readonly costMicrosPerCall: number;

  constructor(options: MockTransportOptions = {}) {
    this.name = options.name ?? 'mock';
    this.configured = options.configured ?? true;
    this.tiers = options.tiers ?? ['light', 'complex'];
    this.selfReferenceTerms = options.selfReferenceTerms ?? ['Mockito'];
    this.defaultDelayMs = options.defaultDelayMs ?? 0;
    this.costMicrosPerCall = options.costMicrosPerCall ?? 0;
    this.fallback = options.fallback === undefined
      ? (req) => this.response(req, generateMockOutput(req))
      : options.fallback;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  supports(tier: AITier): boolean {
    return this.configured && this.tiers.includes(tier);
  }

  enqueue(operation: AITransportOperation, ...outputs: CannedOutput[]): this {
    const queue = this.queues.get(operation) ?? [];
    queue.push(...outputs);
    this.queues.set(operation, queue);
    return this;
  }

  pending(operation: AITransportOperation): number {
    return this.queues.get(operation)?.length ?? 0;
  }

  callsFor(operation: AITransportOperation): AITransportRequest[] {
    return this.requests.filter((r) => r.operation === operation);
  }

  private response(req: AITransportRequest, json: unknown, extra: Partial<AITransportResponse> = {}): AITransportResponse {
    return {
      json, refusal: false, truncated: false, model: `${this.name}-${req.tier}`,
      inputTokens: Math.ceil(((req.documentText?.length ?? 0) + req.userText.length + req.system.length) / 4),
      outputTokens: Math.ceil(JSON.stringify(json ?? null).length / 4),
      costMicros: this.costMicrosPerCall,
      ...extra,
    };
  }

  async complete(req: AITransportRequest): Promise<AITransportResponse> {
    this.requests.push(req);
    const next = this.queues.get(req.operation)?.shift();
    if (typeof next === 'function') return next(req);
    const delay = next?.delayMs ?? this.defaultDelayMs;
    if (delay > 0) await sleep(delay, req.signal);
    if (req.signal.aborted) throw new AITransportError('timeout', 'aborted');
    if (next === undefined) {
      if (!this.fallback) throw new AITransportError('unavailable', `no canned output for ${req.operation}`);
      return this.fallback(req);
    }
    if ('error' in next) throw new AITransportError(next.error, `mock ${next.error}`);
    if ('refusal' in next) return this.response(req, null, { refusal: true, outputTokens: 0 });
    if ('truncated' in next) return this.response(req, null, { truncated: true });
    return this.response(req, next.json, {
      ...(next.model !== undefined ? { model: next.model } : {}),
      ...(next.inputTokens !== undefined ? { inputTokens: next.inputTokens } : {}),
      ...(next.outputTokens !== undefined ? { outputTokens: next.outputTokens } : {}),
      ...(next.costMicros !== undefined ? { costMicros: next.costMicros } : {}),
    });
  }
}
