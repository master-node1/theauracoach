import { DynamicModule, Module } from '@nestjs/common';
import {
  EVENT_DATABASE,
  EVENT_SUBSCRIPTIONS,
  EventWorker,
  ServiceKitModule,
} from '@aura/service-kit';
import type { ServiceConfig } from './config';
import { PrismaService } from './prisma.service';
import { DataQaJob } from './qa/data-qa.job';

/** The worker deployment: outbox relay, event consumers and scheduled jobs. */
@Module({})
export class WorkerModule {
  static register(config: ServiceConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [ServiceKitModule.forRoot({ config })],
      providers: [
        PrismaService,
        { provide: EVENT_DATABASE, useExisting: PrismaService },
        { provide: EVENT_SUBSCRIPTIONS, useValue: [] },
        EventWorker,
        DataQaJob,
      ],
    };
  }
}
