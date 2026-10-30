import { Controller, Get, Header, Param, Query, Req } from '@nestjs/common';
import {
  auditQuerySchema,
  type AuditEntry,
  type AuditPage,
  type AuditQuery,
} from '@aura/contracts';
import {
  auditRequestId,
  CurrentUser,
  Permissions,
  ZodValidationPipe,
  type AuthenticatedUser,
} from '@aura/service-kit';
import { AuditService } from './audit.service';

/**
 * The audit viewer's API (admin LLD §5). Read and export only: entries are append-only, so there
 * is deliberately no route that changes or deletes one.
 */
@Controller('v1/admin/audit')
@Permissions('audit:read')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery): Promise<AuditPage> {
    return this.audit.list(query);
  }

  @Get('export.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="audit-log.csv"')
  @Header('cache-control', 'no-store')
  export(
    @CurrentUser() actor: AuthenticatedUser,
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery,
    @Req() req: { id?: unknown },
  ): Promise<string> {
    return this.audit.exportCsv(actor, query, auditRequestId(req));
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<AuditEntry> {
    return this.audit.get(id);
  }
}
