import { DynamicModule, Module } from '@nestjs/common';
import {
  EVENT_DATABASE,
  EVENT_SUBSCRIPTIONS,
  EventWorker,
  ServiceKitModule,
  createObjectStorage,
  participantSubscriptions,
} from '@aura/service-kit';
import type { ServiceConfig } from './config';
import { contentPublishedSubscription } from './content/content-published.subscription';
import { LibraryCache } from './content/library-cache';
import { PrismaService } from './prisma.service';
import { userDataPlan } from './user-data-plan';

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
          useFactory: (cache: LibraryCache) => [
            contentPublishedSubscription(cache),
            ...participantSubscriptions({
              service: 'workout-service',
              plan: userDataPlan,
              storage: createObjectStorage(config),
            }),
          ],
          inject: [LibraryCache],
        },
        EventWorker,
      ],
    };
  }
}
