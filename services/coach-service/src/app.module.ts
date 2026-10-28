import { DynamicModule, Module } from '@nestjs/common';
import {
  ADMIN_REPORTS,
  AdminOps,
  AdminOpsController,
  CONSENT_STATE,
  EVENT_DATABASE,
  ServiceKitModule,
  type UserTokenVerifier,
} from '@aura/service-kit';
import { CoachReports } from './admin-reports';
import type { ServiceConfig } from './config';
import { ConsentStateService } from './consents/consent-state';
import { PrismaService } from './prisma.service';

/** The http deployment: public /v1 and /internal/v1 routes. */
@Module({})
export class AppModule {
  static register(config: ServiceConfig, verifier?: UserTokenVerifier): DynamicModule {
    return {
      module: AppModule,
      imports: [ServiceKitModule.forRoot({ config, ...(verifier ? { verifier } : {}) })],
      controllers: [AdminOpsController],
      providers: [
        PrismaService,
        AdminOps,
        { provide: EVENT_DATABASE, useExisting: PrismaService },
        { provide: ADMIN_REPORTS, useClass: CoachReports },
        ConsentStateService,
        { provide: CONSENT_STATE, useExisting: ConsentStateService },
      ],
    };
  }
}
