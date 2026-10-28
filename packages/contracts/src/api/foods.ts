import { z } from 'zod';
import { CONTENT_STATUSES, type ContentStatus } from './content';
import { DIET_TYPES } from './me';

/**
 * Food catalogue routes: `/v1/foods*` for users and `/v1/admin/foods*`, `/v1/admin/recipes*` for
 * staff (nutrition LLD §5, §7; admin LLD §2). nutrition-service validates with these schemas.
 */

export const FOOD_SOURCES = [
  'IFCT_2017',
  'USDA_FDC',
  'OPEN_FOOD_FACTS',
  'CURATED_RECIPE',
  'CURATED_INGREDIENT',
  'USER',
] as const;
export type FoodSource = (typeof FOOD_SOURCES)[number];

export const FOOD_STATES = ['RAW', 'COOKED', 'AS_SOLD'] as const;
export type FoodState = (typeof FOOD_STATES)[number];

export const CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/** Ingredient facts diet rules read; the same list as @aura/domain FOOD_FLAGS. */
export const FOOD_FLAGS = [
  'MEAT',
  'FISH',
  'EGG',
  'DAIRY',
  'HONEY',
  'ROOT_VEGETABLE',
  'ONION',
  'GARLIC',
  'FASTING_OK',
  'OIL',
] as const;
export type FoodFlag = (typeof FOOD_FLAGS)[number];

export const ALLERGENS = [
  'peanut',
  'tree_nut',
  'milk',
  'egg',
  'gluten',
  'soy',
  'fish',
  'shellfish',
  'sesame',
  'mustard',
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const MEAL_SLOTS = ['BREAKFAST', 'LUNCH', 'SNACK', 'DINNER'] as const;
export const REGIONS = ['north', 'south', 'east', 'west', 'northeast', 'pan_indian'] as const;

/** Nutrients per 100 g, keyed like @aura/domain NutrientKey. The first five are always present. */
export const nutrientsSchema = z.strictObject({
  energyKcal: z.number().min(0).max(900),
  proteinG: z.number().min(0).max(100),
  carbsG: z.number().min(0).max(100),
  fatG: z.number().min(0).max(100),
  fibreG: z.number().min(0).max(100),
  sugarG: z.number().min(0).max(100).optional(),
  sodiumMg: z.number().min(0).max(40000).optional(),
  ironMg: z.number().min(0).max(200).optional(),
  calciumMg: z.number().min(0).max(5000).optional(),
  vitaminB12Ug: z.number().min(0).max(1000).optional(),
  vitaminDUg: z.number().min(0).max(1000).optional(),
});
export type Nutrients = z.infer<typeof nutrientsSchema>;

const unitCode = z.string().regex(/^[a-z][a-z0-9_]{0,19}$/, 'Must be a lower_snake_case code');
export const householdUnitSchema = z.strictObject({
  code: unitCode,
  label: z.string().trim().min(1).max(40),
  grams: z.number().positive().max(5000),
});
export type HouseholdUnit = z.infer<typeof householdUnitSchema>;

const code = z.string().regex(/^[a-z][a-z0-9_]{1,29}$/, 'Must be a lower_snake_case code');
const localNames = z.array(z.string().trim().min(1).max(60)).max(12);

export const foodSearchQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(80),
  /** Include foods the user's diet or allergens exclude; they come back with warnings. */
  showAll: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z
    .string()
    .regex(/^\d{1,3}$/)
    .optional(),
});
export type FoodSearchQuery = z.infer<typeof foodSearchQuerySchema>;

export type FoodWarning = 'DIET' | 'ALLERGEN';

export interface FoodSummary {
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
  /** Per 100 g: energyKcal, proteinG, carbsG, fatG, fibreG. */
  per100g: Pick<Nutrients, 'energyKcal' | 'proteinG' | 'carbsG' | 'fatG' | 'fibreG'>;
  defaultUnit: HouseholdUnit | null;
  /** Set only with showAll: why the user's diet or allergens would normally hide this food. */
  warnings: FoodWarning[];
}

export interface FoodSearchResponse {
  items: FoodSummary[];
  nextCursor: string | null;
}

export interface FoodDetail extends FoodSummary {
  sourceRef: string | null;
  flags: FoodFlag[];
  nutrients: Nutrients;
  units: HouseholdUnit[];
  densityGPerMl: number | null;
  yieldFactor: number | null;
  rawEquivalentId: string | null;
  cookedFormIds: string[];
  recipeSlug: string | null;
  version: number;
}

/** Search for coach tools (`/internal/v1/foods/search`): the caller states the diet and allergens. */
export const internalFoodSearchSchema = z.strictObject({
  q: z.string().trim().min(1).max(80),
  dietType: z.enum(DIET_TYPES).optional(),
  allergens: z.array(z.enum(ALLERGENS)).max(10).default([]),
  limit: z.number().int().min(1).max(20).default(10),
});
export type InternalFoodSearch = z.infer<typeof internalFoodSearchSchema>;

// ---- Admin ---------------------------------------------------------------------------------------

/** Sources staff may enter by hand. Composite dishes come from recipes, user foods from users. */
export const ADMIN_FOOD_SOURCES = [
  'IFCT_2017',
  'USDA_FDC',
  'OPEN_FOOD_FACTS',
  'CURATED_INGREDIENT',
] as const;

