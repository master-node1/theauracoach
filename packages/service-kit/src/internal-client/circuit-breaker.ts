export interface CircuitBreakerOptions {
  /** Calls kept in the rolling window. */
  windowSize: number;
  /** Failure ratio in a full window that opens the circuit. */
  failureRatio: number;
  /** How long the circuit stays open before one trial call is allowed. */
  openMs: number;
  now?: () => number;
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitOpenError extends Error {
  constructor(readonly target: string) {
    super(`Circuit open for ${target}`);
  }
}

/** Per-target breaker (platform LLD §3): opens at 50% failures over 20 calls, retries after 10 s. */
export class CircuitBreaker {
  private results: boolean[] = [];
  private openedAt = 0;
  private trialInFlight = false;
  private stateValue: CircuitState = 'closed';
  private readonly now: () => number;

  constructor(
    readonly target: string,
    private readonly options: CircuitBreakerOptions = {
      windowSize: 20,
      failureRatio: 0.5,
      openMs: 10_000,
    },
  ) {
    this.now = options.now ?? Date.now;
  }

  get state(): CircuitState {
    if (this.stateValue === 'open' && this.now() - this.openedAt >= this.options.openMs) {
      this.stateValue = 'half-open';
    }
    return this.stateValue;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.state;
    if (state === 'open' || (state === 'half-open' && this.trialInFlight)) {
      throw new CircuitOpenError(this.target);
    }
    const isTrial = state === 'half-open';
    if (isTrial) this.trialInFlight = true;
    try {
      const value = await fn();
      this.record(true, isTrial);
      return value;
    } catch (err) {
      this.record(false, isTrial);
      throw err;
    } finally {
      if (isTrial) this.trialInFlight = false;
    }
  }

  private record(ok: boolean, wasTrial: boolean): void {
    if (wasTrial) {
      if (ok) {
        this.stateValue = 'closed';
        this.results = [];
      } else {
        this.trip();
      }
      return;
    }
    this.results.push(ok);
    if (this.results.length > this.options.windowSize) this.results.shift();
    const failures = this.results.filter((r) => !r).length;
    if (
      this.results.length >= this.options.windowSize &&
      failures / this.results.length >= this.options.failureRatio
    ) {
      this.trip();
    }
  }

  private trip(): void {
    this.stateValue = 'open';
    this.openedAt = this.now();
    this.results = [];
  }
}
