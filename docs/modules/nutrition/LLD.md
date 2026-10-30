# Nutrition — Low-Level Design

Service: **nutrition-service** · see the [service catalog](../../architecture/service-catalog.md) for owned data, events and allowed calls.

## 1. Responsibilities

Food catalogue and search, serving normalisation, logging, daily summaries, targets engine, meal-plan generator, recipes, grocery lists, barcode lookup, target adaptation.

```text
services/nutrition-service/
  content/nutrition/       curated ingredients, units, cooked forms, recipes/<region>.json (TAC-14)
  src/catalogue/           content loader (Zod), records, composite builder, idempotent catalogue writer
  src/import/              `pnpm nutrition:import <curated|fdc|ifct>` (csv, classify, fdc, ifct, cli)
  src/search/              food-search.service.ts, foods.controller.ts (/v1/foods, /internal/v1/foods/search)
  src/admin/               /v1/admin/foods, /v1/admin/recipes, content workflow + audit
  src/qa/                  nightly data QA job (worker)
  (later) logs, targets, meal plans, barcode, grocery
packages/domain/src/nutrition/            (@aura/domain/nutrition, TAC-12)
  targets.ts assessment.ts normalise-serving.ts composite-recipe.ts meal-plan.ts adapt-targets.ts
  decimal.ts diet.ts rationale.ts errors.ts types.ts
```

nutrition-service keeps `UserNutritionProfile` (from `ProfileChanged` / `OnboardingCompleted`) and `WeightFact` (from `MeasurementAdded`), so targets, meal plans and adaptation never call another service. Adaptation proposals are emitted as `TargetChangeProposed`; coach-service turns them into user-facing `Recommendation` cards and calls back `/internal/v1/proposals/apply` on accept.

## 2. Targets engine (`calculateTargets`)

All outputs are estimates labelled "≈" with the rationale codes stored in `NutritionTarget.rationale`.

1. **BMR** — Mifflin-St Jeor: male `10w + 6.25h − 5a + 5`; female `10w + 6.25h − 5a − 161` (w kg, h cm, a years).
2. **TDEE** — BMR × activity factor: sedentary 1.2, light 1.375, moderate 1.55, active 1.725, very active 1.9. Planned training is already reflected in the chosen level; we do not add exercise calories on top (avoids double counting).
3. **Goal adjustment**
   - Fat loss: deficit = clamp(bodyweight × weeklyRatePct × 7700 kcal/kg ÷ 7, 250, 750) kcal/day; default rate 0.5%/week, max 1%/week (policy `max_weekly_loss_pct`).
   - Muscle gain: surplus +250 kcal (beginner +350), max 0.5%/week gain.
   - Strength / endurance / general: maintenance (endurance +5% if ≥ 5 sessions/week).
4. **Safety floors** (policy, not overridable by the coach): energy ≥ max(BMR × 1.0, 1200 kcal female / 1500 kcal male). If the floor binds, rationale `FLOOR_APPLIED` and the deficit is reduced. Pregnancy flag → no deficit, maintenance, and a professional-advice notice.
5. **Protein** — g/kg of bodyweight (adjusted bodyweight if BMI ≥ 30: use weight at BMI 27): fat loss 1.6–2.0 (target 1.8), muscle gain 1.6–2.2 (target 1.8), strength 1.6, endurance 1.4, general 1.2. Vegetarian/vegan: same target, meal plan biases to dal, paneer, soy, curd, legumes.
6. **Fat** — 25–30% of energy, minimum 0.6 g/kg.
7. **Carbs** — remainder; minimum 130 g/day unless the user chose low-carb (P2 option).
8. **Fibre** — 14 g per 1000 kcal (min 25 g); **water** — 35 ml/kg, +500 ml per training day.
9. **Micros (selected)** — ICMR-NIN 2020 RDA by age/sex for iron, calcium, B12, vitamin D, sodium upper limit 2000 mg.

### Adaptation (`adaptTargets`, weekly)

