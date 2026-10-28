import { DynamicModule, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  ACCOUNT_STATE_DB,
  AccountStateInterceptor,
  ServiceKitModule,
  type UserTokenVerifier,
} from '@aura/service-kit';
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
      controllers: [PreferencesController],
      providers: [
        PrismaService,
        // Pending-deletion users get 423 on user routes (replica kept by the worker).
        { provide: ACCOUNT_STATE_DB, useExisting: PrismaService },
        { provide: APP_INTERCEPTOR, useClass: AccountStateInterceptor },
      ],
    };
  }
}
