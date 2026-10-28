import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { exerciseQuerySchema, type ExerciseQuery } from '@aura/contracts';
import { ZodValidationPipe } from '@aura/service-kit';
import type { Cached } from './library-cache';
import { LibraryService } from './library.service';

type HttpReq = { headers: Record<string, string | string[] | undefined> };
type HttpRes = { status(code: number): unknown; setHeader(name: string, value: string): unknown };

/**
 * The exercise library for signed-in users (workouts LLD §7). Responses carry an ETag; a client
 * sending it back in If-None-Match gets 304 until the library changes.
 */
@Controller('v1/exercises')
export class ExercisesController {
  constructor(private readonly library: LibraryService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(exerciseQuerySchema)) query: ExerciseQuery,
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
  ) {
    return conditional(await this.library.list(query), req, res);
  }

  @Get(':slug')
  async detail(
    @Param('slug') slug: string,
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
  ) {
    return conditional(await this.library.detail(slug), req, res);
  }
}

function conditional<T>(entry: Cached<T>, req: HttpReq, res: HttpRes): T | undefined {
  res.setHeader('ETag', entry.etag);
  res.setHeader('Cache-Control', 'private, no-cache');
  const sent = req.headers['if-none-match'];
  const tags = (Array.isArray(sent) ? sent.join(',') : (sent ?? ''))
    .split(',')
    .map((t) => t.trim());
  if (tags.includes(entry.etag) || tags.includes(`W/${entry.etag}`)) {
    res.status(304);
    return undefined;
  }
  return entry.body;
}
