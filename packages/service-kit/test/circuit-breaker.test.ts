import { describe, expect, it } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../src';

function breaker() {
  let now = 0;
  const b = new CircuitBreaker('x', {
    windowSize: 4,
    failureRatio: 0.5,
    openMs: 1000,
    now: () => now,
  });
  return { b, advance: (ms: number) => (now += ms) };
}
const ok = () => Promise.resolve('ok');
const fail = () => Promise.reject(new Error('boom'));

describe('CircuitBreaker', () => {
  it('stays closed until the window is full', async () => {
    const { b } = breaker();
    await expect(b.run(fail)).rejects.toThrow('boom');
    await expect(b.run(fail)).rejects.toThrow('boom');
    await expect(b.run(fail)).rejects.toThrow('boom');
    expect(b.state).toBe('closed');
  });

  it('opens at the failure ratio and rejects fast while open', async () => {
    const { b } = breaker();
    await b.run(ok);
    await b.run(ok);
    await expect(b.run(fail)).rejects.toThrow();
    await expect(b.run(fail)).rejects.toThrow();
    expect(b.state).toBe('open');
    await expect(b.run(ok)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('half-opens after the open period, closes on a good trial and reopens on a bad one', async () => {
    const { b, advance } = breaker();
    for (let i = 0; i < 4; i++) await expect(b.run(fail)).rejects.toThrow();
    advance(1000);
    expect(b.state).toBe('half-open');
    await expect(b.run(fail)).rejects.toThrow('boom');
    expect(b.state).toBe('open');
    advance(1000);
    await expect(b.run(ok)).resolves.toBe('ok');
    expect(b.state).toBe('closed');
  });
});
