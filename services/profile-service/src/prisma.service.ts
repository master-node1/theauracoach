import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { HealthRegistry, SERVICE_KIT_CONFIG, type BaseConfig } from '@aura/service-kit';
import { PrismaClient } from './generated/prisma';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly health: HealthRegistry,
    @Inject(SERVICE_KIT_CONFIG) config: BaseConfig,
  ) {
    super({ datasources: { db: { url: config.DATABASE_URL } } });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.health.register('database', async () => {
      await this.$queryRaw`SELECT 1`;
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
