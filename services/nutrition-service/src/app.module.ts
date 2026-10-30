import { DynamicModule, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  ACCOUNT_STATE_DB,
  AccountStateInterceptor,
  ADMIN_REPORTS,
  AdminOps,
  AdminOpsController,
  EVENT_DATABASE,
  ServiceKitModule,
  type UserTokenVerifier,
} from '@aura/service-kit';
import { NutritionReports } from './admin-reports';
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
        AdminOpsController,
        FoodsController,
        InternalFoodsController,
        AdminFoodsController,
        AdminRecipesController,
      ],
      providers: [
        PrismaService,
        AdminOps,
        FoodSearchService,
        AdminFoodsService,
        AdminRecipesService,
        { provide: EVENT_DATABASE, useExisting: PrismaService },
        { provide: ADMIN_REPORTS, useClass: NutritionReports },
        // Pending-deletion users get 423 on user routes (replica kept by the worker).
        { provide: ACCOUNT_STATE_DB, useExisting: PrismaService },
        { provide: APP_INTERCEPTOR, useClass: AccountStateInterceptor },
      ],
    };
  }
}
