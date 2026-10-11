import { DynamicModule, INestApplication, INestApplicationContext, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

/** Applies the HTTP settings every service shares. Used by main.http.ts and by API tests. */
export function configureHttpApp(app: INestApplication): INestApplication {
  app.use(helmet());
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.enableShutdownHooks();
  return app;
}

export async function bootstrapHttp(
  module: Type<unknown> | DynamicModule,
  port: number,
): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(module, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useBodyParser('json', { limit: '256kb' });
  configureHttpApp(app);
  await app.listen(port, '0.0.0.0');
  return app;
}

/** The worker deployment: no HTTP server, runs relays, consumers and jobs until SIGTERM. */
export async function bootstrapWorker(
  module: Type<unknown> | DynamicModule,
): Promise<INestApplicationContext> {
  const ctx = await NestFactory.createApplicationContext(module, { bufferLogs: true });
  ctx.useLogger(ctx.get(Logger));
  ctx.enableShutdownHooks();
  return ctx;
}
