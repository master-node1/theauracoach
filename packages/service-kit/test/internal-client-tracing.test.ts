import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SpanKind } from '@opentelemetry/api';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InternalClient } from '../src';
import { testTracer, useInMemoryTracing } from './tracing';

// The same fetch instrumentation the NodeSDK enables in services (telemetry/sdk.ts).
const exporter = useInMemoryTracing();
const instrumentation = new UndiciInstrumentation();
instrumentation.enable();

let server: Server;
let base: string;
let received: IncomingHttpHeaders | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    received = req.headers;
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  instrumentation.disable();
  await new Promise<void>((r) => server.close(() => r()));
});

describe('InternalClient tracing', () => {
  it('sends traceparent so the callee continues the caller trace', async () => {
    const client = new InternalClient({
      self: 'coach-service',
      secret: 'k'.repeat(40),
      urls: { 'workout-service': base },
    });
    const traceId = await testTracer().startActiveSpan('GET /v1/coach/today', async (span) => {
      await client.call('workout-service', { path: '/internal/v1/ok' });
      span.end();
      return span.spanContext().traceId;
    });
    const clientSpan = exporter.getFinishedSpans().find((s) => s.kind === SpanKind.CLIENT);
    expect(clientSpan?.spanContext().traceId).toBe(traceId);
    expect(received?.traceparent).toBe(`00-${traceId}-${clientSpan?.spanContext().spanId}-01`);
  });
});
