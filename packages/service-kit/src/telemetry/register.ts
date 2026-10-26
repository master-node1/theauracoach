/**
 * Side-effect entry: `import '@aura/service-kit/telemetry/register';` as the first line of
 * main.http.ts and main.worker.ts, before anything that loads http, express, ioredis or Prisma.
 * It must not import the package index, which loads Nest and express.
 */
import { loadTelemetryConfig } from './config';
import { startTelemetry } from './sdk';

startTelemetry(loadTelemetryConfig());
