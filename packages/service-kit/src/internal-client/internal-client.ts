import type { ServiceName } from '@aura/contracts';
import { INTERNAL_TOKEN_HEADER, mintServiceToken } from '../auth/service-token';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

export interface InternalCallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path under the target, starting with /internal/v1/. */
  path: string;
  /** Internal user id when acting for a user. */
  asUser?: string;
  body?: unknown;
  /** Required for writes that may be retried. */
  idempotencyKey?: string;
  timeoutMs?: number;
  requestId?: string;
}

export class InternalCallError extends Error {
  constructor(
    readonly target: string,
    readonly status: number | null,
    message: string,
    readonly problem?: unknown,
  ) {
    super(message);
  }

  /** True for timeouts, network errors, open circuits and 5xx. Callers fall back or degrade on these. */
  get isUnavailable(): boolean {
    return this.status === null || this.status >= 500;
  }
}

export interface InternalClientOptions {
  self: ServiceName;
  secret: string;
  urls: Partial<Record<ServiceName, string>>;
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
  retryDelayMs?: () => number;
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);

/**
 * Typed service-to-service HTTP (platform LLD §3): service token per call, 2 s timeout,
 * one jittered retry for GETs and idempotent writes, and a circuit breaker per target.
 */
export class InternalClient {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: InternalClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async call<T>(target: ServiceName, opts: InternalCallOptions): Promise<T> {
    const base = this.options.urls[target];
    if (!base) throw new InternalCallError(target, null, `No URL configured for ${target}`);
    if (!opts.path.startsWith('/internal/v1/')) {
      throw new InternalCallError(target, null, 'Internal calls must target /internal/v1/');
    }
    const method = opts.method ?? 'GET';
    const retryable = method === 'GET' || Boolean(opts.idempotencyKey);
    const breaker = this.breaker(target);

    const attempt = () => breaker.run(() => this.send<T>(target, base, method, opts));
    try {
      return await attempt();
    } catch (err) {
      if (!retryable || !(err instanceof InternalCallError) || !err.isUnavailable)
        throw wrap(target, err);
      if (err.status !== null && !RETRYABLE_STATUS.has(err.status)) throw err;
      await sleep(this.options.retryDelayMs?.() ?? 50 + Math.random() * 150);
      try {
        return await attempt();
      } catch (retryErr) {
        throw wrap(target, retryErr);
      }
    }
  }

  private breaker(target: string): CircuitBreaker {
    let b = this.breakers.get(target);
    if (!b) {
      b = new CircuitBreaker(target);
      this.breakers.set(target, b);
    }
    return b;
  }

  private async send<T>(
    target: ServiceName,
    base: string,
    method: string,
    opts: InternalCallOptions,
  ): Promise<T> {
    const token = await mintServiceToken({
      secret: this.options.secret,
      issuer: this.options.self,
      audience: target,
      ...(opts.asUser ? { subUser: opts.asUser } : {}),
    });
    const headers: Record<string, string> = {
      [INTERNAL_TOKEN_HEADER]: token,
      accept: 'application/json',
    };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
    if (opts.requestId) headers['x-request-id'] = opts.requestId;

    let res: Response;
    try {
      res = await this.fetchImpl(base + opts.path, {
        method,
        headers,
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        signal: AbortSignal.timeout(opts.timeoutMs ?? this.options.defaultTimeoutMs ?? 2000),
      });
    } catch (err) {
      const timedOut =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new InternalCallError(target, null, timedOut ? 'Timed out' : 'Network error');
    }
    const text = await res.text();
    const parsed = text ? safeJson(text) : undefined;
    if (!res.ok) throw new InternalCallError(target, res.status, `HTTP ${res.status}`, parsed);
    return parsed as T;
  }
}

function wrap(target: string, err: unknown): InternalCallError {
  if (err instanceof InternalCallError) return err;
  if (err instanceof CircuitOpenError) return new InternalCallError(target, null, err.message);
  return new InternalCallError(target, null, 'Unexpected error');
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
