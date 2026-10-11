import { DynamicModule, Module } from '@nestjs/common';
import { ServiceKitModule, type UserTokenVerifier } from '@aura/service-kit';
import type { ServiceConfig } from './config';
import { MeController } from './identity/me.controller';
import { UserProvisioningService } from './identity/user-provisioning.service';
import { PrismaService } from './prisma.service';

/** The http deployment: public /v1 and /internal/v1 routes. */
@Module({})
export class AppModule {
  static register(config: ServiceConfig, verifier?: UserTokenVerifier): DynamicModule {
    return {
      module: AppModule,
      imports: [ServiceKitModule.forRoot({ config, ...(verifier ? { verifier } : {}) })],
      controllers: [MeController],
      providers: [PrismaService, UserProvisioningService],
    };
  }
}
