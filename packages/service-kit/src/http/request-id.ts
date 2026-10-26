import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { trace } from '@opentelemetry/api';

const SAFE_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Reuses the gateway's X-Request-Id when it looks safe, otherwise makes one, and echoes it back.
 * The id is also put on the request's server span, so a support ticket's request id finds its trace.
 */
export function requestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  trace.getActiveSpan()?.setAttribute('aura.request_id', id);
  return id;
}
