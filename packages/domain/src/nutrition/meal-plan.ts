import type Decimal from 'decimal.js';
import { addDays } from './assessment';
import { dec, Dec, sum, type Numeric } from './decimal';
import { fitsDiet } from './diet';
import { deriveAllergens, deriveFlags } from './composite-recipe';
import { ensure } from './errors';
import type { RationaleCode } from './rationale';
import type { Confidence, DietType, FoodFlag, MealSlot } from './types';

/** Nutrition LLD §6 (meal-plan generator, grocery list, alternatives). */

export const ENERGY_TOLERANCE = 0.07;
export const PROTEIN_MIN_RATIO = 0.9;
export const FIBRE_PREFERRED_RATIO = 0.8;
export const MAX_USES_PER_WEEK = 2;
export const SERVING_STEP = 0.5;
export const MIN_SERVINGS = 0.5;
export const MAX_SERVINGS = 3;
const LOCAL_SEARCH_ROUNDS = 40;

/** Share of daily energy each slot aims for before local search balances the day. */
export const SLOT_SHARE: Record<MealSlot, number> = {
  BREAKFAST: 0.25,
  LUNCH: 0.35,
  SNACK: 0.1,
  DINNER: 0.3,
};

export interface PlanIngredient {
  foodId: string;
  name: string;
  /** Raw grams per serving of the recipe. */
  gramsPerServing: Numeric;
  aisle: string;
  allergens: readonly string[];
  flags: readonly FoodFlag[];
  /** Purchasable pack size (FoodUnit `pack`), when defined. */
  packGrams?: Numeric;
}

export interface PlanRecipe {
  id: string;
  name: string;
  slots: readonly MealSlot[];
  perServing: { energyKcal: Numeric; proteinG: Numeric; fibreG: Numeric };
  ingredients: readonly PlanIngredient[];
  prepMinutes: number;
  /** 1 budget · 2 standard · 3 premium. */
  costTier: 1 | 2 | 3;
}

export interface MealPlanPreferences {
  dietType: DietType;
  allergens: readonly string[];
  dislikedFoodIds?: readonly string[];
  /** Applies Monday–Friday only. */
  maxWeekdayPrepMinutes?: number;
  costTier?: 1 | 2 | 3;
}

export interface MealPlanInput {
  /** ISO date of the first day (usually a Monday). */
  weekStart: string;
  days?: number;
  slots: readonly MealSlot[];
  targets: { energyKcal: number; proteinG: number; fibreG: number };
  preferences: MealPlanPreferences;
  /** ISO dates on which only FASTING_OK recipes are allowed. */
  fastingDates?: readonly string[];
  recipes: readonly PlanRecipe[];
}

export type PlanIssueCode = 'UNSATISFIABLE_SLOT' | 'DAY_TARGET_NOT_MET';

export interface PlanIssue {
  date: string;
  slot?: MealSlot;
  code: PlanIssueCode;
}

export interface PlannedItem {
  slot: MealSlot;
  recipeId: string;
  servings: number;
}

export interface PlannedDay {
  date: string;
  fasting: boolean;
  items: PlannedItem[];
  totals: { energyKcal: Decimal; proteinG: Decimal; fibreG: Decimal };
  withinTargets: boolean;
  /** Relaxations needed for this day (variety, then prep time). Hard filters are never relaxed. */
  relaxations: RationaleCode[];
}

export interface MealPlan {
  weekStart: string;
  days: PlannedDay[];
  relaxations: RationaleCode[];
  issues: PlanIssue[];
}

interface Candidate {
  recipe: PlanRecipe;
  e: number;
  p: number;
  f: number;
}

interface SlotPick {
  slot: MealSlot;
  c: Candidate;
  servings: number;
}

/** Hard filters: diet, derived allergens, dislikes. Never relaxed (LLD §6.1, §6.5). */
export function violatesHardFilters(recipe: PlanRecipe, prefs: MealPlanPreferences): boolean {
  const allergens = deriveAllergens(recipe.ingredients);
  if (allergens.some((a) => prefs.allergens.includes(a))) return true;
  if (!fitsDiet(prefs.dietType, deriveFlags(recipe.ingredients))) return true;
  const disliked = prefs.dislikedFoodIds ?? [];
  return recipe.ingredients.some((i) => disliked.includes(i.foodId));
}

