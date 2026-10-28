import { Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import type { AdminUserAccount, AdminUserLookup } from '@aura/contracts';
import {
  auditRequestId,
  CurrentUser,
  Permissions,
  ZodValidationPipe,
  type AuthenticatedUser,
} from '@aura/service-kit';
import { AdminUsersService } from './admin-users.service';

const lookupSchema = z.strictObject({ email: z.email().max(254) });

/** Support lookups (admin LLD §6). The web BFF adds the other services' sections. */
@Controller('v1/admin/users')
@Permissions('user:support_read')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  /** Finds the account behind an email a user gave support; answers with the id and a masked email. */
  @Get()
  lookup(
    @Query(new ZodValidationPipe(lookupSchema)) q: { email: string },
  ): Promise<AdminUserLookup> {
    return this.users.lookup(q.email);
  }

  @Get(':userId')
  view(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Req() req: { id?: unknown },
  ): Promise<AdminUserAccount> {
    return this.users.view(actor, userId.toLowerCase(), auditRequestId(req));
  }
}
