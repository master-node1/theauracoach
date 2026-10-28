import { Injectable } from '@nestjs/common';
import type { AdminField, UsageMetric } from '@aura/contracts';
import type { AdminReports } from '@aura/service-kit';
import { PrismaService } from './prisma.service';

/** workout-service's part of the support view and usage dashboard (TAC-32): counts and dates only. */
@Injectable()
export class WorkoutReports implements AdminReports {
  readonly title = 'Training';

  constructor(private readonly prisma: PrismaService) {}

  async userSummary(userId: string): Promise<AdminField[]> {
    const [activePlan, completed, last] = await Promise.all([
      this.prisma.workoutPlan.findFirst({
        where: { userId, status: 'ACTIVE' },
        select: { startDate: true },
      }),
      this.prisma.workoutSession.count({ where: { userId, status: 'COMPLETED' } }),
      this.prisma.workoutSession.findFirst({
        where: { userId, completedAt: { not: null } },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      }),
    ]);
    return [
      {
        label: 'Active plan since',
        value: activePlan?.startDate.toISOString().slice(0, 10) ?? null,
      },
      { label: 'Sessions completed', value: completed },
      { label: 'Last session', value: last?.completedAt?.toISOString() ?? null },
    ];
  }

  async usage(since: Date): Promise<UsageMetric[]> {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [today, week] = await Promise.all([
      this.prisma.workoutSession.count({ where: { completedAt: { gte: dayAgo } } }),
      this.prisma.workoutSession.count({ where: { completedAt: { gte: since } } }),
    ]);
    return [
      { key: 'sessions_24h', label: 'Sessions logged, 24 h', value: today },
      { key: 'sessions_7d', label: 'Sessions logged, 7 days', value: week },
    ];
  }
}
