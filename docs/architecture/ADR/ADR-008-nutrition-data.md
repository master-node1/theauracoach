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
