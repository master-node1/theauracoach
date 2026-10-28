import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import {
  adminContentListQuerySchema,
  adminFoodInputSchema,
  adminFoodPatchSchema,
  adminRecipeInputSchema,
  adminRecipePatchSchema,
  adminRejectSchema,
  type AdminContentListQuery,
  type AdminFood,
  type AdminFoodInput,
  type AdminFoodPatch,
  type AdminPage,
  type AdminRecipe,
  type AdminRecipeInput,
  type AdminRecipePatch,
  type AdminReject,
} from '@aura/contracts';
import {
  AnyPermission,
  CurrentUser,
  Permissions,
  ZodValidationPipe,
  type AuthenticatedUser,
} from '@aura/service-kit';
import { AdminFoodsService } from './admin-foods.service';
import { AdminRecipesService } from './admin-recipes.service';
import { requestIdOf, type HttpReq } from './content-workflow';

/**
 * `/v1/admin/foods` (admin LLD §2): editors draft and submit (food:write), reviewers reject
 * (food:review), and publish or archive (food:publish). Everyone with a food permission can read.
 */
@Controller('v1/admin/foods')
export class AdminFoodsController {
  constructor(private readonly foods: AdminFoodsService) {}

  @Get()
  @AnyPermission('food:write', 'food:review', 'food:publish')
  list(
    @Query(new ZodValidationPipe(adminContentListQuerySchema)) query: AdminContentListQuery,
  ): Promise<AdminPage<AdminFood>> {
    return this.foods.list(query);
  }

  @Get(':id')
  @AnyPermission('food:write', 'food:review', 'food:publish')
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<AdminFood> {
    return this.foods.get(id);
  }

  @Post()
  @Permissions('food:write')
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(adminFoodInputSchema)) body: AdminFoodInput,
    @Req() req: HttpReq,
  ): Promise<AdminFood> {
    return this.foods.create(actor, body, requestIdOf(req));
  }

  @Patch(':id')
  @Permissions('food:write')
  patch(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(adminFoodPatchSchema)) body: AdminFoodPatch,
    @Req() req: HttpReq,
  ): Promise<AdminFood> {
    return this.foods.patch(actor, id, body, requestIdOf(req));
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @Permissions('food:write')
  submit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: HttpReq,
  ): Promise<AdminFood> {
    return this.foods.transition(actor, id, 'submit', requestIdOf(req));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Permissions('food:review')
  reject(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(adminRejectSchema)) body: AdminReject,
    @Req() req: HttpReq,
  ): Promise<AdminFood> {
    return this.foods.transition(actor, id, 'reject', requestIdOf(req), body.note);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @Permissions('food:publish')
  publish(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: HttpReq,
  ): Promise<AdminFood> {
    return this.foods.transition(actor, id, 'publish', requestIdOf(req));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Permissions('food:publish')
  archive(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: HttpReq,
  ): Promise<AdminFood> {
    return this.foods.transition(actor, id, 'archive', requestIdOf(req));
  }
}

/** `/v1/admin/recipes`, the same workflow with recipe:* permissions. */
@Controller('v1/admin/recipes')
export class AdminRecipesController {
  constructor(private readonly recipes: AdminRecipesService) {}

  @Get()
  @AnyPermission('recipe:write', 'recipe:review', 'recipe:publish')
  list(
    @Query(new ZodValidationPipe(adminContentListQuerySchema)) query: AdminContentListQuery,
  ): Promise<AdminPage<AdminRecipe>> {
    return this.recipes.list(query);
  }

  @Get(':id')
  @AnyPermission('recipe:write', 'recipe:review', 'recipe:publish')
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<AdminRecipe> {
    return this.recipes.get(id);
  }

  @Post()
  @Permissions('recipe:write')
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(adminRecipeInputSchema)) body: AdminRecipeInput,
    @Req() req: HttpReq,
  ): Promise<AdminRecipe> {
    return this.recipes.create(actor, body, requestIdOf(req));
  }

  @Patch(':id')
  @Permissions('recipe:write')
  patch(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(adminRecipePatchSchema)) body: AdminRecipePatch,
    @Req() req: HttpReq,
  ): Promise<AdminRecipe> {
    return this.recipes.patch(actor, id, body, requestIdOf(req));
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @Permissions('recipe:write')
  submit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: HttpReq,
  ): Promise<AdminRecipe> {
    return this.recipes.transition(actor, id, 'submit', requestIdOf(req));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Permissions('recipe:review')
  reject(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(adminRejectSchema)) body: AdminReject,
    @Req() req: HttpReq,
  ): Promise<AdminRecipe> {
    return this.recipes.transition(actor, id, 'reject', requestIdOf(req), body.note);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @Permissions('recipe:publish')
  publish(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: HttpReq,
  ): Promise<AdminRecipe> {
    return this.recipes.transition(actor, id, 'publish', requestIdOf(req));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Permissions('recipe:publish')
  archive(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: HttpReq,
  ): Promise<AdminRecipe> {
    return this.recipes.transition(actor, id, 'archive', requestIdOf(req));
  }
}
