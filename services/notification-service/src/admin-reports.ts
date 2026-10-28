import { Injectable } from '@nestjs/common';
import type { AdminField } from '@aura/contracts';
import type { AdminReports } from '@aura/service-kit';
import { PrismaService } from './prisma.service';

/** notification-service's part of the support view (TAC-32): devices and delivery, no tokens. */
@Injectable()
export class NotificationReports implements AdminReports {
  readonly title = 'Notifications';

  constructor(private readonly prisma: PrismaService) {}

  async userSummary(userId: string): Promise<AdminField[]> {
    const [devices, sent, failed, last] = await Promise.all([
      this.prisma.device.count({ where: { userId } }),
      this.prisma.notification.count({ where: { userId, status: 'SENT' } }),
      this.prisma.notification.count({ where: { userId, status: 'FAILED' } }),
      this.prisma.notification.findFirst({
        where: { userId, sentAt: { not: null } },
        orderBy: { sentAt: 'desc' },
        select: { sentAt: true },
      }),
    ]);
    return [
      { label: 'Devices', value: devices },
      { label: 'Notifications sent', value: sent },
      { label: 'Failed deliveries', value: failed },
      { label: 'Last sent', value: last?.sentAt?.toISOString() ?? null },
    ];
  }
}
