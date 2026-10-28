import { HttpStatus } from '@nestjs/common';
import {
  exerciseContentSchema,
  templateContentSchema,
  type ContentRevision as ContentRevisionDto,
  type ContentRevisionPage,
  type ContentRevisionQuery,
  type ContentStatus,
  type ExerciseContent,
  type PublishIssue,
  type TemplateContent,
  type WorkoutContentKind,
} from '@aura/contracts';
import type { Exercise as EngineExercise } from '@aura/domain/workouts';
import { ProblemException, writeOutbox } from '@aura/service-kit';
import { Prisma, type ContentRevision, type PrismaClient } from '../generated/prisma';
import { isBodyweight, toEngineExercise } from './engine-mapping';
import { loadWorkoutPolicy } from './policy';
import { checkExercise, checkTemplateContent } from './publish-checks';

/** Who changes content: a staff user, or the importer (no user id). */
export interface ContentActor {
  id: string | null;
  /** The role the audit log shows, e.g. content_reviewer. */
  role: string;
  requestId?: string;
}

export const IMPORT_ACTOR: ContentActor = { id: null, role: 'content_import' };

export type ContentBody<K extends WorkoutContentKind> = K extends 'exercise'
  ? ExerciseContent
  : TemplateContent;
type Tx = Prisma.TransactionClient;
type NewStatus = { status?: 'DRAFT' | 'IN_REVIEW'; reviewRequired?: string | null };

const KIND = { exercise: 'EXERCISE', template: 'TEMPLATE' } as const;
const ENTITY = { exercise: 'exercise', template: 'workout_template' } as const;
const OPEN: ContentStatus[] = ['DRAFT', 'IN_REVIEW'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseBody<K extends WorkoutContentKind>(kind: K, body: unknown): ContentBody<K> {
  return (kind === 'exercise' ? exerciseContentSchema : templateContentSchema).parse(
    body,
  ) as ContentBody<K>;
}

export function isLive(row: Pick<ContentRevision, 'status' | 'supersededAt'>): boolean {
  return row.status === 'PUBLISHED' && row.supersededAt === null;
}

const notFound = () =>
  new ProblemException(HttpStatus.NOT_FOUND, 'CONTENT_NOT_FOUND', 'No such content version');

const transition = (from: ContentStatus, action: string) =>
  new ProblemException(
    HttpStatus.CONFLICT,
    'INVALID_TRANSITION',
    `A ${from.toLowerCase().replace('_', ' ')} version cannot be ${action}`,
  );

export function publishRefused(issues: PublishIssue[]) {
  return new ProblemException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'PUBLISH_CHECKS_FAILED',
    'This version does not pass the publish checks',
    undefined,
    issues.map((i) => ({
      path: i.path ?? '',
      message: i.detail ? `${i.code} ${JSON.stringify(i.detail)}` : i.code,
    })),
  );
}

function toDto<K extends WorkoutContentKind>(
  kind: K,
  row: ContentRevision,
): ContentRevisionDto<ContentBody<K>> {
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  return {
    id: row.id,
    kind,
    slug: row.slug,
    version: row.version,
    status: row.status,
    live: isLive(row),
    reviewRequired: row.reviewRequired,
    body: parseBody(kind, row.body),
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    submittedAt: iso(row.submittedAt),
    publishedAt: iso(row.publishedAt),
    archivedAt: iso(row.archivedAt),
  };
}

const json = (body: unknown) => body as Prisma.InputJsonValue;

function encodeCursor(row: { slug: string; version: number }): string {
  return Buffer.from(JSON.stringify([row.slug, row.version])).toString('base64url');
}

function decodeCursor(cursor: string): { slug: string; version: number } {
  try {
    const [slug, version] = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as unknown[];
    if (typeof slug === 'string' && Number.isInteger(version)) {
      return { slug, version: version as number };
    }
  } catch {
    // not JSON: answered below
  }
  throw new ProblemException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', 'Bad cursor');
}

/**
 * The content workflow (admin LLD §2) over `ContentRevision`, shared by the admin API and the
 * importer. Publishing writes the live row (`Exercise` / `WorkoutTemplate`), a `ContentPublished`
 * event and an audit event in one transaction; every other change is audited too.
 */