export const adminFoodInputSchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  localNames: localNames.default([]),
  source: z.enum(ADMIN_FOOD_SOURCES),
  sourceRef: z.string().trim().min(1).max(60).nullable().default(null),
  confidence: z.enum(CONFIDENCES),
  state: z.enum(FOOD_STATES),
  category: code.nullable().default(null),
  cuisine: code.nullable().default(null),
  flags: z.array(z.enum(FOOD_FLAGS)).max(FOOD_FLAGS.length).default([]),
  allergens: z.array(z.enum(ALLERGENS)).max(ALLERGENS.length).default([]),
  densityGPerMl: z.number().positive().max(3).nullable().default(null),
  rawEquivalentId: z.uuid().nullable().default(null),
  yieldFactor: z.number().positive().max(9.999).nullable().default(null),
  nutrients: nutrientsSchema,
  units: z.array(householdUnitSchema).max(12).default([]),
});
export type AdminFoodInput = z.infer<typeof adminFoodInputSchema>;
/** PATCH bodies: only the fields to change (no defaults are filled in). */
export const adminFoodPatchSchema = adminFoodInputSchema
  .extend({
    localNames: localNames,
    sourceRef: z.string().trim().min(1).max(60).nullable(),
    category: code.nullable(),
    cuisine: code.nullable(),
    flags: z.array(z.enum(FOOD_FLAGS)).max(FOOD_FLAGS.length),
    allergens: z.array(z.enum(ALLERGENS)).max(ALLERGENS.length),
    densityGPerMl: z.number().positive().max(3).nullable(),
    rawEquivalentId: z.uuid().nullable(),
    yieldFactor: z.number().positive().max(9.999).nullable(),
    units: z.array(householdUnitSchema).max(12),
  })
  .partial();
export type AdminFoodPatch = z.infer<typeof adminFoodPatchSchema>;

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Must be a lower-kebab-case slug')
  .max(80);

const recipeIngredients = z
  .array(
    z.strictObject({
      foodId: z.uuid(),
      grams: z.number().positive().max(10000),
      note: z.string().trim().max(80).nullable().default(null),
    }),
  )
  .min(1)
  .max(40);
const recipeSubstitutions = z
  .array(
    z.strictObject({
      ingredientFoodId: z.uuid(),
      alternatives: z.array(z.uuid()).min(1).max(5),
      note: z.string().trim().max(120).nullable().default(null),
    }),
  )
  .max(20);

export const adminRecipeInputSchema = z.strictObject({
  slug,
  name: z.string().trim().min(2).max(120),
  localNames: localNames.default([]),
  cuisine: code.nullable().default(null),
  region: z.enum(REGIONS).nullable().default(null),
  mealSlots: z.array(z.enum(MEAL_SLOTS)).min(1).max(4),
  servings: z.number().int().min(1).max(50),
  cookedYieldG: z.number().positive().max(50000),
  yieldMeasured: z.boolean().default(false),
  restaurantStyle: z.boolean().default(false),
  prepMinutes: z.number().int().min(0).max(1440),
  cookMinutes: z.number().int().min(0).max(1440),
  costTier: z.number().int().min(1).max(3).default(2),
  steps: z.array(z.string().trim().min(3).max(400)).min(1).max(20),
  ingredients: recipeIngredients,
  substitutions: recipeSubstitutions.default([]),
  units: z.array(householdUnitSchema).max(8).default([]),
});
export type AdminRecipeInput = z.infer<typeof adminRecipeInputSchema>;
export const adminRecipePatchSchema = adminRecipeInputSchema
  .omit({ slug: true })
  .extend({
    localNames: localNames,
    cuisine: code.nullable(),
    region: z.enum(REGIONS).nullable(),
    yieldMeasured: z.boolean(),
    restaurantStyle: z.boolean(),
    costTier: z.number().int().min(1).max(3),
    substitutions: recipeSubstitutions,
    units: z.array(householdUnitSchema).max(8),
  })
  .partial();
export type AdminRecipePatch = z.infer<typeof adminRecipePatchSchema>;

export const adminContentListQuerySchema = z.strictObject({
  status: z.enum(CONTENT_STATUSES).optional(),
  q: z.string().trim().min(1).max(80).optional(),
  /** `flagged`: foods the nightly data QA job flagged. */
  qa: z.enum(['flagged']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});
export type AdminContentListQuery = z.infer<typeof adminContentListQuerySchema>;

export const adminRejectSchema = z.strictObject({
  note: z.string().trim().min(3).max(500),
});
export type AdminReject = z.infer<typeof adminRejectSchema>;

export interface ContentWorkflowState {
  status: ContentStatus;
  version: number;
  /** State of edits waiting on a published item, null when there are none. */
  revisionStatus: ContentStatus | null;
  reviewRequired: string | null;
  publishedAt: string | null;
}

export interface AdminFood extends FoodDetail, ContentWorkflowState {
  qaFlags: string[];
  pendingRevision: AdminFoodPatch | null;
}

export interface AdminRecipe extends ContentWorkflowState {
  id: string;
  slug: string;
  name: string;
  localNames: string[];
  cuisine: string | null;
  region: string | null;
  mealSlots: string[];
  servings: number;
  cookedYieldG: number;
  yieldMeasured: boolean;
  restaurantStyle: boolean;
  prepMinutes: number;
  cookMinutes: number;
  costTier: number;
  steps: string[];
  ingredients: { foodId: string; name: string; grams: number; note: string | null }[];
  substitutions: { ingredientFoodId: string; alternatives: string[]; note: string | null }[];
  units: HouseholdUnit[];
  dietTags: string[];
  allergens: string[];
  fastingOk: boolean;
  oilG: number;
  /** The composite dish users log, regenerated on every publish. */
  foodId: string | null;
  pendingRevision: AdminRecipePatch | null;
}

export interface AdminPage<T> {
  items: T[];
  nextCursor: string | null;
}