Uses a 7-day exponentially-weighted weight trend (α = 0.1) over ≥ 14 days with ≥ 8 weigh-ins and logging adherence ≥ 70% of days.
- Observed rate vs goal rate off by > 0.25%/week for 2 weeks → adjust energy by ±100–150 kcal, never below floor; proposal (`Recommendation`, kind `NUTRITION_TARGET_CHANGE`).
- Low adherence → no target change; coach suggests simpler plan instead.
- Plateau (E5): trend slope ≈ 0 (±0.1%/week) for 3 weeks with adherence ≥ 80% → propose −100 kcal or +2,000 steps/day, user chooses.

## 3. Serving normalisation (`normaliseServing`)

```text
input: foodId, quantity, unitCode, state
1. unit → grams:
   g → q;  kg → q×1000;  ml → q × densityGPerMl (required, else 422 UNIT_NOT_SUPPORTED);
   household unit → FoodUnit(foodId, code).grams × q (else 422)
2. state:
   if state == food.state → use food's nutrients
   if logging RAW but food is COOKED → use food.rawEquivalent nutrients with grams as given
   if logging COOKED but food is RAW → find cooked form (food.cookedForms) and use it;
      else convert grams_raw = grams / yieldFactor and use raw nutrients; confidence − 1 level
3. nutrients = per100 × grams / 100 for each nutrient (Decimal math, round at display only)
4. snapshot nutrients + confidence on the MealEntry
```

Daily totals are the sum of entry snapshots (always grams-normalised), recomputed in the same transaction as each entry change.

## 4. Composite Indian dishes (`compositeRecipe`)

Recipe ingredients in raw grams → sum nutrients → divide by `cookedYieldG` → per-100 g cooked profile → published as `FoodItem(source=CURATED_RECIPE, state=COOKED)` with household units (e.g. katori 150 g, roti 40 g each). Confidence: HIGH if all ingredients HIGH and yield measured, MEDIUM if yield estimated, LOW if any ingredient LOW. Oil is explicit (recipes specify oil grams; restaurant variants carry +30% fat note).

### Curated catalogue (TAC-14)

Curated content lives in `services/nutrition-service/content/nutrition` (inside the service so the image and `turbo --affected` include it), hand-formatted one record per line and validated with Zod in CI (`test/content.test.ts`):

- `ingredients.json`: ~150 ingredients, per 100 g edible portion `[kcal, protein, available carbs, fat, fibre, Na?, Fe?, Ca?]`, local names, aisle category, diet flags, allergens, density for liquids, household units. Source `CURATED_INGREDIENT`, confidence MEDIUM: starter values from IFCT/FDC-style references until a nutritionist checks them against the licensed source.
- `units.json`: katori 150 g, roti 40 g, plate 250 g, glass 250 ml, cup 240 ml, ladle 75 ml, tbsp 15 ml, tsp 5 ml. Volume units become grams through each liquid's density.
- `yield-factors.json`: cooked forms of staples (rice ×2.8, toor dal ×3.0, rajma ×2.4, chicken ×0.75…); cooked values = raw ÷ yield factor, linked by `rawEquivalentId`.
- `recipes/<region>.json`: ≈300 composite dishes across north, south, east, west, northeast and pan-Indian (breakfasts, drinks, Indo-Chinese, fasting, sweets, cafe bowls), with raw ingredient grams including explicit oil, cooked yield, servings, prep/cook time, cost tier, steps, substitutions and serving units. Diets, allergens, `fastingOk` and oil grams are derived by `compositeRecipe`, never hand-tagged.

Everything imports as `IN_REVIEW` with `reviewRequired = "nutrition"`; nothing is visible to users until a nutrition reviewer publishes it (TAC-44 tracks the sign-off).

### Importers

`pnpm nutrition:import <source> [--dry-run] [--verbose]` (needs `DATABASE_URL`; run from a workstation or a one-off job, never at service start):

| Source | Input | New items | Matching key |
|---|---|---|---|
| `curated` | content/nutrition | IN_REVIEW | (CURATED_INGREDIENT \| CURATED_RECIPE, slug); recipes by slug |
| `fdc --dir` | FoodData Central Foundation + SR Legacy, CSV (`food.csv`, `food_nutrient.csv`, optional `food_category.csv`, `food_portion.csv`) or JSON download | PUBLISHED, confidence HIGH | (USDA_FDC, fdc_id) |
| `ifct --file` | IFCT 2017 CSV supplied by the owner (licensed, never committed): `code, name, local_names, ENERC (kJ), PROTCNT, FATCE, CHOAVLDF, FIBTG, FREESUGAR?, NA?, FE?, CA?, VITB12?, VITD?` | PUBLISHED, confidence HIGH | (IFCT_2017, code) |

