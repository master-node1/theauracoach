import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  Confidence,
  FoodSearchResponse,
  FoodState,
  FoodSource,
  FoodSummary,
  FoodWarning,
  HouseholdUnit,
} from '@aura/contracts';
import { DIET_EXCLUSIONS, type DietType, type FoodFlag } from '@aura/domain/nutrition';
import { REDIS } from '@aura/service-kit';
import type { Redis } from 'ioredis';
import { Prisma } from '../generated/prisma';
import { NUTRIENT_CODES, REQUIRED_NUTRIENTS, fromRows } from '../catalogue/nutrients';
import { PrismaService } from '../prisma.service';

/**
 * Food search (nutrition LLD §5). Postgres finds and text-scores candidates with pg_trgm over
 * `searchText` (name + local names, lower-cased and unaccented); the published candidates of a
 * query are cached in Redis for 10 minutes. Per-user ranking and diet/allergen exclusion run in
 * the app, so the cache is shared by everyone.
 */

export const SEARCH_CACHE_TTL_S = 600;
/** Bumped on every publish or archive, which retires every cached query at once. */
export const SEARCH_GENERATION_KEY = 'nutrition:search:gen';
const CANDIDATES = 100;
/** word_similarity cut-off for fuzzy matches (typos such as "panner"). */
const FUZZY_THRESHOLD = '0.45';

const BOOST = {
  curated: 0.3,
  dish: 0.15,
  confidence: { HIGH: 0.1, MEDIUM: 0.05, LOW: 0 } as Record<Confidence, number>,
  recent: 0.5,
  cuisine: 0.15,
  diet: 0.1,
};

interface Candidate {
  id: string;
  name: string;
  localNames: string[];
  state: FoodState;
  source: FoodSource;
  confidence: Confidence;
  category: string | null;
  cuisine: string | null;
  dietTags: string[];
  allergens: string[];
  flags: string[];
  textScore: number;
  per100g: FoodSummary['per100g'];
  defaultUnit: HouseholdUnit | null;
}

export interface SearchContext {
  dietType: DietType | null;
  allergens: string[];
  cuisines: string[];
  recentFoodIds: Set<string>;
  /** Owner of USER foods to include; null for internal searches. */
  userId: string | null;
}

export interface SearchRequest {
  q: string;
  limit: number;
  offset: number;
  showAll: boolean;
}

