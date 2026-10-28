import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  MUSCLE_CODES,
  type EquipmentCode,
  type ExerciseDetail,
  type ExercisePage,
  type ExerciseQuery,
  type ExerciseSummary,
  type MuscleCode,
} from '@aura/contracts';
import { ProblemException, SERVICE_KIT_CONFIG } from '@aura/service-kit';
import type { Prisma } from '../generated/prisma';
import type { ServiceConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { LibraryCache, type Cached } from './library-cache';

const withParts = {
  muscles: true,
  equipment: true,
  media: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.ExerciseInclude;
type ExerciseRow = Prisma.ExerciseGetPayload<{ include: typeof withParts }>;

const muscleRank = (code: string) => MUSCLE_CODES.indexOf(code as MuscleCode);
const byRank = (a: string, b: string) => muscleRank(a) - muscleRank(b);

/** The published exercise library (GET /v1/exercises, /v1/exercises/{slug}), cached with ETags. */
@Injectable()
export class LibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: LibraryCache,
    @Inject(SERVICE_KIT_CONFIG) private readonly config: ServiceConfig,
  ) {}

  list(query: ExerciseQuery): Promise<Cached<ExercisePage>> {
    return this.cache.read(`list:${JSON.stringify(query)}`, () => this.loadPage(query));
  }

  /** Not-found answers are not cached, so a slug published later is found at once. */
  detail(slug: string): Promise<Cached<ExerciseDetail>> {
    return this.cache.read(`detail:${slug}`, () => this.loadDetail(slug));
  }

  private async loadPage(query: ExerciseQuery): Promise<ExercisePage> {
    const after = query.cursor ? Buffer.from(query.cursor, 'base64url').toString() : null;
    const rows = await this.prisma.exercise.findMany({
      where: {
        status: 'PUBLISHED',
        ...(query.pattern ? { movementPattern: query.pattern } : {}),
        ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
        ...(query.muscle ? { muscles: { some: { muscleCode: query.muscle } } } : {}),
        ...(query.equipment ? { equipment: { some: { equipmentCode: query.equipment } } } : {}),
        ...(after ? { slug: { gt: after } } : {}),
      },
      include: withParts,
      orderBy: { slug: 'asc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((r) => this.summary(r)),
      nextCursor:
        rows.length > query.limit
          ? Buffer.from(page[page.length - 1]!.slug).toString('base64url')
          : null,
    };
  }

  private async loadDetail(slug: string): Promise<ExerciseDetail> {
    const row = await this.prisma.exercise.findFirst({
      where: { slug, status: 'PUBLISHED' },
      include: {
        ...withParts,
        regression: { include: withParts },
        progression: { include: withParts },
      },
    });
    if (!row) {
      throw new ProblemException(HttpStatus.NOT_FOUND, 'EXERCISE_NOT_FOUND', 'No such exercise');
    }
    const link = (r: ExerciseRow | null) =>
      r && r.status === 'PUBLISHED' ? this.summary(r) : null;
    return {
      ...this.summary(row),
      version: row.version,
      mechanics: row.mechanics as ExerciseDetail['mechanics'],
      secondaryMuscles: this.muscles(row, 'secondary'),
      instructions: row.instructions,
      cues: row.cues,
      commonMistakes: row.commonMistakes,
      contraindications: row.contraindications as ExerciseDetail['contraindications'],
      defaultRestSec: row.defaultRestSec,
      regression: link(row.regression),
      progression: link(row.progression),
      media: row.media.map((m) => ({
        kind: m.kind,
        url: this.mediaUrl(m.storageKey),
        captionsUrl: m.captionsKey ? this.mediaUrl(m.captionsKey) : null,
        altText: m.altText,
        durationSec: m.durationSec,
      })),
    };
  }

  private summary(row: ExerciseRow): ExerciseSummary {
    const image = row.media.find((m) => m.kind === 'IMAGE');
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      movementPattern: row.movementPattern as ExerciseSummary['movementPattern'],
      difficulty: row.difficulty,
      tracking: row.tracking as ExerciseSummary['tracking'],
      primaryMuscles: this.muscles(row, 'primary'),
      equipment: row.equipment.map((e) => e.equipmentCode as EquipmentCode).sort(),
      illustrationKey: row.illustrationKey,
      thumbnailUrl: image ? this.mediaUrl(image.storageKey) : null,
    };
  }

  private muscles(row: ExerciseRow, role: 'primary' | 'secondary'): MuscleCode[] {
    return row.muscles
      .filter((m) => m.role === role)
      .map((m) => m.muscleCode as MuscleCode)
      .sort(byRank);
  }

  private mediaUrl(key: string): string {
    const base = this.config.MEDIA_BASE_URL;
    return base ? `${base.replace(/\/$/, '')}/${key}` : key;
  }
}