export class ContentStore {
  constructor(private readonly prisma: PrismaClient) {}

  async list<K extends WorkoutContentKind>(
    kind: K,
    query: ContentRevisionQuery,
  ): Promise<ContentRevisionPage<ContentBody<K>>> {
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.prisma.contentRevision.findMany({
      where: {
        kind: KIND[kind],
        ...(query.status ? { status: query.status } : {}),
        ...(query.q ? { slug: { contains: query.q.toLowerCase() } } : {}),
        ...(after
          ? {
              OR: [
                { slug: { gt: after.slug } },
                { slug: after.slug, version: { lt: after.version } },
              ],
            }
          : {}),
      },
      orderBy: [{ slug: 'asc' }, { version: 'desc' }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((r) => toDto(kind, r)),
      nextCursor: rows.length > query.limit ? encodeCursor(page[page.length - 1]!) : null,
    };
  }

  async get<K extends WorkoutContentKind>(kind: K, id: string) {
    return toDto(kind, await this.find(this.prisma, kind, id));
  }

  /** The newest version of each slug, for the importer's diff. */
  async latestBySlug(kind: WorkoutContentKind): Promise<Map<string, ContentRevision>> {
    const rows = await this.prisma.contentRevision.findMany({
      where: { kind: KIND[kind] },
      orderBy: [{ slug: 'asc' }, { version: 'desc' }],
      distinct: ['slug'],
    });
    return new Map(rows.map((r) => [r.slug, r]));
  }

  async create<K extends WorkoutContentKind>(
    kind: K,
    body: ContentBody<K>,
    actor: ContentActor,
    options: NewStatus = {},
  ) {
    const status = options.status ?? 'DRAFT';
    const row = await this.write(async (tx) => {
      const taken = await tx.contentRevision.findFirst({
        where: { kind: KIND[kind], slug: body.slug },
        select: { id: true },
      });
      if (taken) {
        throw new ProblemException(HttpStatus.CONFLICT, 'SLUG_TAKEN', 'This slug is already used');
      }
      const created = await tx.contentRevision.create({
        data: {
          kind: KIND[kind],
          slug: body.slug,
          version: 1,
          status,
          body: json(body),
          reviewRequired: options.reviewRequired ?? null,
          createdById: actor.id,
          ...(status === 'IN_REVIEW' ? { submittedAt: new Date(), submittedById: actor.id } : {}),
        },
      });
      await this.audit(tx, kind, 'create', actor, null, created);
      return created;
    });
    return toDto(kind, row);
  }

  /**
   * Edits an open version in place; an edit sends an in-review version back to draft unless the
   * importer asks otherwise. A published or archived version never changes: the edit opens the
   * next version instead, and `created` is true.
   */
  async update<K extends WorkoutContentKind>(
    kind: K,
    id: string,
    body: ContentBody<K>,
    actor: ContentActor,
    options: NewStatus = {},
  ): Promise<{ revision: ContentRevisionDto<ContentBody<K>>; created: boolean }> {
    const status = options.status ?? 'DRAFT';
    const { row, created } = await this.write(async (tx) => {
      const current = await this.find(tx, kind, id);
      if (body.slug !== current.slug) {
        throw new ProblemException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'SLUG_IMMUTABLE',
          'The slug of existing content cannot change',
        );
      }
      const reviewRequired =
        options.reviewRequired === undefined ? current.reviewRequired : options.reviewRequired;
      const submitted =
        status === 'IN_REVIEW'
          ? { submittedAt: new Date(), submittedById: actor.id }
          : { submittedAt: null, submittedById: null };
      if (OPEN.includes(current.status)) {
        const updated = await tx.contentRevision.update({
          where: { id: current.id },
          data: { body: json(body), status, reviewRequired, ...submitted },
        });
        await this.audit(tx, kind, 'update', actor, current, updated);
        return { row: updated, created: false };
      }
      const open = await tx.contentRevision.findFirst({
        where: { kind: KIND[kind], slug: current.slug, status: { in: OPEN } },
        select: { id: true },
      });
      if (open) {
        throw new ProblemException(
          HttpStatus.CONFLICT,
          'DRAFT_EXISTS',
          'This content already has an open draft; edit that version instead',
          undefined,
          undefined,
          { revisionId: open.id },
        );
      }
      const latest = await tx.contentRevision.aggregate({
        where: { kind: KIND[kind], slug: current.slug },
        _max: { version: true },
      });
      const next = await tx.contentRevision.create({
        data: {
          kind: KIND[kind],
          slug: current.slug,
          version: (latest._max.version ?? current.version) + 1,
          status,
          body: json(body),
          reviewRequired,
          createdById: actor.id,
          ...submitted,
        },
      });
      await this.audit(tx, kind, 'update', actor, current, next);
      return { row: next, created: true };
    });
    return { revision: toDto(kind, row), created };
  }

  async submit<K extends WorkoutContentKind>(kind: K, id: string, actor: ContentActor) {
    const row = await this.write(async (tx) => {
      const current = await this.find(tx, kind, id);
      if (current.status !== 'DRAFT') throw transition(current.status, 'submitted');
      const updated = await tx.contentRevision.update({
        where: { id },
        data: { status: 'IN_REVIEW', submittedAt: new Date(), submittedById: actor.id },
      });
      await this.audit(tx, kind, 'submit', actor, current, updated);
      return updated;
    });
    return toDto(kind, row);
  }

  /** The publish checks without writing anything. */
  async publishIssues<K extends WorkoutContentKind>(
    kind: K,
    body: ContentBody<K>,
  ): Promise<PublishIssue[]> {
    if (kind === 'exercise') {
      const slugs = await this.prisma.contentRevision.findMany({
        where: { kind: 'EXERCISE' },
        select: { slug: true },
        distinct: ['slug'],
      });
      return checkExercise(body as ExerciseContent, new Set(slugs.map((r) => r.slug)));
    }
    return checkTemplateContent(
      body as TemplateContent,
      await this.liveEngineExercises(),
      await loadWorkoutPolicy(this.prisma),
    );
  }

  /**
   * IN_REVIEW → PUBLISHED after the publish checks. The previous live version is superseded, not
   * changed, so every published body stays exactly as it was reviewed.
   */
  async publish<K extends WorkoutContentKind>(kind: K, id: string, actor: ContentActor) {
    const current = await this.find(this.prisma, kind, id);
    if (current.status !== 'IN_REVIEW') throw transition(current.status, 'published');
    const body = parseBody(kind, current.body);
    const issues = await this.publishIssues(kind, body);
    if (issues.length > 0) throw publishRefused(issues);

    const row = await this.write(async (tx) => {
      const now = new Date();
      await tx.contentRevision.updateMany({
        where: { kind: KIND[kind], slug: current.slug, status: 'PUBLISHED', supersededAt: null },
        data: { supersededAt: now },
      });
      const claimed = await tx.contentRevision.updateMany({
        where: { id, status: 'IN_REVIEW' },
        data: { status: 'PUBLISHED', publishedAt: now, publishedById: actor.id },
      });
      if (claimed.count === 0) throw transition('PUBLISHED', 'published twice');
      const entityId =
        kind === 'exercise'
          ? await this.writeExercise(tx, body as ExerciseContent, current.version, now)
          : await this.writeTemplate(tx, body as TemplateContent, current.version, now);
      const published = await tx.contentRevision.findUniqueOrThrow({ where: { id } });
      await writeOutbox(tx, {
        producer: 'workout-service',
        key: 'ContentPublished@1',
        userId: null,
        data: { kind, id: entityId, version: current.version },
      });
      await this.audit(tx, kind, 'publish', actor, current, published);
      return published;
    });
    return toDto(kind, row);
  }

  /**
   * Withdraws an open version, or takes the live version out of the library. An exercise that a
   * live template uses stays until the template changes. `libraryChanged` tells the caller to
   * drop its library cache.
   */
  async archive<K extends WorkoutContentKind>(kind: K, id: string, actor: ContentActor) {
    let libraryChanged = false;
    const row = await this.write(async (tx) => {
      const current = await this.find(tx, kind, id);
      const live = isLive(current);
      if (!OPEN.includes(current.status) && !live) throw transition(current.status, 'archived');
      if (live) {
        if (kind === 'exercise') {
          await this.assertUnused(tx, current.slug);
          await tx.exercise.update({ where: { slug: current.slug }, data: { status: 'ARCHIVED' } });
        } else {
          await tx.workoutTemplate.update({
            where: { slug: current.slug },
            data: { status: 'ARCHIVED' },
          });
        }
        libraryChanged = true;
      }
      const archived = await tx.contentRevision.update({
        where: { id },
        data: { status: 'ARCHIVED', archivedAt: new Date() },
      });
      await this.audit(tx, kind, 'archive', actor, current, archived);
      return archived;
    });
    return { revision: toDto(kind, row), libraryChanged };
  }

  /** The live exercise library as the engine sees it, keyed by slug. */
  async liveEngineExercises(): Promise<Map<string, EngineExercise>> {
    const [revisions, rows] = await Promise.all([
      this.prisma.contentRevision.findMany({
        where: { kind: 'EXERCISE', status: 'PUBLISHED', supersededAt: null },
        select: { slug: true, body: true },
      }),
      this.prisma.exercise.findMany({
        where: { status: 'PUBLISHED' },
        select: { id: true, slug: true, regressionId: true, progressionId: true },
      }),
    ]);
    const bodies = new Map(revisions.map((r) => [r.slug, r.body]));
    const library = new Map<string, EngineExercise>();
    for (const row of rows) {
      const body = bodies.get(row.slug);
      if (body === undefined) continue;
      library.set(
        row.slug,
        toEngineExercise(parseBody('exercise', body), row.id, 'PUBLISHED', row),
      );
    }
    return library;
  }

  private async find(db: Tx | PrismaClient, kind: WorkoutContentKind, id: string) {
    if (!UUID.test(id)) throw notFound();
    const row = await db.contentRevision.findFirst({ where: { id, kind: KIND[kind] } });
    if (!row) throw notFound();
    return row;
  }

  private async assertUnused(tx: Tx, slug: string): Promise<void> {
    const templates = await tx.workoutTemplate.findMany({
      where: { status: 'PUBLISHED', items: { some: { exercise: { slug } } } },
      select: { slug: true },
      orderBy: { slug: 'asc' },
    });
    if (templates.length > 0) {
      throw new ProblemException(
        HttpStatus.CONFLICT,
        'EXERCISE_IN_USE',
        'Live templates use this exercise; change them before archiving it',
        undefined,
        undefined,
        { templates: templates.map((t) => t.slug).join(',') },
      );
    }
  }

  private async writeExercise(tx: Tx, body: ExerciseContent, version: number, now: Date) {
    const linkId = async (slug: string | null) => {
      if (!slug) return null;
      const row = await tx.exercise.findFirst({
        where: { slug, status: 'PUBLISHED' },
        select: { id: true },
      });
      return row?.id ?? null;
    };
    const data = {
      name: body.name,
      status: 'PUBLISHED' as const,
      version,
      tracking: body.tracking,
      movementPattern: body.movementPattern,
      mechanics: body.mechanics,
      difficulty: body.difficulty,
      isBodyweight: isBodyweight(body.equipment),
      instructions: body.instructions,
      commonMistakes: body.commonMistakes,
      cues: body.cues,
      contraindications: body.contraindications,
      defaultRestSec: body.defaultRestSec,
      metValue: body.metValue,
      loadIncrementKg: body.loadIncrementKg,
      illustrationKey: body.illustrationKey,
      regressionId: await linkId(body.regression),
      progressionId: await linkId(body.progression),
      publishedAt: now,
    };
    const { id } = await tx.exercise.upsert({
      where: { slug: body.slug },
      create: { slug: body.slug, ...data },
      update: data,
      select: { id: true },
    });
    const role = (r: string) => (muscleCode: string) => ({ exerciseId: id, muscleCode, role: r });
    await tx.exerciseMuscle.deleteMany({ where: { exerciseId: id } });
    await tx.exerciseMuscle.createMany({
      data: [
        ...body.primaryMuscles.map(role('primary')),
        ...body.secondaryMuscles.map(role('secondary')),
      ],
    });
    await tx.exerciseEquipment.deleteMany({ where: { exerciseId: id } });
    await tx.exerciseEquipment.createMany({
      data: body.equipment.map((equipmentCode) => ({ exerciseId: id, equipmentCode })),
    });
    await tx.exerciseMedia.deleteMany({ where: { exerciseId: id } });
    await tx.exerciseMedia.createMany({
      data: body.media.map((m, sortOrder) => ({ exerciseId: id, sortOrder, ...m })),
    });
    // Live exercises that already name this one as their regression or progression link to it now.
    for (const link of ['regression', 'progression'] as const) {
      const linking = await tx.contentRevision.findMany({
        where: {
          kind: 'EXERCISE',
          status: 'PUBLISHED',
          supersededAt: null,
          body: { path: [link], equals: body.slug },
        },
        select: { slug: true },
      });
      if (linking.length === 0) continue;
      await tx.exercise.updateMany({
        where: { slug: { in: linking.map((r) => r.slug) } },
        data: link === 'regression' ? { regressionId: id } : { progressionId: id },
      });
    }
    return id;
  }

  private async writeTemplate(tx: Tx, body: TemplateContent, version: number, now: Date) {
    const slugs = [...new Set(body.days.flatMap((d) => d.exercises.map((s) => s.exercise)))];
    const exercises = await tx.exercise.findMany({
      where: { slug: { in: slugs }, status: 'PUBLISHED' },
      select: { id: true, slug: true },
    });
    const idOf = new Map(exercises.map((e) => [e.slug, e.id]));
    const missing = slugs.filter((s) => !idOf.has(s));
    if (missing.length > 0) {
      // An exercise was archived between the checks and this transaction.
      throw publishRefused(
        missing.map((slug) => ({ code: 'EXERCISE_NOT_PUBLISHED', detail: { slug } })),
      );
    }
    const data = {
      name: body.name,
      status: 'PUBLISHED' as const,
      version,
      goal: body.goal,
      experience: body.experience,
      daysPerWeek: body.daysPerWeek,
      location: body.location,
      split: body.split,
      days: body.days.map((d, dayIndex) => ({ dayIndex, name: d.name, focus: d.focus })),
      publishedAt: now,
    };
    const { id } = await tx.workoutTemplate.upsert({
      where: { slug: body.slug },
      create: { slug: body.slug, ...data },
      update: data,
      select: { id: true },
    });
    await tx.workoutTemplateExercise.deleteMany({ where: { templateId: id } });
    await tx.workoutTemplateExercise.createMany({
      data: body.days.flatMap((d, dayIndex) =>
        d.exercises.map((s, i) => ({
          templateId: id,
          dayIndex,
          order: i + 1,
          exerciseId: idOf.get(s.exercise)!,
          sets: s.sets,
          repMin: s.repMin,
          repMax: s.repMax,
          targetRpe: s.targetRpe,
          restSec: s.restSec,
        })),
      ),
    });
    return id;
  }

  private audit(
    tx: Tx,
    kind: WorkoutContentKind,
    action: 'create' | 'update' | 'submit' | 'publish' | 'archive',
    actor: ContentActor,
    before: ContentRevision | null,
    after: ContentRevision,
  ) {
    const state = (r: ContentRevision) => ({
      revisionId: r.id,
      slug: r.slug,
      version: r.version,
      status: r.status,
    });
    return writeOutbox(tx, {
      producer: 'workout-service',
      key: 'AuditEvent@1',
      userId: null,
      data: {
        actorId: actor.id,
        actorRole: actor.role,
        action: `${ENTITY[kind]}.${action}`,
        entityType: ENTITY[kind],
        entityId: after.slug,
        before: before ? state(before) : null,
        after: state(after),
        requestId: actor.requestId && UUID.test(actor.requestId) ? actor.requestId : null,
      },
    });
  }

  /** Runs `fn` in a transaction; losing a race on the unique indexes answers 409. */
  private async write<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ProblemException(
          HttpStatus.CONFLICT,
          'CONCURRENT_EDIT',
          'Someone changed this content at the same time; reload and try again',
        );
      }
      throw err;
    }
  }
}
