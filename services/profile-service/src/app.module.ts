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
import {
  CognitoIdentityGroups,
  IDENTITY_GROUPS,
  type IdentityGroups,
} from './identity/identity-groups';
import { MeController } from './identity/me.controller';
import { SessionsController } from './identity/sessions.controller';
import { UserProvisioningService } from './identity/user-provisioning.service';
import { UserContextController } from './internal/user-context.controller';
import { DeletionService } from './privacy/deletion.service';
import { ExportsService } from './privacy/exports.service';
import { IDENTITY_ADMIN, createIdentityAdmin, type IdentityAdmin } from './privacy/identity-admin';
import { PrivacyController } from './privacy/privacy.controller';
import { objectStorageProvider } from './privacy/storage';
import { PrismaService } from './prisma.service';
import { ProfileController } from './profile/profile.controller';
import { ProfileService } from './profile/profile.service';
import { RolesController } from './roles/roles.controller';
import { RolesService } from './roles/roles.service';

export interface AppModuleOverrides {
  /** Replace the identity provider admin client (tests). */
  identityAdmin?: IdentityAdmin;
}

/** The http deployment: public /v1 and /internal/v1 routes. */
@Module({})
export class AppModule {
  static register(
    config: ServiceConfig,
    verifier?: UserTokenVerifier,
    flags?: FeatureFlags,
    identityGroups?: IdentityGroups,
    identity?: IdentityProvider,
    overrides: AppModuleOverrides = {},
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
        PrivacyController,
        SessionsController,
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
        {
          provide: IDENTITY_PROVIDER,
          useValue:
            identity ??
            new CognitoIdentityProvider(config.IDENTITY_ENDPOINT ?? DEV_IDENTITY_ENDPOINT),
        },
        ExportsService,
        DeletionService,
        objectStorageProvider,
        {
          provide: IDENTITY_ADMIN,
          useValue: overrides.identityAdmin ?? createIdentityAdmin(config),
        },
      ],
    };
  }
}
