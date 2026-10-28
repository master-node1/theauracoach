-- TAC-14 food catalogue: provenance, workflow revisions, data QA and trigram search.

-- AlterEnum
ALTER TYPE "FoodSource" ADD VALUE 'CURATED_INGREDIENT';

-- AlterTable
ALTER TABLE "FoodItem" ADD COLUMN     "category" VARCHAR(30),
ADD COLUMN     "flags" TEXT[],
ADD COLUMN     "pendingRevision" JSONB,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "publishedById" UUID,
ADD COLUMN     "qaCheckedAt" TIMESTAMP(3),
ADD COLUMN     "qaFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "reviewRequired" VARCHAR(20),
ADD COLUMN     "revisionStatus" "ContentStatus",
ADD COLUMN     "searchText" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "fastingOk" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "flags" TEXT[],
ADD COLUMN     "localNames" TEXT[],
ADD COLUMN     "mealSlots" TEXT[],
ADD COLUMN     "oilG" DECIMAL(6,1) NOT NULL DEFAULT 0,
ADD COLUMN     "pendingRevision" JSONB,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "publishedById" UUID,
ADD COLUMN     "region" VARCHAR(20),
ADD COLUMN     "restaurantStyle" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewRequired" VARCHAR(20),
ADD COLUMN     "revisionStatus" "ContentStatus",
ADD COLUMN     "units" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "yieldMeasured" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "FoodItem_slug_key" ON "FoodItem"("slug");

-- CreateIndex
CREATE INDEX "FoodItem_searchText_trgm_idx" ON "FoodItem" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "FoodItem_source_sourceRef_key" ON "FoodItem"("source", "sourceRef");


-- Search text: lower(unaccent(name and local names)). unaccent() is only STABLE, so wrap it with the
-- dictionary named explicitly to get an IMMUTABLE function the trigger and queries share.
CREATE OR REPLACE FUNCTION aura_search_norm(input TEXT) RETURNS TEXT
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, input)) $$;

CREATE OR REPLACE FUNCTION aura_food_search_text() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchText" := aura_search_norm(
    NEW."name" || ' ' || coalesce(array_to_string(NEW."localNames", ' '), ''));
  RETURN NEW;
END $$;

CREATE TRIGGER "FoodItem_searchText"
  BEFORE INSERT OR UPDATE OF "name", "localNames" ON "FoodItem"
  FOR EACH ROW EXECUTE FUNCTION aura_food_search_text();

UPDATE "FoodItem" SET "name" = "name";

-- Reference data the catalogue points at. Codes map to @aura/domain NutrientKey in src/catalogue/nutrients.ts.
INSERT INTO "Nutrient" ("code", "name", "unit", "isMacro") VALUES
  ('energy_kcal', 'Energy', 'kcal', true),
  ('protein_g', 'Protein', 'g', true),
  ('carb_g', 'Available carbohydrate', 'g', true),
  ('fat_g', 'Total fat', 'g', true),
  ('fibre_g', 'Dietary fibre', 'g', true),
  ('sugar_g', 'Total sugars', 'g', false),
  ('sodium_mg', 'Sodium', 'mg', false),
  ('iron_mg', 'Iron', 'mg', false),
  ('calcium_mg', 'Calcium', 'mg', false),
  ('vitamin_b12_ug', 'Vitamin B12', 'µg', false),
  ('vitamin_d_ug', 'Vitamin D', 'µg', false)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "Allergen" ("code", "name") VALUES
  ('peanut', 'Peanut'),
  ('tree_nut', 'Tree nuts'),
  ('milk', 'Milk'),
  ('egg', 'Egg'),
  ('gluten', 'Gluten'),
  ('soy', 'Soy'),
  ('fish', 'Fish'),
  ('shellfish', 'Shellfish'),
  ('sesame', 'Sesame'),
  ('mustard', 'Mustard')
ON CONFLICT ("code") DO NOTHING;
