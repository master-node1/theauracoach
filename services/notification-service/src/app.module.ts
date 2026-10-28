import { DynamicModule, Module } from '@nestjs/common';
import {
  ADMIN_REPORTS,
  AdminOps,
  AdminOpsController,
  EVENT_DATABASE,
  ServiceKitModule,
  type UserTokenVerifier,
} from '@aura/service-kit';
import { NotificationReports } from './admin-reports';
import type { ServiceConfig } from './config';
import { PreferencesController } from './preferences/preferences.controller';
import { PrismaService } from './prisma.service';

/** The http deployment: public /v1 and /internal/v1 routes. */
@Module({})
export class AppModule {
  static register(config: ServiceConfig, verifier?: UserTokenVerifier): DynamicModule {
    return {
      module: AppModule,
      imports: [ServiceKitModule.forRoot({ config, ...(verifier ? { verifier } : {}) })],
      controllers: [PreferencesController, AdminOpsController],
      providers: [
        PrismaService,
        AdminOps,
        { provide: EVENT_DATABASE, useExisting: PrismaService },
        { provide: ADMIN_REPORTS, useClass: NotificationReports },
      ],
    };
  }
}