export function isFastingOk(recipe: PlanRecipe): boolean {
  return deriveFlags(recipe.ingredients).includes('FASTING_OK');
}

function isWeekday(isoDate: string): boolean {
  const dow = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return dow >= 1 && dow <= 5;
}

function snapServings(raw: number): number {
  const snapped = Math.round(raw / SERVING_STEP) * SERVING_STEP;
  return Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, snapped));
}

const SERVING_OPTIONS: number[] = [];
for (let s = MIN_SERVINGS; s <= MAX_SERVINGS; s += SERVING_STEP) SERVING_OPTIONS.push(s);

interface DayContext {
  targets: MealPlanInput['targets'];
  prefCost?: number;
  usedThisWeek: Map<string, number>;
  enforceVariety: boolean;
}

function dayTotals(picks: SlotPick[]) {
  let e = 0;
  let p = 0;
  let f = 0;
  for (const pk of picks) {
    e += pk.c.e * pk.servings;
    p += pk.c.p * pk.servings;
    f += pk.c.f * pk.servings;
  }
  return { e, p, f };
}

function useCounts(picks: SlotPick[], ctx: DayContext): Map<string, number> {
  const counts = new Map(ctx.usedThisWeek);
  for (const pk of picks) counts.set(pk.c.recipe.id, (counts.get(pk.c.recipe.id) ?? 0) + 1);
  return counts;
}

function meetsTargets(picks: SlotPick[], ctx: DayContext): boolean {
  const { e, p } = dayTotals(picks);
  const t = ctx.targets;
  if (Math.abs(e - t.energyKcal) / t.energyKcal > ENERGY_TOLERANCE + 1e-9) return false;
  if (p < t.proteinG * PROTEIN_MIN_RATIO - 1e-9) return false;
  if (ctx.enforceVariety) {
    for (const n of useCounts(picks, ctx).values()) if (n > MAX_USES_PER_WEEK) return false;
  }
  return true;
}

/** Lower is better. Float scoring is fine here; reported totals are recomputed with Decimal. */
function cost(picks: SlotPick[], ctx: DayContext): number {
  const { e, p, f } = dayTotals(picks);
  const t = ctx.targets;
  const energyDev = Math.abs(e - t.energyKcal) / t.energyKcal;
  let score = energyDev * 100;
  if (energyDev > ENERGY_TOLERANCE) score += 100 + (energyDev - ENERGY_TOLERANCE) * 1000;
  const pr = t.proteinG > 0 ? p / t.proteinG : 1;
  if (pr < PROTEIN_MIN_RATIO) score += 100 + (PROTEIN_MIN_RATIO - pr) * 1000;
  score += Math.max(0, 1 - pr) * 10;
  const fr = t.fibreG > 0 ? f / t.fibreG : 1;
  if (fr < FIBRE_PREFERRED_RATIO) score += (FIBRE_PREFERRED_RATIO - fr) * 20;
  for (const [id, n] of useCounts(picks, ctx)) {
    if (n > MAX_USES_PER_WEEK) score += (n - MAX_USES_PER_WEEK) * 50;
    const before = ctx.usedThisWeek.get(id) ?? 0;
    score += Math.min(n, before) * 2; // gentle push towards variety
  }
  for (const pk of picks) {
    if (ctx.prefCost !== undefined) score += Math.abs(pk.c.recipe.costTier - ctx.prefCost);
    score += Math.abs(pk.servings - 1) * 0.5;
  }
  return score;
}

function better(a: number, b: number): boolean {
  return a < b - 1e-9;
}

