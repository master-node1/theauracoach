import { DynamicModule, Module } from '@nestjs/common';
import { CONSENT_STATE, ServiceKitModule, type UserTokenVerifier } from '@aura/service-kit';
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
      ],
    };
  }
}
