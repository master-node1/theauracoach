import { DynamicModule, Module } from '@nestjs/common';
import { ServiceKitModule, type UserTokenVerifier } from '@aura/service-kit';
import type { ServiceConfig } from './config';
import { AdminFoodsController, AdminRecipesController } from './admin/admin.controller';
import { AdminFoodsService } from './admin/admin-foods.service';
import { AdminRecipesService } from './admin/admin-recipes.service';
import { PrismaService } from './prisma.service';
import { FoodSearchService } from './search/food-search.service';
import { FoodsController, InternalFoodsController } from './search/foods.controller';

/** The http deployment: public /v1 and /internal/v1 routes. */
@Module({})
export class AppModule {
  static register(config: ServiceConfig, verifier?: UserTokenVerifier): DynamicModule {
    return {
      module: AppModule,
      imports: [ServiceKitModule.forRoot({ config, ...(verifier ? { verifier } : {}) })],
      controllers: [
        FoodsController,
        InternalFoodsController,
        AdminFoodsController,
        AdminRecipesController,
      ],
      providers: [PrismaService, FoodSearchService, AdminFoodsService, AdminRecipesService],
    };
  }
}