function planDay(
  slots: MealSlot[],
  bySlot: Map<MealSlot, Candidate[]>,
  ctx: DayContext,
): SlotPick[] {
  const shareTotal = slots.reduce((acc, s) => acc + SLOT_SHARE[s], 0);
  const picks: SlotPick[] = [];

  // Greedy: fill each slot with the candidate that best fits the slot's energy share.
  for (const slot of slots) {
    const cands = bySlot.get(slot) ?? [];
    let best: SlotPick | null = null;
    let bestScore = Infinity;
    const slotEnergy = (ctx.targets.energyKcal * SLOT_SHARE[slot]) / shareTotal;
    const slotProtein = (ctx.targets.proteinG * SLOT_SHARE[slot]) / shareTotal;
    for (const c of cands) {
      const servings = c.e > 0 ? snapServings(slotEnergy / c.e) : MIN_SERVINGS;
      const trial = [...picks, { slot, c, servings }];
      const local =
        (Math.abs(c.e * servings - slotEnergy) / ctx.targets.energyKcal) * 100 +
        (Math.max(0, slotProtein - c.p * servings) / Math.max(ctx.targets.proteinG, 1)) * 100;
      const score = local + cost(trial, ctx) * 0.01;
      if (better(score, bestScore)) {
        bestScore = score;
        best = { slot, c, servings };
      }
    }
    if (best) picks.push(best);
  }

  // Local search: best-improvement swaps of recipe and/or servings for one slot at a time.
  let current = cost(picks, ctx);
  for (let round = 0; round < LOCAL_SEARCH_ROUNDS; round++) {
    let bestMove: { index: number; pick: SlotPick } | null = null;
    let bestScore = current;
    picks.forEach((pk, index) => {
      for (const c of bySlot.get(pk.slot) ?? []) {
        for (const servings of SERVING_OPTIONS) {
          if (c === pk.c && servings === pk.servings) continue;
          const trial = picks.slice();
          trial[index] = { slot: pk.slot, c, servings };
          const score = cost(trial, ctx);
          if (better(score, bestScore)) {
            bestScore = score;
            bestMove = { index, pick: trial[index]! };
          }
        }
      }
    });
    if (!bestMove) break;
    const move: { index: number; pick: SlotPick } = bestMove;
    picks[move.index] = move.pick;
    current = bestScore;
  }
  return picks;
}

