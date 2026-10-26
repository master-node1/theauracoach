import { ROOT_CONTEXT, trace } from '@opentelemetry/api';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  contextFromTraceparent,
  currentTraceparent,
  loadTelemetryConfig,
  traceLogFields,
} from '../src';
import { testTracer, useInMemoryTracing } from './tracing';

const exporter = useInMemoryTracing();
beforeEach(() => exporter.reset());

const env = { SERVICE_NAME: 'profile-service' };

describe('loadTelemetryConfig', () => {
  it('is off without an OTLP endpoint, including an empty compose interpolation', () => {
    expect(loadTelemetryConfig(env).enabled).toBe(false);
    expect(loadTelemetryConfig({ ...env, OTEL_EXPORTER_OTLP_ENDPOINT: '' }).enabled).toBe(false);
  });

  it('samples everything in development and 10% in production unless set', () => {
    const on = { ...env, OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-lgtm:4318/' };
    expect(loadTelemetryConfig(on)).toMatchObject({
      enabled: true,
      endpoint: 'http://otel-lgtm:4318',
      sampleRatio: 1,
    });
    expect(loadTelemetryConfig({ ...on, NODE_ENV: 'production' }).sampleRatio).toBe(0.1);
    expect(
      loadTelemetryConfig({ ...on, NODE_ENV: 'production', OTEL_TRACES_SAMPLER_ARG: '0.5' })
        .sampleRatio,
    ).toBe(0.5);
  });

  it('tells the worker deployment from the http one by its entry file', () => {
    expect(loadTelemetryConfig(env, '/app/dist/main.worker.js').role).toBe('worker');
    expect(loadTelemetryConfig(env, '/app/dist/main.http.js').role).toBe('http');
  });

  it('names bad variables without echoing values', () => {
    expect(() =>
      loadTelemetryConfig({ ...env, OTEL_EXPORTER_OTLP_ENDPOINT: 'not a url secret-ish' }),
    ).toThrow(/OTEL_EXPORTER_OTLP_ENDPOINT/);
    expect(() =>
      loadTelemetryConfig({ ...env, OTEL_EXPORTER_OTLP_ENDPOINT: 'not a url secret-ish' }),
    ).not.toThrow(/secret-ish/);
  });
});

describe('trace context helpers', () => {
  it('formats the active span as a W3C traceparent, and gives null outside a span', () => {
    expect(currentTraceparent()).toBeNull();
    testTracer().startActiveSpan('op', (span) => {
      const { traceId, spanId } = span.spanContext();
      expect(currentTraceparent()).toBe(`00-${traceId}-${spanId}-01`);
      span.end();
    });
  });

  it('round-trips a traceparent into a remote parent context', () => {
    const tp = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const ctx = contextFromTraceparent(tp);
    expect(trace.getSpanContext(ctx)).toMatchObject({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      isRemote: true,
    });
    expect(currentTraceparent(ctx)).toBe(tp);
  });

  it('starts a new trace for missing or malformed values', () => {
    expect(contextFromTraceparent(null)).toBe(ROOT_CONTEXT);
    expect(contextFromTraceparent('garbage')).toBe(ROOT_CONTEXT);
    expect(contextFromTraceparent(`00-${'0'.repeat(32)}-00f067aa0ba902b7-01`)).toBe(ROOT_CONTEXT);
  });

  it('adds traceId and spanId to log lines only inside a span', () => {
    expect(traceLogFields()).toEqual({});
    testTracer().startActiveSpan('op', (span) => {
      expect(traceLogFields()).toEqual({
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
      });
      span.end();
    });
  });
});
