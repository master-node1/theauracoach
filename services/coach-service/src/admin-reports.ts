import { Injectable } from '@nestjs/common';
import type { AdminField } from '@aura/contracts';
import type { AdminReports } from '@aura/service-kit';
import { PrismaService } from './prisma.service';

/**
 * coach-service's part of the support view (TAC-32): counts only. Conversation text stays out of
 * it; reviewers see excerpts through the safety queue (TAC-34).
 */
@Injectable()
export class CoachReports implements AdminReports {
  readonly title = 'Coach';

  constructor(private readonly prisma: PrismaService) {}

  async userSummary(userId: string): Promise<AdminField[]> {
    const [conversations, flagged, pending, feedback] = await Promise.all([
      this.prisma.coachConversation.count({ where: { userId } }),
      this.prisma.coachConversation.count({ where: { userId, safetyFlag: true } }),
      this.prisma.recommendation.count({ where: { userId, status: 'PENDING' } }),
      this.prisma.userFeedback.count({ where: { userId } }),
    ]);
    return [
      { label: 'Conversations', value: conversations },
      { label: 'Safety-flagged conversations', value: flagged },
      { label: 'Pending suggestions', value: pending },
      { label: 'Feedback given', value: feedback },
    ];
  }
}
