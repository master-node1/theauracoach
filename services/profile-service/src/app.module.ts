import { DynamicModule, Module } from '@nestjs/common';
import {
  ADMIN_REPORTS,
  AdminOps,
  AdminOpsController,
  EVENT_DATABASE,
  ServiceKitModule,
  type FeatureFlags,
  type UserTokenVerifier,
} from '@aura/service-kit';
import { AdminUsersController } from './admin/admin-users.controller';
import { AdminUsersService } from './admin/admin-users.service';
import { ProfileReports } from './admin/profile-reports';
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
        RolesController,
        AdminUsersController,
        AdminOpsController,
        UserContextController,
      ],
      providers: [
        PrismaService,
        UserProvisioningService,
        ProfileService,
        ConsentsService,
        RolesService,
        AdminUsersService,
        AdminOps,
        { provide: EVENT_DATABASE, useExisting: PrismaService },
        { provide: ADMIN_REPORTS, useClass: ProfileReports },
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
      ],
    };
  }
}
