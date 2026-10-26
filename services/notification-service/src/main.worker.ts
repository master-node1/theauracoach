// Telemetry first: it must load before http, express, ioredis and Prisma.
import '@aura/service-kit/telemetry/register';
import 'reflect-metadata';
import { bootstrapWorker } from '@aura/service-kit';
import { loadServiceConfig } from './config';
import { WorkerModule } from './worker.module';

void bootstrapWorker(WorkerModule.register(loadServiceConfig()));
