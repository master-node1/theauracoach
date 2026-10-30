import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  foodSearchQuerySchema,
  internalFoodSearchSchema,
  type FoodDetail,
  type FoodSearchQuery,
  type FoodSearchResponse,
  type InternalFoodSearch,
} from '@aura/contracts';
import {
  CurrentUser,
  InternalOnly,
  ProblemException,
  ZodValidationPipe,
  type AuthenticatedUser,
} from '@aura/service-kit';
import { PrismaService } from '../prisma.service';
import { FoodSearchService } from './food-search.service';
import { foodDetailInclude, toFoodDetail } from './food-view';

/** The catalogue as users see it: published foods plus their own (nutrition LLD §5). */
@Controller('v1/foods')
export class FoodsController {
  constructor(
    private readonly search: FoodSearchService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async find(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(foodSearchQuerySchema)) query: FoodSearchQuery,
  ): Promise<FoodSearchResponse> {
    const ctx = await this.search.contextFor(user.userId);
    return this.search.search(
      { q: query.q, limit: query.limit, offset: Number(query.cursor ?? 0), showAll: query.showAll },
      ctx,
    );
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<FoodDetail> {
    const row = await this.prisma.foodItem.findUnique({
      where: { id },
      include: foodDetailInclude,
    });
    const visible =
      row &&
      (row.source === 'USER'
        ? row.createdById === user.userId && row.status !== 'ARCHIVED'
        : row.status === 'PUBLISHED');
    if (!visible)
      throw new ProblemException(HttpStatus.NOT_FOUND, 'FOOD_NOT_FOUND', 'No such food');
    return toFoodDetail(row);
  }
}

/** Food lookup for the coach's tools: the caller states the user's diet and allergens. */
@Controller('internal/v1/foods')
export class InternalFoodsController {
  constructor(private readonly search: FoodSearchService) {}

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @InternalOnly('coach-service')
  find(
    @Body(new ZodValidationPipe(internalFoodSearchSchema)) body: InternalFoodSearch,
  ): Promise<FoodSearchResponse> {
    return this.search.search(
      { q: body.q, limit: body.limit, offset: 0, showAll: false },
      {
        dietType: body.dietType ?? null,
        allergens: body.allergens,
        cuisines: [],
        recentFoodIds: new Set(),
        userId: null,
      },
    );
  }
}