Every run plans first and prints a diff (`+` create, `~` update, `?` revise, counts); `--dry-run` stops there. Runs are idempotent: an unchanged record is left alone. Drafts and items in review are updated in place; a published curated item is never changed underneath users: the new values wait in `pendingRevision` (`revisionStatus = IN_REVIEW`) for a reviewer. Published reference data (FDC/IFCT) updates in place with `version + 1`, since the source is the authority. Carbohydrate is stored as available carbohydrate (FDC "by difference" minus fibre). Diet flags and allergens of imported foods come from the food group and description (`src/import/classify.ts`), erring towards tagging; reviewers correct them in the admin console. Search caches can serve pre-import results for up to 10 minutes.

## 5. Food search

- `FoodItem.searchText` = `lower(unaccent(name + local names))`, kept by a trigger and indexed with `gin_trgm_ops`. Candidates: substring match or `word_similarity ≥ 0.45` (typos), text-scored in SQL (exact name or local name +1, name prefix +0.5, word prefix +0.25, word similarity, shorter names first). Up to 100 published candidates per normalised query are cached in Redis for 10 minutes; publish and archive bump a generation key that retires every cached query.
- Ranking in the app: curated +0.3, cooked/as-sold +0.15 (people log dishes), confidence HIGH +0.1 / MEDIUM +0.05, the user's foods from the last 30 days +0.5, preferred cuisine +0.15, diet-compatible +0.1. The user's own USER foods are searched live, never cached.
- Exclusion: a food is hidden when its flags meet `DIET_EXCLUSIONS[dietType]` or its allergens meet the user's allergens. `showAll=true` returns them with `warnings: [DIET | ALLERGEN]`. Users without a nutrition profile see everything.
- `POST /internal/v1/foods/search` (coach-service) takes the diet and allergens in the body and never returns excluded foods.
- Benchmark: `test/catalogue.int.test.ts` seeds the curated catalogue and requires p95 < 150 ms for uncached searches through the HTTP stack.
- Barcode: lookup local `FoodItem.barcode` → Open Food Facts API (`/api/v2/product/{code}`) with 2 s timeout → import as `OPEN_FOOD_FACTS` with `confidence=MEDIUM` and status `IN_REVIEW` visible only to the requester until reviewed.

## 6. Meal-plan generator (`generateMealPlan`)

Constraint satisfaction over published recipes:
1. Hard filters: diet type, allergens (recipe allergens derived from ingredients — never trust manual tags), disliked foods, Jain (no root vegetables, onion, garlic), fasting days (only allowed foods tagged `fasting_ok`).
2. Per day: assign recipes to slots so energy within ±7% of target and protein ≥ 90% of target; fibre ≥ 80% preferred.
3. Greedy + local search (swap moves) with variety penalty (same recipe ≤ 2×/week), cost tier preference, prep time ≤ user's limit on weekdays.
4. Servings scaled in 0.5 steps.
5. Output validated again (allergen check is a separate final pass); failure to satisfy → relax variety, then prep time; never relax hard filters. If still unsatisfiable → return partial plan with `UNSATISFIABLE_SLOT` codes and coach suggestions.
6. Grocery list: aggregate raw ingredient grams across plan, round to purchasable units (`FoodUnit` code `pack` where defined), group by aisle category.

Alternatives (C9): `suggestAlternatives(slot, remaining macros, context: eating_out|no_cooking|travel)` ranks ready foods/restaurant-style dishes by macro fit; each suggestion shows confidence.

## 7. API (summary)

