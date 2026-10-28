import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { REDIS } from '@aura/service-kit';
import type { Redis } from 'ioredis';
import { energyCheck, fromRows } from '../catalogue/nutrients';
import { PrismaService } from '../prisma.service';

export const ENERGY_MISMATCH = 'ENERGY_MISMATCH';
const LOCK_KEY = 'nutrition:data-qa:lock';
const BATCH = 500;
/** 21:30 UTC is 03:00 in India, the quietest hour. */
const RUN_AT_UTC = { hour: 21, minute: 30 };

export function nextRun(now: Date): Date {
  const next = new Date(now);
  next.setUTCHours(RUN_AT_UTC.hour, RUN_AT_UTC.minute, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/**
 * Nightly data QA (nutrition LLD §7): flags every live catalogue food whose stated energy is more
 * than 15% off its macros (ENERGY_MISMATCH) and clears the flag once fixed. Reviewers see flagged
 * foods with `GET /v1/admin/foods?qa=flagged`. A Redis lock keeps worker replicas from running it
 * twice.
 */
@Injectable()
export class DataQaJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DataQaJob.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap(): void {
    this.schedule();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule() {
    const delay = nextRun(new Date()).getTime() - Date.now();
    this.timer = setTimeout(() => {
      void this.runLocked().finally(() => this.schedule());
    }, delay);
    this.timer.unref();
  }

  async runLocked(): Promise<{ checked: number; flagged: number } | null> {
    const locked = await this.redis.set(LOCK_KEY, String(process.pid), 'EX', 3600, 'NX');
    if (locked !== 'OK') return null;
    try {
      const result = await this.run();
      this.logger.log(result, 'Nutrition data QA finished');
      return result;
    } catch (err) {
      this.logger.error({ err }, 'Nutrition data QA failed');
      return null;
    } finally {
      await this.redis.del(LOCK_KEY);
    }
  }

  async run(): Promise<{ checked: number; flagged: number }> {
    let cursor: string | undefined;
    let checked = 0;
    let flagged = 0;
    for (;;) {
      const foods = await this.prisma.foodItem.findMany({
        where: { status: { not: 'ARCHIVED' }, ...(cursor ? { id: { gt: cursor } } : {}) },
        select: { id: true, nutrients: { select: { nutrientCode: true, per100: true } } },
        orderBy: { id: 'asc' },
        take: BATCH,
      });
      if (foods.length === 0) break;
      cursor = foods[foods.length - 1]!.id;
      const bad: string[] = [];
      const good: string[] = [];
      for (const f of foods) (energyCheck(fromRows(f.nutrients)).ok ? good : bad).push(f.id);
      if (bad.length > 0) {
        await this.prisma.$executeRaw`
          UPDATE "FoodItem"
          SET "qaFlags" = array_append(array_remove("qaFlags", ${ENERGY_MISMATCH}), ${ENERGY_MISMATCH}),
              "qaCheckedAt" = now()
          WHERE id = ANY(${bad}::uuid[])`;
      }
      if (good.length > 0) {
        await this.prisma.$executeRaw`
          UPDATE "FoodItem"
          SET "qaFlags" = array_remove("qaFlags", ${ENERGY_MISMATCH}), "qaCheckedAt" = now()
          WHERE id = ANY(${good}::uuid[])`;
      }
      checked += foods.length;
      flagged += bad.length;
    }
    return { checked, flagged };
  }
}
