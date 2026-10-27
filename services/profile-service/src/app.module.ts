import { DynamicModule, Module } from '@nestjs/common';
import { ServiceKitModule, type FeatureFlags, type UserTokenVerifier } from '@aura/service-kit';
import { DEV_IDENTITY_ENDPOINT, type ServiceConfig } from './config';
import { ConsentsController } from './consents/consents.controller';
import { ConsentsService } from './consents/consents.service';
import { FlagsController } from './flags/flags.controller';
import {
  CognitoIdentityProvider,
  IDENTITY_PROVIDER,
  type IdentityProvider,
} from './identity/identity-provider';
import { MeController } from './identity/me.controller';
import { SessionsController } from './identity/sessions.controller';
import { UserProvisioningService } from './identity/user-provisioning.service';
import { UserContextController } from './internal/user-context.controller';
import { PrismaService } from './prisma.service';
import { ProfileController } from './profile/profile.controller';
import { ProfileService } from './profile/profile.service';

/** The http deployment: public /v1 and /internal/v1 routes. */
@Module({})
export class AppModule {
  static register(
    config: ServiceConfig,
    verifier?: UserTokenVerifier,
    flags?: FeatureFlags,
    identity?: IdentityProvider,
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ServiceKitModule.forRoot({
          config,
          ...(verifier ? { verifier } : {}),
          ...(flags ? { flags } : {}),
        }),
      ],
      controllers: [
        MeController,
        SessionsController,
        ProfileController,
        ConsentsController,
        FlagsController,
        UserContextController,
      ],
      providers: [
        PrismaService,
        UserProvisioningService,
        ProfileService,
        ConsentsService,
        {
          provide: IDENTITY_PROVIDER,
          useValue:
            identity ??
            new CognitoIdentityProvider(config.IDENTITY_ENDPOINT ?? DEV_IDENTITY_ENDPOINT),
        },
      ],
    };
  }
}
