-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM_NOTICE');

-- CreateEnum
CREATE TYPE "RecommendationKind" AS ENUM ('WORKOUT_SWAP', 'WORKOUT_RESCHEDULE', 'PLAN_ADJUSTMENT', 'NUTRITION_TARGET_CHANGE', 'MEAL_SWAP', 'GENERAL_TIP');

-- CreateEnum
CREATE TYPE "RecommendationSource" AS ENUM ('ENGINE', 'COACH');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'INVALIDATED');

-- CreateTable
CREATE TABLE "CoachConversation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(80),
    "summary" TEXT,
    "safetyFlag" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachMessage" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "safety" JSONB,
    "aiRequestId" UUID,
    "promptVersion" VARCHAR(40),
    "clientId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "RecommendationKind" NOT NULL,
    "source" "RecommendationSource" NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "title" VARCHAR(120) NOT NULL,
    "explanation" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "basisVersion" TEXT NOT NULL,
    "messageId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachMemory" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "value" VARCHAR(280) NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceMessageId" UUID,

    CONSTRAINT "CoachMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFeedback" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "messageId" UUID,
    "targetType" VARCHAR(30) NOT NULL,
    "targetId" UUID,
    "rating" INTEGER,
    "reason" VARCHAR(40),
    "comment" VARCHAR(1000),
    "reviewStatus" VARCHAR(20) NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyReview" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "reviewerId" UUID,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SafetyReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPromptVersion" (
    "id" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "template" TEXT NOT NULL,
    "outputSchema" JSONB,
    "evalScore" JSONB,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "AiPromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiModelConfig" (
    "feature" VARCHAR(40) NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "model" VARCHAR(60) NOT NULL,
    "effort" VARCHAR(10) NOT NULL,
    "maxTokens" INTEGER NOT NULL,
    "timeoutMs" INTEGER NOT NULL,
    "dailyUserQuota" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModelConfig_pkey" PRIMARY KEY ("feature")
);

-- CreateTable
CREATE TABLE "CoachingPolicy" (
    "key" VARCHAR(40) NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachingPolicy_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "feature" VARCHAR(40) NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "model" VARCHAR(60) NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" BIGINT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "outcome" VARCHAR(20) NOT NULL,
    "requestId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserConsentState" (
    "userId" UUID NOT NULL,
    "aiCoach" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserConsentState_pkey" PRIMARY KEY ("userId")
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
CREATE INDEX "CoachConversation_userId_lastMessageAt_idx" ON "CoachConversation"("userId", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "CoachMessage_conversationId_createdAt_idx" ON "CoachMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoachMessage_conversationId_clientId_key" ON "CoachMessage"("conversationId", "clientId");

-- CreateIndex
CREATE INDEX "Recommendation_userId_status_createdAt_idx" ON "Recommendation"("userId", "status", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CoachMemory_userId_key_key" ON "CoachMemory"("userId", "key");

-- CreateIndex
CREATE INDEX "UserFeedback_reviewStatus_createdAt_idx" ON "UserFeedback"("reviewStatus", "createdAt");

-- CreateIndex
CREATE INDEX "SafetyReview_status_createdAt_idx" ON "SafetyReview"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiPromptVersion_key_version_key" ON "AiPromptVersion"("key", "version");

-- CreateIndex
CREATE INDEX "UsageRecord_createdAt_idx" ON "UsageRecord"("createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_userId_createdAt_idx" ON "UsageRecord"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_feature_createdAt_idx" ON "UsageRecord"("feature", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_createdAt_idx" ON "OutboxEvent"("publishedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "CoachMessage" ADD CONSTRAINT "CoachMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "CoachConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CoachMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFeedback" ADD CONSTRAINT "UserFeedback_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CoachMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

