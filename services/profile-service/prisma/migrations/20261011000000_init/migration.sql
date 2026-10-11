-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('SEDENTARY', 'LIGHT', 'MODERATE', 'ACTIVE', 'VERY_ACTIVE');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('CORE_SERVICE', 'AI_COACH', 'NOTIFICATIONS', 'MARKETING', 'PROGRESS_PHOTOS', 'HEALTH_INTEGRATIONS');

-- CreateEnum
CREATE TYPE "DietType" AS ENUM ('VEGETARIAN', 'EGGETARIAN', 'NON_VEGETARIAN', 'VEGAN', 'JAIN', 'PESCATARIAN');

-- CreateEnum
CREATE TYPE "ExperienceLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'ABANDONED', 'REPLACED');

-- CreateEnum
CREATE TYPE "GoalType" AS ENUM ('FAT_LOSS', 'MUSCLE_GAIN', 'STRENGTH', 'ENDURANCE', 'GENERAL_FITNESS');

-- CreateEnum
CREATE TYPE "IntensityCap" AS ENUM ('STANDARD', 'LOW');

-- CreateEnum
CREATE TYPE "OnboardingState" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'PLANNING', 'READY');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('FEMALE', 'MALE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TrainingLocation" AS ENUM ('GYM', 'HOME', 'OUTDOOR');

-- CreateEnum
CREATE TYPE "UnitSystem" AS ENUM ('METRIC', 'IMPERIAL');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'PENDING_DELETION', 'DELETED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "cognitoSub" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "displayName" VARCHAR(60),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "deletionDueAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActiveAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "userId" UUID NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "sex" "Sex" NOT NULL,
    "heightCm" DECIMAL(5,1) NOT NULL,
    "activityLevel" "ActivityLevel" NOT NULL,
    "experience" "ExperienceLevel" NOT NULL,
    "unitSystem" "UnitSystem" NOT NULL DEFAULT 'METRIC',
    "dietType" "DietType" NOT NULL,
    "cuisines" TEXT[],
    "allergens" TEXT[],
    "dislikedFoodIds" UUID[],
    "fastingDays" INTEGER[],
    "trainingDays" INTEGER[],
    "sessionMinutes" INTEGER NOT NULL DEFAULT 45,
    "location" "TrainingLocation" NOT NULL,
    "equipmentCodes" TEXT[],
    "intensityCap" "IntensityCap" NOT NULL DEFAULT 'STANDARD',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "userId" UUID NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "coachTone" TEXT NOT NULL DEFAULT 'supportive',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" VARCHAR(40) NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" UUID NOT NULL,
    "roleId" VARCHAR(40) NOT NULL,
    "grantedBy" UUID,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "policyVersion" VARCHAR(20) NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRequest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "artifactKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DataRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FitnessGoal" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "GoalType" NOT NULL,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "targetWeightKg" DECIMAL(5,1),
    "weeklyRatePct" DECIMAL(4,2),
    "targetDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "FitnessGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyScreening" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "answers" JSONB NOT NULL,
    "freeTextEnc" BYTEA,
    "flags" TEXT[],
    "intensityCap" "IntensityCap" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyScreening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthCondition" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "severity" VARCHAR(10) NOT NULL,
    "notesEnc" BYTEA,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "HealthCondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FitnessAssessment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "weightKg" DECIMAL(5,1) NOT NULL,
    "bmi" DECIMAL(4,1) NOT NULL,
    "bmrKcal" INTEGER NOT NULL,
    "tdeeKcal" INTEGER NOT NULL,
    "engineVersion" VARCHAR(20) NOT NULL,
    "inputs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FitnessAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "plan" VARCHAR(30) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "externalRef" TEXT NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Onboarding" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "OnboardingState" NOT NULL DEFAULT 'NOT_STARTED',
    "questionnaireVer" TEXT NOT NULL,
    "planId" UUID,
    "targetId" UUID,
    "completedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Onboarding_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "User_cognitoSub_key" ON "User"("cognitoSub");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_status_deletionDueAt_idx" ON "User"("status", "deletionDueAt");

-- CreateIndex
CREATE INDEX "Consent_userId_purpose_createdAt_idx" ON "Consent"("userId", "purpose", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "DataRequest_userId_createdAt_idx" ON "DataRequest"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "FitnessGoal_userId_status_idx" ON "FitnessGoal"("userId", "status");

-- CreateIndex
CREATE INDEX "SafetyScreening_userId_createdAt_idx" ON "SafetyScreening"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "HealthCondition_userId_active_idx" ON "HealthCondition"("userId", "active");

-- CreateIndex
CREATE INDEX "FitnessAssessment_userId_createdAt_idx" ON "FitnessAssessment"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Subscription_userId_status_idx" ON "Subscription"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_provider_externalRef_key" ON "Subscription"("provider", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "Onboarding_userId_key" ON "Onboarding"("userId");

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_createdAt_idx" ON "OutboxEvent"("publishedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataRequest" ADD CONSTRAINT "DataRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitnessGoal" ADD CONSTRAINT "FitnessGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyScreening" ADD CONSTRAINT "SafetyScreening_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthCondition" ADD CONSTRAINT "HealthCondition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitnessAssessment" ADD CONSTRAINT "FitnessAssessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Onboarding" ADD CONSTRAINT "Onboarding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

