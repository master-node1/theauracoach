import { SERVICE_NAMES } from '@aura/contracts';
import { z } from 'zod';

/** An unset compose interpolation (`${VAR:-}`) arrives as an empty string; treat it as unset. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

/**
 * Environment for OpenTelemetry. Read before Nest starts, so it is validated separately from
 * `baseEnvSchema`. With no OTLP endpoint, telemetry stays off (unit tests, plain `docker compose up`).
 */
export const telemetryEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVICE_NAME: z.enum(SERVICE_NAMES),
  /** Image tag, set by the Helm chart. */
  SERVICE_VERSION: z.string().min(1).default('0.0.0-local'),
  /** OTLP/HTTP base URL, e.g. http://otel-lgtm:4318. Traces go to /v1/traces, metrics to /v1/metrics. */
  OTEL_EXPORTER_OTLP_ENDPOINT: optional(z.url()),
  /** Share of new traces kept (parent-based, so a sampled caller keeps its whole trace). */
  OTEL_TRACES_SAMPLER_ARG: optional(z.coerce.number().min(0).max(1)),
  OTEL_METRIC_EXPORT_INTERVAL: optional(z.coerce.number().int().min(1000)),
});

export interface TelemetryConfig {
  enabled: boolean;
  serviceName: string;
  serviceVersion: string;
  role: 'http' | 'worker';
  endpoint?: string;
  sampleRatio: number;
  metricIntervalMs: number;
}

/** Fails fast like `loadConfig`, naming variables, never their values. */
export function loadTelemetryConfig(
  env: NodeJS.ProcessEnv = process.env,
  entry = process.argv[1] ?? '',
): TelemetryConfig {
  const result = telemetryEnvSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid telemetry environment:\n  ${problems.join('\n  ')}`);
  }
  const e = result.data;
  return {
    enabled: e.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined,
    serviceName: e.SERVICE_NAME,
    serviceVersion: e.SERVICE_VERSION,
    // Both deployments run the same image; the entry file tells them apart.
    role: /main\.worker\.[cm]?[jt]s$/.test(entry) ? 'worker' : 'http',
    endpoint: e.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/, ''),
    sampleRatio: e.OTEL_TRACES_SAMPLER_ARG ?? (e.NODE_ENV === 'production' ? 0.1 : 1),
    metricIntervalMs: e.OTEL_METRIC_EXPORT_INTERVAL ?? 60_000,
  };
}