export function generateMealPlan(input: MealPlanInput): MealPlan {
  const days = input.days ?? 7;
  ensure(days >= 1 && days <= 14, 'days must be 1–14');
  ensure(input.slots.length > 0, 'at least one slot is required');
  ensure(input.targets.energyKcal > 0, 'energy target must be positive');
  const prefs = input.preferences;
  const fasting = new Set(input.fastingDates ?? []);
  const slots = [...new Set(input.slots)];

  // Hard filters once, in a stable order so the plan is deterministic.
  const allowed: Candidate[] = input.recipes
    .filter((r) => !violatesHardFilters(r, prefs))
    .map((r) => ({
      recipe: r,
      e: dec(r.perServing.energyKcal).toNumber(),
      p: dec(r.perServing.proteinG).toNumber(),
      f: dec(r.perServing.fibreG).toNumber(),
    }))
    .sort((a, b) => (a.recipe.id < b.recipe.id ? -1 : a.recipe.id > b.recipe.id ? 1 : 0));

  const used = new Map<string, number>();
  const planDays: PlannedDay[] = [];
  const issues: PlanIssue[] = [];
  const relaxationsAll = new Set<RationaleCode>();

  for (let d = 0; d < days; d++) {
    const date = addDays(input.weekStart, d);
    const isFasting = fasting.has(date);
    const weekday = isWeekday(date);

    // Relaxation ladder: 0 = all soft rules, 1 = variety relaxed, 2 = variety and prep time relaxed.
    let chosen: { picks: SlotPick[]; level: number; ok: boolean; score: number } | null = null;
    for (let level = 0; level <= 2; level++) {
      const ctx: DayContext = {
        targets: input.targets,
        prefCost: prefs.costTier,
        usedThisWeek: used,
        enforceVariety: level === 0,
      };
      const bySlot = new Map<MealSlot, Candidate[]>();
      for (const slot of slots) {
        bySlot.set(
          slot,
          allowed.filter((c) => {
            if (!c.recipe.slots.includes(slot)) return false;
            if (isFasting && !isFastingOk(c.recipe)) return false;
            if (level < 1 && (used.get(c.recipe.id) ?? 0) >= MAX_USES_PER_WEEK) return false;
            if (
              level < 2 &&
              weekday &&
              prefs.maxWeekdayPrepMinutes !== undefined &&
              c.recipe.prepMinutes > prefs.maxWeekdayPrepMinutes
            ) {
              return false;
            }
            return true;
          }),
        );
      }
      const picks = planDay(slots, bySlot, ctx);
      const ok = picks.length === slots.length && meetsTargets(picks, ctx);
      const score = cost(picks, { ...ctx, enforceVariety: false });
      // Prefer: satisfied at the lowest level; otherwise the fullest, lowest-cost attempt.
      if (
        !chosen ||
        (ok && !chosen.ok) ||
        (!chosen.ok && !ok && (picks.length > chosen.picks.length || better(score, chosen.score)))
      ) {
        chosen = { picks, level, ok, score };
      }
      if (ok) break;
    }

    const result = chosen!;
    const dayRelaxations: RationaleCode[] = [];
    if (result.level >= 1) dayRelaxations.push('RELAXED_VARIETY');
    if (result.level >= 2) dayRelaxations.push('RELAXED_PREP_TIME');
    dayRelaxations.forEach((r) => relaxationsAll.add(r));

    // Final, separate safety pass (LLD §6.5): re-check every hard filter on the output.
    const finalPicks = result.picks.filter(
      (pk) => !violatesHardFilters(pk.c.recipe, prefs) && (!isFasting || isFastingOk(pk.c.recipe)),
    );
    for (const slot of slots) {
      if (!finalPicks.some((pk) => pk.slot === slot)) {
        issues.push({ date, slot, code: 'UNSATISFIABLE_SLOT' });
      }
    }
    const withinTargets = result.ok && finalPicks.length === result.picks.length;
    if (!withinTargets) issues.push({ date, code: 'DAY_TARGET_NOT_MET' });

    for (const pk of finalPicks) used.set(pk.c.recipe.id, (used.get(pk.c.recipe.id) ?? 0) + 1);
    const items = finalPicks.map((pk) => ({
      slot: pk.slot,
      recipeId: pk.c.recipe.id,
      servings: pk.servings,
    }));
    planDays.push({
      date,
      fasting: isFasting,
      items,
      totals: totalsFor(items, input.recipes),
      withinTargets,
      relaxations: dayRelaxations,
    });
  }

  return {
    weekStart: input.weekStart,
    days: planDays,
    relaxations: [...relaxationsAll],
    issues,
  };
}

function recipeIndex(recipes: readonly PlanRecipe[]): Map<string, PlanRecipe> {
  return new Map(recipes.map((r) => [r.id, r]));
}

function totalsFor(items: PlannedItem[], recipes: readonly PlanRecipe[]) {
  const index = recipeIndex(recipes);
  const pick = (key: keyof PlanRecipe['perServing']) =>
    sum(items.map((i) => dec(index.get(i.recipeId)!.perServing[key]).times(i.servings)));
  return { energyKcal: pick('energyKcal'), proteinG: pick('proteinG'), fibreG: pick('fibreG') };
}

// ---------------------------------------------------------------------------------------------
// Grocery list

export interface GroceryItem {
  foodId: string;
  name: string;
  aisle: string;
  /** Exact raw grams across the plan (Decimal, unrounded). */
  grams: Decimal;
  /** Packs to buy, when the food has a pack size. */
  packs: number | null;
  /** Grams to show when there is no pack: rounded up to the next 10 g. */
  displayGrams: number;
}

export interface GroceryList {
  aisles: { aisle: string; items: GroceryItem[] }[];
  /** Sum of `grams` over all items; equals the plan's ingredient grams exactly. */
  totalGrams: Decimal;
}