| Method | Path |
|---|---|
| GET | /v1/foods?q=&showAll=&limit=&cursor= |
| GET | /v1/foods/{id} |
| GET | /v1/foods/barcode/{code} |
| POST | /v1/foods (user custom food, private) |
| GET | /v1/nutrition/days/{date} (entries + totals + target) |
| POST | /v1/nutrition/entries |
| PATCH / DELETE | /v1/nutrition/entries/{id} |
| POST | /v1/nutrition/water |
| GET | /v1/nutrition/targets/current |
| GET | /v1/meal-plans/{weekStart} · POST /v1/meal-plans (generate) · POST /v1/meal-plans/{id}/items/{itemId}/swap |
| GET | /v1/meal-plans/{id}/grocery-list |
| GET | /v1/recipes/{slug} |
| GET | /v1/nutrition/alternatives?slot=&context= |
| POST | /internal/v1/targets (onboarding, idempotent on onboardingId) |
| GET | /internal/v1/users/{id}/day/{date} · /internal/v1/foods/search (coach tools) |
| POST | /internal/v1/proposals/validate · /apply |
| GET · POST · PATCH | /v1/admin/foods, /v1/admin/foods/{id} (read: any of food:write/review/publish) |
| POST | /v1/admin/foods/{id}/submit (food:write) · /reject (food:review) · /publish · /archive (food:publish) |
| GET · POST · PATCH | /v1/admin/recipes, /v1/admin/recipes/{id}, with the same transitions under recipe:* |

### Admin content workflow (foods and recipes)

DRAFT → IN_REVIEW → PUBLISHED → ARCHIVED (`contentTransition` in `@aura/contracts`). Edits to a published item go to `pendingRevision` with its own `revisionStatus`, so users keep seeing the reviewed values until the revision is published (`version + 1`). Every create, edit and transition writes `AuditEvent@1` in the same transaction; every publish writes `ContentPublished@1` (a recipe publish emits one for the recipe and one for its dish).

Publish validation:

- Food: stated energy within ±15% of 4·protein + 4·available carbs + 9·fat + 2·fibre (foods under 5 kcal both ways pass), a `sourceRef` for IFCT/FDC/OFF foods, confidence set, every unit in grams. Otherwise 422 `ENERGY_MISMATCH` or `PUBLISH_VALIDATION_FAILED`.
- Recipe: every ingredient published (422 `INGREDIENT_NOT_PUBLISHED`), yield set, then the composite dish is regenerated with `compositeRecipe` (allergens, flags, diets, `fastingOk`, oil derived) and must pass the same energy check. The dish is written as `FoodItem(source=CURATED_RECIPE, state=COOKED)` in the same transaction.

## 8. Tests

- Unit: BMR/TDEE golden values; floors; protein with high BMI; unit conversion for every unit type; raw/cooked branches; composite recipe maths; allergen derivation; meal-plan never violates hard filters (property tests over random recipe sets).
- Integration: log → summary consistency (sum of entries equals summary within 0.5 kcal); concurrent logs on the same day (row lock); OFF timeout fallback.
- Data QA: the worker's `DataQaJob` runs nightly at 03:00 IST (Redis lock, one replica) and sets `qaFlags = [ENERGY_MISMATCH]` on every non-archived food whose macro energy (4/4/9 + fibre 2) deviates > 15% from stated energy, clearing it once fixed; `GET /v1/admin/foods?qa=flagged` lists them.
- Catalogue (TAC-14): content validation (Zod, references, every ingredient and recipe composite within ±15%), importer unit tests on FDC/IFCT fixtures, integration tests for dry-run/idempotent imports, search relevance ("dal", "roti", "paneer tikka", "idli"), diet/allergen exclusion, the p95 benchmark, admin workflow, permissions and audit.

## 9. Engine package (`@aura/domain/nutrition`)

Pure functions with no I/O; ESLint forbids `node:*`, Nest, Prisma and other `@aura/*` imports in `packages/domain/src`. Services load data, call the engine, and persist what it returns.

