import {
  context,
  isSpanContextValid,
  ROOT_CONTEXT,
  trace,
  TraceFlags,
  type Context,
} from '@opentelemetry/api';

/** The tracer for spans service-kit creates itself (outbox relay, stream consumer). */
export const tracer = trace.getTracer('@aura/service-kit');

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** W3C `traceparent` of the active span, or null outside a valid span (telemetry off, untraced work). */
export function currentTraceparent(ctx: Context = context.active()): string | null {
  const sc = trace.getSpanContext(ctx);
  if (!sc || !isSpanContextValid(sc)) return null;
  const flags = (sc.traceFlags & TraceFlags.SAMPLED).toString(16).padStart(2, '0');
  return `00-${sc.traceId}-${sc.spanId}-${flags}`;
}

/**
 * A context whose remote parent is the given `traceparent`, built on ROOT_CONTEXT so it is never
 * affected by suppression in the caller. Invalid or missing values give ROOT_CONTEXT (a new trace).
 */
export function contextFromTraceparent(traceparent: string | null | undefined): Context {
  const m = traceparent ? TRACEPARENT.exec(traceparent) : null;
  if (!m) return ROOT_CONTEXT;
  const spanContext = {
    traceId: m[1]!,
    spanId: m[2]!,
    traceFlags: parseInt(m[3]!, 16) & TraceFlags.SAMPLED,
    isRemote: true,
  };
  return isSpanContextValid(spanContext)
    ? trace.setSpanContext(ROOT_CONTEXT, spanContext)
    : ROOT_CONTEXT;
}

/** `traceId` and `spanId` for log lines (pino mixin). Empty outside a span. */
export function traceLogFields(): { traceId?: string; spanId?: string } {
  const sc = trace.getSpanContext(context.active());
  return sc && isSpanContextValid(sc) ? { traceId: sc.traceId, spanId: sc.spanId } : {};
}
