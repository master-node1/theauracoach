import { DynamicModule, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  ACCOUNT_STATE_DB,
  AccountStateInterceptor,
  CONSENT_STATE,
  ServiceKitModule,
  type UserTokenVerifier,
} from '@aura/service-kit';
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
      controllers: [],
      providers: [
        PrismaService,
        ConsentStateService,
        { provide: CONSENT_STATE, useExisting: ConsentStateService },
        // Pending-deletion users get 423 on user routes (replica kept by the worker).
        { provide: ACCOUNT_STATE_DB, useExisting: PrismaService },
        { provide: APP_INTERCEPTOR, useClass: AccountStateInterceptor },
      ],
    };
  }
}
