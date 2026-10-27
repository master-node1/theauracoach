import type { UserDataPlan } from '@aura/service-kit';
import type { Prisma } from './generated/prisma';

/** Safety reviews point at conversations by id only (no relation), so look the ids up first. */
async function conversationIds(userId: string, tx: Prisma.TransactionClient): Promise<string[]> {
  const rows = await tx.coachConversation.findMany({ where: { userId }, select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * coach-service's part of export and deletion (users LLD §3–4). Children before parents. Usage
 * records stay for cost reporting with the user id removed (ai-coach LLD, TC-PRV-2).
 */
export const userDataPlan: UserDataPlan = {
  service: 'coach-service',
  tables: [
    {
      model: 'SafetyReview',
      where: async (userId, tx: Prisma.TransactionClient) => ({
        conversationId: { in: await conversationIds(userId, tx) },
      }),
      notExported: 'Staff moderation notes; the flagged messages are in the export',
    },
    { model: 'UserFeedback', where: (userId) => ({ userId }) },
    { model: 'Recommendation', where: (userId) => ({ userId }) },
    { model: 'CoachMessage', where: (userId) => ({ conversation: { userId } }) },
    { model: 'CoachConversation', where: (userId) => ({ userId }) },
    { model: 'CoachMemory', where: (userId) => ({ userId }) },
    { model: 'UserConsentState', where: (userId) => ({ userId }) },
    {
      model: 'UsageRecord',
      where: (userId) => ({ userId }),
      purge: { anonymise: { userId: null } },
    },
  ],
  notUserData: {
    AiPromptVersion: 'Prompt templates (staff content)',
    AiModelConfig: 'Model configuration',
    CoachingPolicy: 'Safety and coaching policy (staff edits)',
  },
};
