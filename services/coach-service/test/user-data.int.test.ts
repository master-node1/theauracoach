import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { describeParticipantContract } from '@aura/testing';
import * as vitest from 'vitest';
import { Prisma, PrismaClient } from '../src/generated/prisma';
import { userDataPlan } from '../src/user-data-plan';

/** A conversation with a flagged message, feedback, a recommendation, memory, consent and usage. */
async function seed(prisma: PrismaClient, userId: string): Promise<void> {
  const conversation = await prisma.coachConversation.create({
    data: { userId, title: 'Knee pain' },
  });
  const message = await prisma.coachMessage.create({
    data: { conversationId: conversation.id, role: 'USER', content: 'My knee hurts on squats' },
  });
  await prisma.safetyReview.create({
    data: { conversationId: conversation.id, messageId: message.id, category: 'red_flag_symptom' },
  });
  await prisma.userFeedback.create({
    data: { userId, messageId: message.id, targetType: 'coach_message', rating: 1 },
  });
  await prisma.recommendation.create({
    data: {
      userId,
      kind: 'WORKOUT_SWAP',
      source: 'COACH',
      title: 'Swap squats for glute bridges',
      explanation: 'Less knee load',
      payload: {},
      basisVersion: 'v1',
      messageId: message.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  await prisma.coachMemory.create({
    data: { userId, key: 'prefers_morning_training', value: 'Trains before work' },
  });
  await prisma.userConsentState.create({ data: { userId, aiCoach: true } });
  await prisma.usageRecord.create({
    data: {
      userId,
      feature: 'coach_chat',
      provider: 'anthropic',
      model: 'test-model',
      inputTokens: 100,
      outputTokens: 50,
      costMicroUsd: 1234n,
      latencyMs: 800,
      outcome: 'ok',
      requestId: randomUUID(),
    },
  });
}

describeParticipantContract(vitest, {
  service: 'coach-service',
  serviceDir: resolve(__dirname, '..'),
  plan: userDataPlan,
  models: Prisma.dmmf.datamodel.models,
  createClient: (url) => new PrismaClient({ datasources: { db: { url } } }),
  seed,
  afterPurge: async (prisma, userId) => {
    // Usage stays for cost reporting, with the user id removed (TC-PRV-2).
    vitest.expect(await prisma.usageRecord.count({ where: { userId } })).toBe(0);
    vitest.expect(await prisma.usageRecord.count({ where: { userId: null } })).toBeGreaterThan(0);
  },
  redisDb: 10,
});
