import { DynamicModule, Module } from '@nestjs/common';
import { ServiceKitModule, type FeatureFlags, type UserTokenVerifier } from '@aura/service-kit';
import type { ServiceConfig } from './config';
import { ConsentsController } from './consents/consents.controller';
import { ConsentsService } from './consents/consents.service';
import { FlagsController } from './flags/flags.controller';
import {
  CognitoIdentityGroups,
  IDENTITY_GROUPS,
  type IdentityGroups,
} from './identity/identity-groups';
import { MeController } from './identity/me.controller';
import { UserProvisioningService } from './identity/user-provisioning.service';
import { UserContextController } from './internal/user-context.controller';
import { PrismaService } from './prisma.service';
import { ProfileController } from './profile/profile.controller';
import { ProfileService } from './profile/profile.service';
import { RolesController } from './roles/roles.controller';
import { RolesService } from './roles/roles.service';

/** The http deployment: public /v1 and /internal/v1 routes. */
@Module({})
export class AppModule {
  static register(
    config: ServiceConfig,
    verifier?: UserTokenVerifier,
    flags?: FeatureFlags,
    identityGroups?: IdentityGroups,
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
        ProfileController,
        ConsentsController,
        FlagsController,
        RolesController,
        UserContextController,
      ],
      providers: [
        PrismaService,
        UserProvisioningService,
        ProfileService,
        ConsentsService,
        RolesService,
        {
          provide: IDENTITY_GROUPS,
          useValue: identityGroups ?? new CognitoIdentityGroups(config),
        },
      ],
    };
  }
}
