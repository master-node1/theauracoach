import { Injectable } from '@nestjs/common';
import type { AdminField } from '@aura/contracts';
import type { AdminReports } from '@aura/service-kit';
import { PrismaService } from './prisma.service';

/** progress-service's part of the support view (TAC-32): counts and dates, never the values. */
@Injectable()
export class ProgressReports implements AdminReports {
  readonly title = 'Progress';

  constructor(private readonly prisma: PrismaService) {}

  async userSummary(userId: string): Promise<AdminField[]> {
    const [measurements, checkIns, last] = await Promise.all([
      this.prisma.bodyMeasurement.count({ where: { userId } }),
      this.prisma.dailyCheckIn.count({ where: { userId } }),
      this.prisma.dailyCheckIn.findFirst({
        where: { userId },
        orderBy: { date: 'desc' },
        select: { date: true },
      }),
    ]);
    return [
      { label: 'Measurements', value: measurements },
      { label: 'Check-ins', value: checkIns },
      { label: 'Last check-in', value: last?.date.toISOString().slice(0, 10) ?? null },
    ];
  }
}
