import { DynamicModule, Module } from '@nestjs/common';
import { ServiceKitModule, type UserTokenVerifier } from '@aura/service-kit';
import type { ServiceConfig } from './config';
import { ConsentsController } from './consents/consents.controller';
import { ConsentsService } from './consents/consents.service';
import { MeController } from './identity/me.controller';
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
    overrides: AppModuleOverrides = {},
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [ServiceKitModule.forRoot({ config, ...(verifier ? { verifier } : {}) })],
      controllers: [
        MeController,
        PrivacyController,
        ProfileController,
        ConsentsController,
        UserContextController,
      ],
      providers: [
        PrismaService,
        UserProvisioningService,
        ProfileService,
        ConsentsService,
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
