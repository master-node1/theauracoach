# ADR-008: Curated nutrition dataset with provenance and confidence

Status: Proposed · 2026-10-11

## Context
Accurate Indian food data is the core differentiator. LLM-generated nutrient values are not acceptable.

## Options Considered
Licensed commercial API (e.g. Nutritionix, Edamam); open datasets curated in-house; crowd-sourced only.

## Decision
Curated in-house dataset seeded from IFCT 2017 (ICMR-NIN, Indian raw foods), USDA FoodData Central (public domain), Open Food Facts (ODbL, packaged foods/barcodes, attribution required). Indian cooked dishes are **composite recipes** computed from IFCT ingredients with yield (cooking) factors, reviewed by a nutrition reviewer. Every `FoodItem` stores `source`, `sourceRef`, `confidence` (high/medium/low), `state` (raw/cooked/as-sold) and household units with gram weights. User-created foods are private until reviewed.

## Consequences
+ Explainable values, consistent units, legal clarity.
− Curation effort: plan ~800 Indian dishes for MVP, built by reviewers with admin tooling.
− ODbL share-alike applies to derived Open Food Facts database; we keep OFF-derived records in a separate table/flag and publish attributions.

## Alternatives Rejected
Commercial API only (cost, weak Indian regional coverage, opaque provenance); crowd-sourced only (quality).

## Implementation notes (TAC-14, 2026-10-28)

- Provenance values in use: `IFCT_2017`, `USDA_FDC`, `OPEN_FOOD_FACTS`, `CURATED_RECIPE` (composite dishes) and `CURATED_INGREDIENT`, added for the content team's starter ingredient values. The build environment could not reach FDC or a licensed IFCT file, so the ~150 starter ingredients carry IFCT/FDC-style values at confidence MEDIUM and stay `IN_REVIEW` until a nutritionist verifies them against the licensed source; re-importing IFCT then supersedes them ingredient by ingredient.
- Composite dishes: ≈300 recipes ship in the repo (`services/nutrition-service/content/nutrition`), short of the ~800 MVP target; reviewers grow the set through `/v1/admin/recipes`. Composite values come from `@aura/domain/nutrition` `compositeRecipe`; yields are estimated (`yieldMeasured = false`, confidence at most MEDIUM) until kitchen-tested.
- IFCT is licensed: the importer reads an owner-supplied CSV and the file is never committed. FDC (public domain) imports as published, confidence HIGH.
- Carbohydrate is stored as available carbohydrate (excluding fibre) for every source, so the energy check is 4·P + 4·C + 9·F + 2·fibre.
- Open Food Facts records are still to come (barcode work); they will keep their own `source` for ODbL attribution.
