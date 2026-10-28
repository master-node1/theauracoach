import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  type Type,
} from '@nestjs/common';
import {
  contentRevisionQuerySchema,
  exerciseContentSchema,
  ROLE_PERMISSIONS,
  templateContentSchema,
  type ContentRevisionQuery,
  type GrantableRole,
  type Permission,
  type WorkoutContentKind,
} from '@aura/contracts';
import {
  AnyPermission,
  CurrentUser,
  Permissions,
  ZodValidationPipe,
  type AuthenticatedUser,
} from '@aura/service-kit';
import { AdminContentService } from './admin-content.service';
import type { ContentActor, ContentBody } from './content-store';

/** The parts of the Express request and response these handlers touch. */
type HttpReq = { id?: unknown };
type HttpRes = { status(code: number): unknown };

/** The audit log names the role that allowed the action, e.g. content_reviewer. */
function actorOf(user: AuthenticatedUser, permission: Permission, req: HttpReq): ContentActor {
  const role =
    user.groups.find((g) =>
      (ROLE_PERMISSIONS[g as GrantableRole] as readonly string[] | undefined)?.includes(permission),
    ) ?? 'staff';
  return { id: user.userId, role, requestId: req.id === undefined ? undefined : String(req.id) };
}

/**
 * Admin content routes (admin LLD §6) for one kind: list and read versions, create a draft, edit
 * (a published version opens the next one: 201), submit, publish, archive. Editors write and
 * submit; reviewers publish and archive; both read.
 */
function contentController<K extends WorkoutContentKind>(
  kind: K,
  path: string,
  perms: { write: Permission; review: Permission; publish: Permission },
): Type<unknown> {
  const schema = (kind === 'exercise' ? exerciseContentSchema : templateContentSchema) as never;

  @Controller(path)
  class AdminContentController {
    constructor(readonly content: AdminContentService) {}

    @Get()
    @AnyPermission(perms.write, perms.review, perms.publish)
    list(@Query(new ZodValidationPipe(contentRevisionQuerySchema)) query: ContentRevisionQuery) {
      return this.content.store.list(kind, query);
    }

    @Get(':id')
    @AnyPermission(perms.write, perms.review, perms.publish)
    get(@Param('id') id: string) {
      return this.content.store.get(kind, id);
    }

    @Post()
    @Permissions(perms.write)
    create(
      @CurrentUser() user: AuthenticatedUser,
      @Body(new ZodValidationPipe(schema)) body: ContentBody<K>,
      @Req() req: HttpReq,
    ) {
      return this.content.store.create(kind, body, actorOf(user, perms.write, req));
    }

    @Put(':id')
    @Permissions(perms.write)
    async update(
      @CurrentUser() user: AuthenticatedUser,
      @Param('id') id: string,
      @Body(new ZodValidationPipe(schema)) body: ContentBody<K>,
      @Req() req: HttpReq,
      @Res({ passthrough: true }) res: HttpRes,
    ) {
      const { revision, created } = await this.content.store.update(
        kind,
        id,
        body,
        actorOf(user, perms.write, req),
      );
      res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
      return revision;
    }

    @Post(':id/submit')
    @HttpCode(HttpStatus.OK)
    @Permissions(perms.write)
    submit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: HttpReq) {
      return this.content.store.submit(kind, id, actorOf(user, perms.write, req));
    }

    @Post(':id/publish')
    @HttpCode(HttpStatus.OK)
    @Permissions(perms.publish)
    publish(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: HttpReq) {
      return this.content.publish(kind, id, actorOf(user, perms.publish, req));
    }

    @Post(':id/archive')
    @HttpCode(HttpStatus.OK)
    @Permissions(perms.publish)
    archive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: HttpReq) {
      return this.content.archive(kind, id, actorOf(user, perms.publish, req));
    }
  }
  Object.defineProperty(AdminContentController, 'name', {
    value: kind === 'exercise' ? 'AdminExercisesController' : 'AdminTemplatesController',
  });
  return AdminContentController;
}

export const AdminExercisesController = contentController('exercise', 'v1/admin/exercises', {
  write: 'exercise:write',
  review: 'exercise:review',
  publish: 'exercise:publish',
});

export const AdminTemplatesController = contentController('template', 'v1/admin/templates', {
  write: 'template:write',
  review: 'template:review',
  publish: 'template:publish',
});
