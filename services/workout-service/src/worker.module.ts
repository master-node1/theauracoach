import { DynamicModule, Module } from '@nestjs/common';
import {
  EVENT_DATABASE,
  EVENT_SUBSCRIPTIONS,
  EventWorker,
  ServiceKitModule,
} from '@aura/service-kit';
import type { ServiceConfig } from './config';
import { contentPublishedSubscription } from './content/content-published.subscription';
import { LibraryCache } from './content/library-cache';
import { PrismaService } from './prisma.service';

/** The worker deployment: outbox relay, event consumers and scheduled jobs. */
@Module({})
export class WorkerModule {
  static register(config: ServiceConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [ServiceKitModule.forRoot({ config })],
      providers: [
        PrismaService,
        LibraryCache,
        { provide: EVENT_DATABASE, useExisting: PrismaService },
        {
          provide: EVENT_SUBSCRIPTIONS,
          useFactory: (cache: LibraryCache) => [contentPublishedSubscription(cache)],
          inject: [LibraryCache],
        },
        EventWorker,
      ],
    };
  }
}