export function groceryList(plan: MealPlan, recipes: readonly PlanRecipe[]): GroceryList {
  const index = recipeIndex(recipes);
  const byFood = new Map<string, { ingredient: PlanIngredient; grams: Decimal }>();
  for (const day of plan.days) {
    for (const item of day.items) {
      const recipe = index.get(item.recipeId);
      ensure(recipe !== undefined, `recipe ${item.recipeId} is missing`);
      for (const ing of recipe.ingredients) {
        const grams = dec(ing.gramsPerServing).times(item.servings);
        const entry = byFood.get(ing.foodId);
        if (entry) entry.grams = entry.grams.plus(grams);
        else byFood.set(ing.foodId, { ingredient: ing, grams });
      }
    }
  }

  const aisles = new Map<string, GroceryItem[]>();
  for (const [foodId, { ingredient, grams }] of byFood) {
    const pack = ingredient.packGrams !== undefined ? dec(ingredient.packGrams) : null;
    const item: GroceryItem = {
      foodId,
      name: ingredient.name,
      aisle: ingredient.aisle,
      grams,
      packs: pack && pack.gt(0) ? grams.div(pack).ceil().toNumber() : null,
      displayGrams: grams.div(10).ceil().times(10).toNumber(),
    };
    const list = aisles.get(ingredient.aisle) ?? [];
    list.push(item);
    aisles.set(ingredient.aisle, list);
  }

  return {
    aisles: [...aisles.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([aisle, items]) => ({
        aisle,
        items: items.sort(
          (a, b) => a.name.localeCompare(b.name) || a.foodId.localeCompare(b.foodId),
        ),
      })),
    totalGrams: sum([...byFood.values()].map((v) => v.grams)),
  };
}

// ---------------------------------------------------------------------------------------------
// Alternatives (C9)

export type AlternativeContext = 'eating_out' | 'no_cooking' | 'travel';

export interface AlternativeFood {
  id: string;
  name: string;
  contexts: readonly AlternativeContext[];
  slots?: readonly MealSlot[];
  perServing: { energyKcal: Numeric; proteinG: Numeric; carbsG: Numeric; fatG: Numeric };
  confidence: Confidence;
  allergens: readonly string[];
  flags: readonly FoodFlag[];
}

export interface AlternativesInput {
  slot: MealSlot;
  context: AlternativeContext;
  /** What is left of the day's (or slot's) budget. */
  remaining: { energyKcal: number; proteinG: number; carbsG: number; fatG: number };
  preferences: Pick<MealPlanPreferences, 'dietType' | 'allergens'>;
  candidates: readonly AlternativeFood[];
  limit?: number;
}

export interface Alternative {
  id: string;
  name: string;
  confidence: Confidence;
  /** 0–100, higher fits the remaining macros better. */
  fitScore: number;
}

export function suggestAlternatives(input: AlternativesInput): Alternative[] {
  const r = input.remaining;
  const rel = (value: Decimal, target: number) =>
    value.minus(target).abs().div(Math.max(target, 10)).toNumber();

  return input.candidates
    .filter((c) => c.contexts.includes(input.context))
    .filter((c) => !c.slots || c.slots.includes(input.slot))
    .filter((c) => !c.allergens.some((a) => input.preferences.allergens.includes(a)))
    .filter((c) => fitsDiet(input.preferences.dietType, c.flags))
    .map((c) => {
      const e = dec(c.perServing.energyKcal);
      const p = dec(c.perServing.proteinG);
      // Protein shortfall matters more than excess.
      const proteinGap = p.lt(r.proteinG) ? rel(p, r.proteinG) : rel(p, r.proteinG) * 0.25;
      const distance =
        rel(e, r.energyKcal) +
        proteinGap +
        0.5 * rel(dec(c.perServing.carbsG), r.carbsG) +
        0.5 * rel(dec(c.perServing.fatG), r.fatG);
      const fitScore = Math.round(new Dec(100).times(Math.max(0, 1 - distance / 2)).toNumber());
      return { id: c.id, name: c.name, confidence: c.confidence, fitScore };
    })
    .sort((a, b) => b.fitScore - a.fitScore || a.id.localeCompare(b.id))
    .slice(0, input.limit ?? 5);
}
