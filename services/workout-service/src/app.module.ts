import { DynamicModule, Module } from '@nestjs/common';
import { ServiceKitModule, type UserTokenVerifier } from '@aura/service-kit';
import type { ServiceConfig } from './config';
import {
  AdminExercisesController,
  AdminTemplatesController,
} from './content/admin-content.controller';
import { AdminContentService } from './content/admin-content.service';
import { ContentStore } from './content/content-store';
import { ExercisesController } from './content/exercises.controller';
import { LibraryCache } from './content/library-cache';
import { LibraryService } from './content/library.service';
import { PrismaService } from './prisma.service';

/** The http deployment: public /v1 and /internal/v1 routes. */
@Module({})
export class AppModule {
  static register(config: ServiceConfig, verifier?: UserTokenVerifier): DynamicModule {
    return {
      module: AppModule,
      imports: [ServiceKitModule.forRoot({ config, ...(verifier ? { verifier } : {}) })],
      controllers: [ExercisesController, AdminExercisesController, AdminTemplatesController],
      providers: [
        PrismaService,
        {
          provide: ContentStore,
          useFactory: (p: PrismaService) => new ContentStore(p),
          inject: [PrismaService],
        },
        LibraryCache,
        LibraryService,
        AdminContentService,
      ],
    };
  }
}
