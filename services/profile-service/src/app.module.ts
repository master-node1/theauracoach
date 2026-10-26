import { DynamicModule, Module } from '@nestjs/common';
import { ServiceKitModule, type UserTokenVerifier } from '@aura/service-kit';
import type { ServiceConfig } from './config';
import { ConsentsController } from './consents/consents.controller';
import { ConsentsService } from './consents/consents.service';
import { MeController } from './identity/me.controller';
import { UserProvisioningService } from './identity/user-provisioning.service';
import { UserContextController } from './internal/user-context.controller';
import { PrismaService } from './prisma.service';
import { ProfileController } from './profile/profile.controller';
import { ProfileService } from './profile/profile.service';

/** The http deployment: public /v1 and /internal/v1 routes. */
@Module({})
export class AppModule {
  static register(config: ServiceConfig, verifier?: UserTokenVerifier): DynamicModule {
    return {
      module: AppModule,
      imports: [ServiceKitModule.forRoot({ config, ...(verifier ? { verifier } : {}) })],
      controllers: [MeController, ProfileController, ConsentsController, UserContextController],
      providers: [PrismaService, UserProvisioningService, ProfileService, ConsentsService],
    };
  }
}
