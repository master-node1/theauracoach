import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  GRANTABLE_ROLES,
  roleGrantSchema,
  type GrantableRole,
  type RoleGrant,
  type RoleGrantInput,
  type RoleListResponse,
} from '@aura/contracts';
import {
  CurrentUser,
  Permissions,
  ProblemException,
  ZodValidationPipe,
  type AuthenticatedUser,
} from '@aura/service-kit';
import { RolesService } from './roles.service';

/** The parts of the Express request and response these handlers touch. */
type HttpReq = { id?: unknown };
type HttpRes = { status(code: number): unknown };

const requestIdOf = (req: HttpReq) => (req.id === undefined ? undefined : String(req.id));

@Controller('v1/admin/roles')
@Permissions('role:grant')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  list(): Promise<RoleListResponse> {
    return this.roles.list();
  }

  /** 201 when granted now, 200 when the user already had the role (no second audit entry). */
  @Post()
  async grant(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(roleGrantSchema)) body: RoleGrantInput,
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
  ): Promise<RoleGrant> {
    const { grant, created } = await this.roles.grant(actor, body, requestIdOf(req));
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return grant;
  }

  @Delete(':userId/:role')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Param('role') role: string,
    @Req() req: HttpReq,
  ): Promise<void> {
    if (!(GRANTABLE_ROLES as readonly string[]).includes(role)) {
      throw new ProblemException(HttpStatus.NOT_FOUND, 'ROLE_GRANT_NOT_FOUND', 'No such grant');
    }
    await this.roles.revoke(actor, userId.toLowerCase(), role as GrantableRole, requestIdOf(req));
  }
}
