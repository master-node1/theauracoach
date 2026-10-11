-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ExperienceLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "GoalType" AS ENUM ('FAT_LOSS', 'MUSCLE_GAIN', 'STRENGTH', 'ENDURANCE', 'GENERAL_FITNESS');

-- CreateEnum
CREATE TYPE "IntensityCap" AS ENUM ('STANDARD', 'LOW');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('VIDEO', 'IMAGE', 'ANIMATION');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'PARTIAL', 'MISSED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('FEMALE', 'MALE');

-- CreateEnum
CREATE TYPE "TrainingLocation" AS ENUM ('GYM', 'HOME', 'OUTDOOR');

-- CreateEnum
CREATE TYPE "WeekKind" AS ENUM ('NORMAL', 'DELOAD');

-- CreateTable
CREATE TABLE "Equipment" (
    "code" VARCHAR(40) NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "UserEquipment" (
    "userId" UUID NOT NULL,
    "equipmentCode" VARCHAR(40) NOT NULL,
    "maxLoadKg" DECIMAL(5,1),
    "incrementKg" DECIMAL(4,2),

    CONSTRAINT "UserEquipment_pkey" PRIMARY KEY ("userId","equipmentCode")
);

-- CreateTable
CREATE TABLE "MuscleGroup" (
    "code" VARCHAR(30) NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "MuscleGroup_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "movementPattern" VARCHAR(30) NOT NULL,
    "mechanics" VARCHAR(10) NOT NULL,
    "difficulty" "ExperienceLevel" NOT NULL,
    "isBodyweight" BOOLEAN NOT NULL DEFAULT false,
    "instructions" TEXT[],
    "commonMistakes" TEXT[],
    "cues" TEXT[],
    "contraindications" TEXT[],
    "regressionId" UUID,
    "progressionId" UUID,
    "defaultRestSec" INTEGER NOT NULL DEFAULT 90,
    "metValue" DECIMAL(4,1),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseMuscle" (
    "exerciseId" UUID NOT NULL,
    "muscleCode" VARCHAR(30) NOT NULL,
    "role" VARCHAR(10) NOT NULL,

    CONSTRAINT "ExerciseMuscle_pkey" PRIMARY KEY ("exerciseId","muscleCode")
);

-- CreateTable
CREATE TABLE "ExerciseEquipment" (
    "exerciseId" UUID NOT NULL,
    "equipmentCode" VARCHAR(40) NOT NULL,

    CONSTRAINT "ExerciseEquipment_pkey" PRIMARY KEY ("exerciseId","equipmentCode")
);

-- CreateTable
CREATE TABLE "ExerciseMedia" (
    "id" UUID NOT NULL,
    "exerciseId" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "captionsKey" TEXT,
    "altText" TEXT NOT NULL,
    "durationSec" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ExerciseMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutTemplate" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "goal" "GoalType" NOT NULL,
    "experience" "ExperienceLevel" NOT NULL,
    "daysPerWeek" INTEGER NOT NULL,
    "location" "TrainingLocation" NOT NULL,
    "split" VARCHAR(30) NOT NULL,
    "days" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutTemplateExercise" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "dayIndex" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "exerciseId" UUID NOT NULL,
    "sets" INTEGER NOT NULL,
    "repMin" INTEGER NOT NULL,
    "repMax" INTEGER NOT NULL,
    "targetRpe" DECIMAL(3,1) NOT NULL,
    "restSec" INTEGER NOT NULL,

    CONSTRAINT "WorkoutTemplateExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutPlan" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "templateId" UUID,
    "goalId" UUID,
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "engineVersion" VARCHAR(20) NOT NULL,
    "startDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkoutPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutPlanWeek" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "weekStart" DATE NOT NULL,
    "weekIndex" INTEGER NOT NULL,
    "kind" "WeekKind" NOT NULL DEFAULT 'NORMAL',
    "rationale" JSONB NOT NULL,

    CONSTRAINT "WorkoutPlanWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "planWeekId" UUID,
    "name" TEXT NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'PLANNED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "perceivedDifficulty" INTEGER,
    "soreness" INTEGER,
    "notes" VARCHAR(500),
    "clientId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannedExercise" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "exerciseId" UUID NOT NULL,
    "sets" INTEGER NOT NULL,
    "repMin" INTEGER NOT NULL,
    "repMax" INTEGER NOT NULL,
    "targetLoadKg" DECIMAL(6,2),
    "targetRpe" DECIMAL(3,1) NOT NULL,
    "restSec" INTEGER NOT NULL,
    "substitutedFromId" UUID,
    "progressionNote" TEXT,

    CONSTRAINT "PlannedExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutSet" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "exerciseId" UUID NOT NULL,
    "setNumber" INTEGER NOT NULL,
    "reps" INTEGER,
    "loadKg" DECIMAL(6,2),
    "durationSec" INTEGER,
    "distanceM" INTEGER,
    "rpe" DECIMAL(3,1),
    "isWarmup" BOOLEAN NOT NULL DEFAULT false,
    "painReported" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" UUID,

    CONSTRAINT "WorkoutSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalRecord" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "exerciseId" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "value" DECIMAL(8,2) NOT NULL,
    "setId" UUID NOT NULL,
    "achievedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTrainingProfile" (
    "userId" UUID NOT NULL,
    "sex" "Sex" NOT NULL,
    "birthYear" INTEGER NOT NULL,
    "experience" "ExperienceLevel" NOT NULL,
    "location" "TrainingLocation" NOT NULL,
    "trainingDays" INTEGER[],
    "sessionMinutes" INTEGER NOT NULL,
    "intensityCap" "IntensityCap" NOT NULL,
    "conditions" JSONB NOT NULL,
    "timezone" TEXT NOT NULL,
    "goalType" "GoalType" NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTrainingProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "RecoverySignal" (
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "sleepHours" DECIMAL(3,1),
    "energy" INTEGER,
    "soreness" INTEGER,

    CONSTRAINT "RecoverySignal_pkey" PRIMARY KEY ("userId","date")
);

-- CreateTable
CREATE TABLE "WorkoutPolicy" (
    "key" VARCHAR(40) NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutPolicy_pkey" PRIMARY KEY ("key")
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
CREATE UNIQUE INDEX "Exercise_slug_key" ON "Exercise"("slug");

-- CreateIndex
CREATE INDEX "Exercise_status_movementPattern_idx" ON "Exercise"("status", "movementPattern");

-- CreateIndex
CREATE INDEX "ExerciseMuscle_muscleCode_role_idx" ON "ExerciseMuscle"("muscleCode", "role");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutTemplate_slug_key" ON "WorkoutTemplate"("slug");

-- CreateIndex
CREATE INDEX "WorkoutTemplate_status_goal_experience_daysPerWeek_location_idx" ON "WorkoutTemplate"("status", "goal", "experience", "daysPerWeek", "location");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutTemplateExercise_templateId_dayIndex_order_key" ON "WorkoutTemplateExercise"("templateId", "dayIndex", "order");

-- CreateIndex
CREATE INDEX "WorkoutPlan_userId_status_idx" ON "WorkoutPlan"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutPlanWeek_planId_weekStart_key" ON "WorkoutPlanWeek"("planId", "weekStart");

-- CreateIndex
CREATE INDEX "WorkoutSession_userId_scheduledDate_idx" ON "WorkoutSession"("userId", "scheduledDate");

-- CreateIndex
CREATE INDEX "WorkoutSession_userId_status_scheduledDate_idx" ON "WorkoutSession"("userId", "status", "scheduledDate");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutSession_userId_clientId_key" ON "WorkoutSession"("userId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "PlannedExercise_sessionId_order_key" ON "PlannedExercise"("sessionId", "order");

-- CreateIndex
CREATE INDEX "WorkoutSet_exerciseId_completedAt_idx" ON "WorkoutSet"("exerciseId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutSet_sessionId_exerciseId_setNumber_key" ON "WorkoutSet"("sessionId", "exerciseId", "setNumber");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutSet_sessionId_clientId_key" ON "WorkoutSet"("sessionId", "clientId");

-- CreateIndex
CREATE INDEX "PersonalRecord_userId_exerciseId_kind_idx" ON "PersonalRecord"("userId", "exerciseId", "kind");

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_createdAt_idx" ON "OutboxEvent"("publishedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "UserEquipment" ADD CONSTRAINT "UserEquipment_equipmentCode_fkey" FOREIGN KEY ("equipmentCode") REFERENCES "Equipment"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_regressionId_fkey" FOREIGN KEY ("regressionId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_progressionId_fkey" FOREIGN KEY ("progressionId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseMuscle" ADD CONSTRAINT "ExerciseMuscle_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseMuscle" ADD CONSTRAINT "ExerciseMuscle_muscleCode_fkey" FOREIGN KEY ("muscleCode") REFERENCES "MuscleGroup"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseEquipment" ADD CONSTRAINT "ExerciseEquipment_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseEquipment" ADD CONSTRAINT "ExerciseEquipment_equipmentCode_fkey" FOREIGN KEY ("equipmentCode") REFERENCES "Equipment"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseMedia" ADD CONSTRAINT "ExerciseMedia_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutTemplateExercise" ADD CONSTRAINT "WorkoutTemplateExercise_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkoutTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutTemplateExercise" ADD CONSTRAINT "WorkoutTemplateExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutPlan" ADD CONSTRAINT "WorkoutPlan_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkoutTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutPlanWeek" ADD CONSTRAINT "WorkoutPlanWeek_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WorkoutPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSession" ADD CONSTRAINT "WorkoutSession_planWeekId_fkey" FOREIGN KEY ("planWeekId") REFERENCES "WorkoutPlanWeek"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedExercise" ADD CONSTRAINT "PlannedExercise_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedExercise" ADD CONSTRAINT "PlannedExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSet" ADD CONSTRAINT "WorkoutSet_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSet" ADD CONSTRAINT "WorkoutSet_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalRecord" ADD CONSTRAINT "PersonalRecord_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

