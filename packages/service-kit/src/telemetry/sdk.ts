import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation, ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import type { TelemetryConfig } from './config';

let sdk: NodeSDK | undefined;

/**
 * Starts tracing and metrics. Must run before express, ioredis or Prisma are loaded, which is why
 * services import `@aura/service-kit/telemetry/register` as the first line of their entry files.
 * Does nothing when telemetry is disabled.
 */
export function startTelemetry(config: TelemetryConfig): boolean {
  if (!config.enabled || sdk) return Boolean(sdk);
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': config.serviceName,
      'service.version': config.serviceVersion,
      'service.namespace': 'auracoach',
      'aura.process.role': config.role,
    }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.sampleRatio) }),
    traceExporter: new OTLPTraceExporter({ url: `${config.endpoint}/v1/traces` }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${config.endpoint}/v1/metrics` }),
        exportIntervalMillis: config.metricIntervalMs,
      }),
    ],
    // Logs stay on stdout as JSON (with traceId/spanId); no OTLP log pipeline yet.
    logRecordProcessors: [],
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => (req.url ?? '').startsWith('/health'),
      }),
      // Nest's own spans name the controller; per-middleware spans are noise.
      new ExpressInstrumentation({
        ignoreLayersType: [ExpressLayerType.MIDDLEWARE, ExpressLayerType.ROUTER],
      }),
      new NestInstrumentation(),
      new UndiciInstrumentation(),
      // Only inside a traced operation: the stream consumer's blocking reads would otherwise
      // start a new trace every two seconds.
      new IORedisInstrumentation({ requireParentSpan: true }),
      new PrismaInstrumentation({
        // Keep operations, transactions and SQL; drop engine internals and start-up spans.
        ignoreSpanTypes: [
          /^prisma:client:(serialize|connect|load_engine|detect_platform)$/,
          /^prisma:engine:(serialize|response_json_serialization|connection)$/,
        ],
      }),
    ],
  });
  sdk.start();
  return true;
}

/** Flushes and stops the SDK. Called from ServiceKitModule on application shutdown. */
export async function shutdownTelemetry(): Promise<void> {
  const current = sdk;
  sdk = undefined;
  await current?.shutdown().catch(() => undefined);
}
