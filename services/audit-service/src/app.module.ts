import { DynamicModule, Module } from '@nestjs/common';
import {
  AdminOps,
  AdminOpsController,
  EVENT_DATABASE,
  ServiceKitModule,
  type UserTokenVerifier,
} from '@aura/service-kit';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import type { ServiceConfig } from './config';
import { PrismaService } from './prisma.service';

/** The http deployment: public /v1 and /internal/v1 routes. */
@Module({})
export class AppModule {
  static register(config: ServiceConfig, verifier?: UserTokenVerifier): DynamicModule {
    return {
      module: AppModule,
      imports: [ServiceKitModule.forRoot({ config, ...(verifier ? { verifier } : {}) })],
      controllers: [AuditController, AdminOpsController],
      providers: [
        PrismaService,
        AuditService,
        AdminOps,
        { provide: EVENT_DATABASE, useExisting: PrismaService },
      ],
    };
  }
}
