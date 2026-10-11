import 'reflect-metadata';
import { bootstrapWorker } from '@aura/service-kit';
import { loadServiceConfig } from './config';
import { WorkerModule } from './worker.module';

void bootstrapWorker(WorkerModule.register(loadServiceConfig()));