@Injectable()
export class FoodSearchService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** What the user's profile says about exclusions and boosts. No profile: nothing is hidden. */
  async contextFor(userId: string): Promise<SearchContext> {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [profile, recent] = await Promise.all([
      this.prisma.userNutritionProfile.findUnique({
        where: { userId },
        select: { dietType: true, allergens: true, cuisines: true },
      }),
      this.prisma.mealEntry.findMany({
        where: { userId, date: { gte: since }, foodId: { not: null } },
        select: { foodId: true },
        distinct: ['foodId'],
        orderBy: { date: 'desc' },
        take: 100,
      }),
    ]);
    return {
      dietType: profile?.dietType ?? null,
      allergens: profile?.allergens ?? [],
      cuisines: profile?.cuisines ?? [],
      recentFoodIds: new Set(recent.map((r) => r.foodId!)),
      userId,
    };
  }

  async search(req: SearchRequest, ctx: SearchContext): Promise<FoodSearchResponse> {
    const q = normaliseQuery(req.q);
    const [published, own] = await Promise.all([
      this.publishedCandidates(q),
      ctx.userId ? this.userCandidates(q, ctx.userId) : Promise.resolve([]),
    ]);
    const excludedFlags = ctx.dietType ? DIET_EXCLUSIONS[ctx.dietType] : [];
    const ranked: { item: FoodSummary; score: number }[] = [];
    for (const c of [...own, ...published]) {
      const warnings: FoodWarning[] = [];
      if (c.flags.some((f) => excludedFlags.includes(f as FoodFlag))) warnings.push('DIET');
      if (c.allergens.some((a) => ctx.allergens.includes(a))) warnings.push('ALLERGEN');
      if (warnings.length > 0 && !req.showAll) continue;

      let score = c.textScore + BOOST.confidence[c.confidence];
      if (c.source === 'CURATED_RECIPE' || c.source === 'CURATED_INGREDIENT') {
        score += BOOST.curated;
      }
      if (c.state !== 'RAW') score += BOOST.dish;
      if (ctx.recentFoodIds.has(c.id)) score += BOOST.recent;
      if (c.cuisine && ctx.cuisines.includes(c.cuisine)) score += BOOST.cuisine;
      if (ctx.dietType && warnings.length === 0) score += BOOST.diet;
      const { textScore: _t, flags: _f, ...summary } = c;
      ranked.push({ item: { ...summary, warnings }, score });
    }
    ranked.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
    const page = ranked.slice(req.offset, req.offset + req.limit).map((r) => r.item);
    const next = req.offset + req.limit;
    return {
      items: page,
      nextCursor: next < ranked.length && next <= 999 ? String(next) : null,
    };
  }

  /** Retires every cached query, e.g. after a publish or archive. */
  async invalidate(): Promise<void> {
    await this.redis.incr(SEARCH_GENERATION_KEY);
  }

  private async publishedCandidates(q: string): Promise<Candidate[]> {
    const gen = (await this.redis.get(SEARCH_GENERATION_KEY)) ?? '0';
    const key = `nutrition:search:v1:${gen}:${createHash('sha1').update(q).digest('hex')}`;
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as Candidate[];
    const candidates = await this.query(q, Prisma.sql`f.status = 'PUBLISHED' AND f.source <> 'USER'`);
    await this.redis.set(key, JSON.stringify(candidates), 'EX', SEARCH_CACHE_TTL_S);
    return candidates;
  }

  private userCandidates(q: string, userId: string): Promise<Candidate[]> {
    return this.query(
      q,
      Prisma.sql`f.source = 'USER' AND f."createdById" = ${userId}::uuid AND f.status <> 'ARCHIVED'`,
    );
  }

  private async query(q: string, visible: Prisma.Sql): Promise<Candidate[]> {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const rows = await this.prisma.$transaction(async (tx) => {
      // Session-local threshold so the trigram index serves the fuzzy operator.
      await tx.$executeRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${FUZZY_THRESHOLD}, true)`;
      return tx.$queryRaw<
        (Omit<Candidate, 'per100g' | 'defaultUnit' | 'textScore'> & { textScore: number })[]
      >`
        WITH input AS (
          SELECT aura_search_norm(${q}) AS q, aura_search_norm(${like}) AS pattern
        )
        SELECT f.id, f.name, f."localNames", f.state, f.source, f.confidence, f.category,
               f.cuisine, f."dietTags", f.allergens, f.flags,
               (word_similarity(i.q, f."searchText")
                 + CASE WHEN aura_search_norm(f.name) = i.q
                          OR i.q = ANY (SELECT aura_search_norm(l) FROM unnest(f."localNames") l)
                        THEN 1 ELSE 0 END
                 + CASE WHEN aura_search_norm(f.name) LIKE i.q || '%' THEN 0.5
                        WHEN ' ' || f."searchText" LIKE '% ' || i.q || '%' THEN 0.25
                        ELSE 0 END
                 + 0.2 * length(i.q)::float8 / greatest(length(f.name), 1)
               )::float8 AS "textScore"
        FROM "FoodItem" f, input i
        WHERE ${visible}
          AND (f."searchText" LIKE i.pattern OR i.q <% f."searchText")
        ORDER BY "textScore" DESC, f.name
        LIMIT ${CANDIDATES}`;
    });
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [nutrients, units] = await Promise.all([
      this.prisma.foodNutrient.findMany({
        where: {
          foodId: { in: ids },
          nutrientCode: { in: REQUIRED_NUTRIENTS.map((k) => NUTRIENT_CODES[k]) },
        },
      }),
      this.prisma.foodUnit.findMany({ where: { foodId: { in: ids } }, orderBy: { code: 'asc' } }),
    ]);
    const nutrientsBy = groupBy(nutrients, (n) => n.foodId);
    const unitsBy = groupBy(units, (u) => u.foodId);
    return rows.map((r) => {
      const values = fromRows(nutrientsBy.get(r.id) ?? []);
      return {
        ...r,
        textScore: Number(r.textScore),
        per100g: {
          energyKcal: values.energyKcal ?? 0,
          proteinG: values.proteinG ?? 0,
          carbsG: values.carbsG ?? 0,
          fatG: values.fatG ?? 0,
          fibreG: values.fibreG ?? 0,
        },
        defaultUnit: defaultUnit(unitsBy.get(r.id) ?? []),
      };
    });
  }
}

/** The unit search shows first: a katori or roti beats a tablespoon. */
const UNIT_PREFERENCE = ['katori', 'roti', 'piece', 'plate', 'glass', 'cup', 'slice', 'ladle'];
export function defaultUnit(
  units: { code: string; label: string; grams: { toString(): string } }[],
): HouseholdUnit | null {
  const rank = (code: string) => {
    const i = UNIT_PREFERENCE.indexOf(code);
    return i === -1 ? UNIT_PREFERENCE.length : i;
  };
  const best = [...units].sort((a, b) => rank(a.code) - rank(b.code))[0];
  return best ? { code: best.code, label: best.label, grams: Number(best.grams.toString()) } : null;
}

export function normaliseQuery(q: string): string {
  return q
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}
