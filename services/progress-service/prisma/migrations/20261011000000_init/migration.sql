-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('APPLE_HEALTH', 'HEALTH_CONNECT');

-- CreateEnum
CREATE TYPE "MeasurementType" AS ENUM ('WEIGHT_KG', 'WAIST_CM', 'CHEST_CM', 'HIPS_CM', 'ARM_CM', 'THIGH_CM', 'NECK_CM', 'BODY_FAT_PCT');

-- CreateTable
CREATE TABLE "BodyMeasurement" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "MeasurementType" NOT NULL,
    "value" DECIMAL(6,2) NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "clientId" UUID,

    CONSTRAINT "BodyMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCheckIn" (
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "sleepHours" DECIMAL(3,1),
    "sleepQuality" INTEGER,
    "energy" INTEGER,
    "soreness" INTEGER,
    "mood" INTEGER,
    "steps" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyCheckIn_pkey" PRIMARY KEY ("userId","date")
);

-- CreateTable
CREATE TABLE "DeviceIntegration" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "scopes" TEXT[],
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutDayFact" (
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "planned" INTEGER NOT NULL DEFAULT 0,
    "completed" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "missed" INTEGER NOT NULL DEFAULT 0,
    "volumeKg" DECIMAL(10,1) NOT NULL DEFAULT 0,
    "sessionIds" UUID[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutDayFact_pkey" PRIMARY KEY ("userId","date")
);

-- CreateTable
CREATE TABLE "NutritionDayFact" (
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "totals" JSONB NOT NULL,
    "target" JSONB,
    "entryCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NutritionDayFact_pkey" PRIMARY KEY ("userId","date")
);

-- CreateTable
CREATE TABLE "ExerciseBestFact" (
    "userId" UUID NOT NULL,
    "exerciseId" UUID NOT NULL,
    "exerciseName" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "e1rmKg" DECIMAL(6,2),
    "bestLoadKg" DECIMAL(6,2),
    "bestReps" INTEGER,

    CONSTRAINT "ExerciseBestFact_pkey" PRIMARY KEY ("userId","exerciseId","date")
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
CREATE INDEX "BodyMeasurement_userId_type_measuredAt_idx" ON "BodyMeasurement"("userId", "type", "measuredAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "BodyMeasurement_userId_clientId_key" ON "BodyMeasurement"("userId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceIntegration_userId_provider_key" ON "DeviceIntegration"("userId", "provider");

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_createdAt_idx" ON "OutboxEvent"("publishedAt", "createdAt");

