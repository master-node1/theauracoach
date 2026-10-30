import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { DataRequestResponse, DeletionScheduledResponse } from '@aura/contracts';
import {
  CurrentUser,
  LocalObjectStorage,
  ProblemException,
  Public,
  type AuthenticatedUser,
  type ObjectStorage,
} from '@aura/service-kit';
import { DeletionService } from './deletion.service';
import { ExportsService } from './exports.service';
import { OBJECT_STORAGE } from './storage';

/** The parts of Express's response these routes use (this service does not depend on express). */
interface HttpResponse {
  status(code: number): this;
  set(headers: Record<string, string>): this;
  send(body: Buffer): void;
}

/** Data export, account deletion and restore (users LLD §3–5, docs/api/openapi.yaml). */
@Controller('v1/me')
export class PrivacyController {
  constructor(
    private readonly exports: ExportsService,
    private readonly deletion: DeletionService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  @Delete()
  @HttpCode(HttpStatus.ACCEPTED)
  requestDeletion(@CurrentUser() identity: AuthenticatedUser): Promise<DeletionScheduledResponse> {
    return this.deletion.request(identity);
  }

  @Post('restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  async restore(@CurrentUser() identity: AuthenticatedUser): Promise<void> {
    await this.deletion.restore(identity);
  }

  /** 202 for a new export, 200 with today's ready export when there is one. */
  @Post('exports')
  async requestExport(
    @CurrentUser() identity: AuthenticatedUser,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<DataRequestResponse> {
    const result = await this.exports.request(identity);
    res.status(result.created ? HttpStatus.ACCEPTED : HttpStatus.OK);
    return result.export;
  }

  @Get('exports')
  listExports(@CurrentUser() identity: AuthenticatedUser): Promise<DataRequestResponse[]> {
    return this.exports.list(identity);
  }

  @Get('exports/:id')
  getExport(
    @CurrentUser() identity: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DataRequestResponse> {
    return this.exports.get(identity, id);
  }

  /**
   * Local development only: serves a download link signed by LocalObjectStorage, standing in for
   * a pre-signed S3 URL. With S3 the link points at S3 and this route answers 404.
   */
  @Public()
  @Get('export-files')
  async download(@Query() query: Record<string, string>, @Res() res: HttpResponse): Promise<void> {
    const notFound = new ProblemException(
      HttpStatus.NOT_FOUND,
      'NOT_FOUND',
      'Link not found or expired',
    );
    if (!(this.storage instanceof LocalObjectStorage)) throw notFound;
    const link = this.storage.verifyDownload(new URLSearchParams(query));
    if (!link) throw notFound;
    const body = await this.storage.get(link.key).catch(() => null);
    if (!body) throw notFound;
    res
      .status(HttpStatus.OK)
      .set({
        'content-type': 'application/zip',
        'content-disposition': this.storage.contentDisposition(link.filename),
        'cache-control': 'private, no-store',
      })
      .send(body);
  }
}