| Function | Section | Notes |
|---|---|---|
| `calculateTargets` | §2 | Fat is 25% of energy (min 0.6 g/kg of reference weight). If carbs fall below 130 g, carbs are set to 130 g and energy becomes the macro sum (`CARB_MIN_APPLIED`), which only ever raises energy. Water is 35 ml/kg, +500 ml on training days. |
| `assess` | onboarding | BMI with Asia-Pacific cut-offs, BMR, TDEE, rate band (fat loss 0.25–1%, gain 0.1–0.5%), cap above the band max, target date range (earliest at band max, latest at band min). |
| `normaliseServing` | §3 | `g`, `kg`, `ml` (needs density) and household units; a RAW food has at most one `cookedForm`. Unknown unit → `UNIT_NOT_SUPPORTED`, missing raw/cooked data → `STATE_NOT_SUPPORTED` (both 422). |
| `compositeRecipe` | §4 | Allergens, diet flags and fasting suitability are derived from ingredients only. Oil grams are reported from ingredients flagged `OIL`. |
| `generateMealPlan`, `groceryList`, `suggestAlternatives` | §6 | Deterministic: greedy fill by slot energy share (breakfast 25%, lunch 35%, snack 10%, dinner 30%), then best-improvement local search over recipe and serving (0.5–3 in 0.5 steps). Relaxation ladder per day: variety, then weekday prep time. A final pass re-checks hard filters. |
| `adaptTargets` | §2 Adaptation | Plateau is evaluated first (fat loss only); otherwise the last two weekly trend rates must both miss the goal rate by > 0.25%/week. Step is 150 kcal if the mean gap is > 0.5%/week, else 100. The EWMA trend lags real change by about 9 days, so the first weeks after a start under-read the rate. |

Decimal maths: all nutrient and gram values are `decimal.js` values; round only for display or when storing a target (`round()`).

ICMR-NIN 2020 micros used (adults): iron 19 mg men / 29 mg women (19 mg women ≥ 50, 27 mg pregnant); calcium 1000 mg (1200 mg at ≥ 50); B12 2.5 µg; vitamin D 15 µg; sodium upper limit 2000 mg. To be confirmed by the reviewing nutritionist (TAC-44).

### Rationale and notice codes

| Code | Meaning |
|---|---|
| `BMR_MIFFLIN_ST_JEOR`, `TDEE_ACTIVITY_FACTOR` | Basis of every energy figure |
| `GOAL_DEFICIT`, `DEFICIT_CLAMPED`, `RATE_CAPPED` | Fat-loss deficit; clamp to 250–750 kcal; requested rate above 1%/week capped |
| `GOAL_SURPLUS`, `GOAL_SURPLUS_BEGINNER` | +250 / +350 kcal |
| `GOAL_MAINTENANCE`, `ENDURANCE_VOLUME_BONUS` | Maintenance; +5% for ≥ 5 endurance sessions/week |
| `FLOOR_APPLIED` | Energy raised to max(BMR, 1200 F / 1500 M); also used when an adaptation stops at the floor |
| `PREGNANCY_MAINTENANCE` | No deficit or surplus during pregnancy |
| `PROTEIN_ADJUSTED_WEIGHT` | BMI ≥ 30: protein from weight at BMI 27 |
| `FAT_MIN_APPLIED`, `CARB_MIN_APPLIED`, `LOW_CARB_CHOSEN`, `FIBRE_MIN_APPLIED` | Macro minimums |
| `MICROS_ICMR_NIN_2020` | Micronutrient source |
| `BMI_ASIA_PACIFIC_CUTOFFS` | BMI category basis |
| `STATE_AS_CATALOGUED`, `RAW_EQUIVALENT_USED`, `COOKED_FORM_USED`, `YIELD_CONVERSION` | Serving normalisation branch (yield conversion lowers confidence one level) |
| `YIELD_ESTIMATED`, `LOW_CONFIDENCE_INGREDIENT`, `RESTAURANT_FAT_NOTE` | Composite recipe confidence and notes |
| `RELAXED_VARIETY`, `RELAXED_PREP_TIME` | Meal-plan relaxations used |
| `UNSATISFIABLE_SLOT`, `DAY_TARGET_NOT_MET` | Meal-plan issues (partial plan returned) |
| `INSUFFICIENT_DATA`, `LOW_ADHERENCE`, `ON_TRACK` | Adaptation made no change |
| `TREND_ABOVE_GOAL_RATE`, `TREND_BELOW_GOAL_RATE` | Weight trend above (lose slower / gain faster) or below the goal rate |
| `FLOOR_REACHED` | A reduction was blocked by the floor |
| `PLATEAU` | 3-week plateau; user chooses −100 kcal or +2,000 steps/day |

Notices: `ESTIMATE` (show "≈"), `PROFESSIONAL_ADVICE_PREGNANCY`, `BMI_POPULATION_CAVEAT`.
