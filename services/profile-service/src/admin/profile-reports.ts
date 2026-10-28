import { Injectable } from '@nestjs/common';
import type { UsageMetric } from '@aura/contracts';
import type { AdminReports } from '@aura/service-kit';
import { PrismaService } from '../prisma.service';

/** profile-service's usage counters: sign-ups and active users (from `User.lastActiveAt`). */
@Injectable()
export class ProfileReports implements AdminReports {
  readonly title = 'Account';

  constructor(private readonly prisma: PrismaService) {}

  async usage(since: Date): Promise<UsageMetric[]> {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [dau, activeInRange, signups, total] = await Promise.all([
      this.prisma.user.count({ where: { status: 'ACTIVE', lastActiveAt: { gte: dayAgo } } }),
      this.prisma.user.count({ where: { status: 'ACTIVE', lastActiveAt: { gte: since } } }),
      this.prisma.user.count({ where: { createdAt: { gte: since } } }),
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
    ]);
    return [
      { key: 'dau', label: 'Daily active users', value: dau },
      { key: 'active_users_7d', label: 'Active users, 7 days', value: activeInRange },
      { key: 'signups_7d', label: 'Sign-ups, 7 days', value: signups },
      { key: 'users_total', label: 'Active accounts', value: total },
    ];
  }
}
