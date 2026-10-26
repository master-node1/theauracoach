import {
  DynamicModule,
  Global,
  Inject,
  Module,
  OnApplicationShutdown,
  Provider,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import type { ServiceName } from '@aura/contracts';
import { Redis } from 'ioredis';
import { AuthGuard } from './auth/auth.guard';
import { UserTokenVerifier } from './auth/user-token.verifier';
import { parseServiceUrls, type BaseConfig } from './config/config';
import { HealthController, HealthRegistry } from './health/health';
import { loggerModule } from './http/logging';
import { ProblemDetailsFilter } from './http/problem-details.filter';
import { InternalClient } from './internal-client/internal-client';
import { shutdownTelemetry } from './telemetry/sdk';
import { REDIS, SERVICE_KIT_CONFIG } from './tokens';

export interface ServiceKitOptions {
  config: BaseConfig;
  /** Override the user token verifier (tests). */
  verifier?: UserTokenVerifier;
}

@Global()
@Module({})
export class ServiceKitModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Wires config, logging, problem details, the global auth guard, health, Redis and the internal client. */
  static forRoot(options: ServiceKitOptions): DynamicModule {
    const { config } = options;
    const providers: Provider[] = [
      { provide: SERVICE_KIT_CONFIG, useValue: config },
      {
        provide: UserTokenVerifier,
        useValue:
          options.verifier ??
          new UserTokenVerifier({
            jwksUrl: config.AUTH_JWKS_URL,
            issuer: config.AUTH_ISSUER,
            clientIds: config.AUTH_CLIENT_IDS,
          }),
      },
      {
        provide: REDIS,
        useFactory: (health: HealthRegistry) => {
          const redis = new Redis(config.REDIS_URL, {
            maxRetriesPerRequest: 3,
            lazyConnect: false,
          });
          health.register('redis', async () => {
            await redis.ping();
          });
          return redis;
        },
        inject: [HealthRegistry],
      },
      {
        provide: InternalClient,
        useValue: new InternalClient({
          self: config.SERVICE_NAME,
          secret: config.INTERNAL_TOKEN_SECRET,
          urls: parseServiceUrls(config.INTERNAL_SERVICE_URLS) as Partial<
            Record<ServiceName, string>
          >,
        }),
      },
      HealthRegistry,
      { provide: APP_GUARD, useClass: AuthGuard },
      { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    ];
    return {
      module: ServiceKitModule,
      imports: [loggerModule(config)],
      controllers: [HealthController],
      providers,
      exports: [SERVICE_KIT_CONFIG, REDIS, InternalClient, HealthRegistry, UserTokenVerifier],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
    await shutdownTelemetry();
  }
}
