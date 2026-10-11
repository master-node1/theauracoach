-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('SEDENTARY', 'LIGHT', 'MODERATE', 'ACTIVE', 'VERY_ACTIVE');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DietType" AS ENUM ('VEGETARIAN', 'EGGETARIAN', 'NON_VEGETARIAN', 'VEGAN', 'JAIN', 'PESCATARIAN');

-- CreateEnum
CREATE TYPE "FoodSource" AS ENUM ('IFCT_2017', 'USDA_FDC', 'OPEN_FOOD_FACTS', 'CURATED_RECIPE', 'USER');

-- CreateEnum
CREATE TYPE "FoodState" AS ENUM ('RAW', 'COOKED', 'AS_SOLD');

-- CreateEnum
CREATE TYPE "GoalType" AS ENUM ('FAT_LOSS', 'MUSCLE_GAIN', 'STRENGTH', 'ENDURANCE', 'GENERAL_FITNESS');

-- CreateEnum
CREATE TYPE "MealSlot" AS ENUM ('BREAKFAST', 'MORNING_SNACK', 'LUNCH', 'EVENING_SNACK', 'DINNER', 'OTHER');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('FEMALE', 'MALE');

-- CreateTable
CREATE TABLE "Nutrient" (
    "code" VARCHAR(20) NOT NULL,
    "name" TEXT NOT NULL,
    "unit" VARCHAR(10) NOT NULL,
    "isMacro" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Nutrient_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Allergen" (
    "code" VARCHAR(30) NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Allergen_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "FoodItem" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "localNames" TEXT[],
    "brand" TEXT,
    "barcode" TEXT,
    "source" "FoodSource" NOT NULL,
    "sourceRef" TEXT,
    "confidence" "Confidence" NOT NULL,
    "state" "FoodState" NOT NULL,
    "rawEquivalentId" UUID,
    "yieldFactor" DECIMAL(4,3),
    "densityGPerMl" DECIMAL(5,3),
    "dietTags" TEXT[],
    "allergens" TEXT[],
    "cuisine" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdById" UUID,
    "recipeId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoodItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodNutrient" (
    "foodId" UUID NOT NULL,
    "nutrientCode" VARCHAR(20) NOT NULL,
    "per100" DECIMAL(10,3) NOT NULL,

    CONSTRAINT "FoodNutrient_pkey" PRIMARY KEY ("foodId","nutrientCode")
);

-- CreateTable
CREATE TABLE "FoodUnit" (
    "id" UUID NOT NULL,
    "foodId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "label" TEXT NOT NULL,
    "grams" DECIMAL(7,2) NOT NULL,

    CONSTRAINT "FoodUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "cuisine" TEXT,
    "dietTags" TEXT[],
    "allergens" TEXT[],
    "servings" INTEGER NOT NULL,
    "cookedYieldG" DECIMAL(7,1) NOT NULL,
    "prepMinutes" INTEGER NOT NULL,
    "cookMinutes" INTEGER NOT NULL,
    "costTier" INTEGER NOT NULL DEFAULT 2,
    "steps" TEXT[],
    "substitutions" JSONB NOT NULL,
    "imageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeIngredient" (
    "id" UUID NOT NULL,
    "recipeId" UUID NOT NULL,
    "foodId" UUID NOT NULL,
    "grams" DECIMAL(7,1) NOT NULL,
    "note" TEXT,
    "order" INTEGER NOT NULL,

    CONSTRAINT "RecipeIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NutritionTarget" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "energyKcal" INTEGER NOT NULL,
    "proteinG" INTEGER NOT NULL,
    "carbG" INTEGER NOT NULL,
    "fatG" INTEGER NOT NULL,
    "fibreG" INTEGER NOT NULL,
    "waterMl" INTEGER NOT NULL,
    "micros" JSONB NOT NULL,
    "engineVersion" VARCHAR(20) NOT NULL,
    "rationale" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NutritionTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealPlan" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "weekStart" DATE NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "engineVersion" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MealPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealPlanItem" (
    "id" UUID NOT NULL,
    "mealPlanId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "slot" "MealSlot" NOT NULL,
    "recipeId" UUID NOT NULL,
    "servings" DECIMAL(4,2) NOT NULL,

    CONSTRAINT "MealPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealEntry" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "slot" "MealSlot" NOT NULL,
    "foodId" UUID,
    "manualName" VARCHAR(120),
    "quantity" DECIMAL(8,2) NOT NULL,
    "unitCode" VARCHAR(20) NOT NULL,
    "grams" DECIMAL(8,2) NOT NULL,
    "state" "FoodState" NOT NULL,
    "nutrients" JSONB NOT NULL,
    "confidence" "Confidence" NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "clientId" UUID,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MealEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaterEntry" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "ml" INTEGER NOT NULL,
    "clientId" UUID,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaterEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyNutritionSummary" (
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "totals" JSONB NOT NULL,
    "waterMl" INTEGER NOT NULL,
    "targetId" UUID,
    "entryCount" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyNutritionSummary_pkey" PRIMARY KEY ("userId","date")
);

-- CreateTable
CREATE TABLE "UserNutritionProfile" (
    "userId" UUID NOT NULL,
    "sex" "Sex" NOT NULL,
    "birthYear" INTEGER NOT NULL,
    "heightCm" DECIMAL(5,1) NOT NULL,
    "activityLevel" "ActivityLevel" NOT NULL,
    "dietType" "DietType" NOT NULL,
    "allergens" TEXT[],
    "cuisines" TEXT[],
    "dislikedFoodIds" UUID[],
    "fastingDays" INTEGER[],
    "goalType" "GoalType" NOT NULL,
    "weeklyRatePct" DECIMAL(4,2),
    "pregnancy" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNutritionProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "WeightFact" (
    "userId" UUID NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "weightKg" DECIMAL(5,1) NOT NULL,

    CONSTRAINT "WeightFact_pkey" PRIMARY KEY ("userId","measuredAt")
);

-- CreateTable
CREATE TABLE "NutritionPolicy" (
    "key" VARCHAR(40) NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NutritionPolicy_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "userId" UUID,
    "payload" JSONB NOT NULL,
    "traceparent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedEvent" (
    "eventId" TEXT NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE UNIQUE INDEX "FoodItem_barcode_key" ON "FoodItem"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "FoodItem_recipeId_key" ON "FoodItem"("recipeId");

-- CreateIndex
CREATE INDEX "FoodItem_status_source_idx" ON "FoodItem"("status", "source");

-- CreateIndex
CREATE INDEX "FoodItem_createdById_idx" ON "FoodItem"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "FoodUnit_foodId_code_key" ON "FoodUnit"("foodId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_slug_key" ON "Recipe"("slug");

-- CreateIndex
CREATE INDEX "Recipe_status_cuisine_idx" ON "Recipe"("status", "cuisine");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeIngredient_recipeId_order_key" ON "RecipeIngredient"("recipeId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "NutritionTarget_userId_effectiveFrom_key" ON "NutritionTarget"("userId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "MealPlan_userId_weekStart_idx" ON "MealPlan"("userId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "MealPlanItem_mealPlanId_date_slot_recipeId_key" ON "MealPlanItem"("mealPlanId", "date", "slot", "recipeId");

-- CreateIndex
CREATE INDEX "MealEntry_userId_date_idx" ON "MealEntry"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MealEntry_userId_clientId_key" ON "MealEntry"("userId", "clientId");

-- CreateIndex
CREATE INDEX "WaterEntry_userId_date_idx" ON "WaterEntry"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "WaterEntry_userId_clientId_key" ON "WaterEntry"("userId", "clientId");

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_createdAt_idx" ON "OutboxEvent"("publishedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "FoodItem" ADD CONSTRAINT "FoodItem_rawEquivalentId_fkey" FOREIGN KEY ("rawEquivalentId") REFERENCES "FoodItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodItem" ADD CONSTRAINT "FoodItem_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodNutrient" ADD CONSTRAINT "FoodNutrient_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "FoodItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodNutrient" ADD CONSTRAINT "FoodNutrient_nutrientCode_fkey" FOREIGN KEY ("nutrientCode") REFERENCES "Nutrient"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodUnit" ADD CONSTRAINT "FoodUnit_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "FoodItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "FoodItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlanItem" ADD CONSTRAINT "MealPlanItem_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlanItem" ADD CONSTRAINT "MealPlanItem_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealEntry" ADD CONSTRAINT "MealEntry_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "FoodItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

