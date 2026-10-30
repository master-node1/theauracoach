import { Injectable } from '@nestjs/common';
import type { AdminField, UsageMetric } from '@aura/contracts';
import type { AdminReports } from '@aura/service-kit';
import { PrismaService } from './prisma.service';

/** nutrition-service's part of the support view and usage dashboard (TAC-32): counts and dates only. */
@Injectable()
export class NutritionReports implements AdminReports {
  readonly title = 'Nutrition';

  constructor(private readonly prisma: PrismaService) {}

  async userSummary(userId: string): Promise<AdminField[]> {
    const [target, meals, last] = await Promise.all([
      this.prisma.nutritionTarget.findFirst({
        where: { userId },
        orderBy: { effectiveFrom: 'desc' },
        select: { effectiveFrom: true },
      }),
      this.prisma.mealEntry.count({ where: { userId } }),
      this.prisma.mealEntry.findFirst({
        where: { userId },
        orderBy: { loggedAt: 'desc' },
        select: { loggedAt: true },
      }),
    ]);
    return [
      { label: 'Targets since', value: target?.effectiveFrom.toISOString().slice(0, 10) ?? null },
      { label: 'Meals logged', value: meals },
      { label: 'Last meal logged', value: last?.loggedAt.toISOString() ?? null },
    ];
  }

  async usage(since: Date): Promise<UsageMetric[]> {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [today, week] = await Promise.all([
      this.prisma.mealEntry.count({ where: { loggedAt: { gte: dayAgo } } }),
      this.prisma.mealEntry.count({ where: { loggedAt: { gte: since } } }),
    ]);
    return [
      { key: 'meals_24h', label: 'Meals logged, 24 h', value: today },
      { key: 'meals_7d', label: 'Meals logged, 7 days', value: week },
    ];
  }
}
