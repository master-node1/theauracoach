import { DynamicModule, Module } from '@nestjs/common';
import {
  EVENT_DATABASE,
  EVENT_SUBSCRIPTIONS,
  EventWorker,
  ServiceKitModule,
} from '@aura/service-kit';
import type { ServiceConfig } from './config';
import { UserProvisioningService } from './identity/user-provisioning.service';
import { DeletionService } from './privacy/deletion.service';
import { ExportsService } from './privacy/exports.service';
import { IDENTITY_ADMIN, createIdentityAdmin, type IdentityAdmin } from './privacy/identity-admin';
import { PrivacyJobs } from './privacy/privacy-jobs';
import { privacySubscriptions } from './privacy/privacy.subscriptions';
import { objectStorageProvider } from './privacy/storage';
import { PrismaService } from './prisma.service';

export interface WorkerModuleOverrides {
  /** Replace the identity provider admin client (tests). */
  identityAdmin?: IdentityAdmin;
}

/** The worker deployment: outbox relay, event consumers and scheduled jobs. */
@Module({})
export class WorkerModule {
  static register(config: ServiceConfig, overrides: WorkerModuleOverrides = {}): DynamicModule {
    return {
      module: WorkerModule,
      imports: [ServiceKitModule.forRoot({ config })],
      providers: [
        PrismaService,
        UserProvisioningService,
        ExportsService,
        DeletionService,
        PrivacyJobs,
        objectStorageProvider,
        {
          provide: IDENTITY_ADMIN,
          useValue: overrides.identityAdmin ?? createIdentityAdmin(config),
        },
        { provide: EVENT_DATABASE, useExisting: PrismaService },
        {
          provide: EVENT_SUBSCRIPTIONS,
          useFactory: privacySubscriptions,
          inject: [ExportsService, DeletionService],
        },
        EventWorker,
      ],
    };
  }
}
