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
import { ConsentGuard } from './auth/consent.guard';
import { AdminMfaGuard, PermissionsGuard } from './auth/permissions.guard';
import { UserTokenVerifier } from './auth/user-token.verifier';
import { parseServiceUrls, type BaseConfig } from './config/config';
import { createFeatureFlags, FeatureFlags } from './flags/feature-flags';
import { FeatureFlagGuard } from './flags/require-flag';
import { HealthController, HealthRegistry } from './health/health';
import { loggerModule } from './http/logging';
import { ProblemDetailsFilter } from './http/problem-details.filter';
import { InternalClient } from './internal-client/internal-client';
import { RateLimitGuard } from './rate-limit/rate-limit';
import { shutdownTelemetry } from './telemetry/sdk';
import { REDIS, SERVICE_KIT_CONFIG } from './tokens';

export interface ServiceKitOptions {
  config: BaseConfig;
  /** Override the user token verifier (tests). */
  verifier?: UserTokenVerifier;
  /** Override the feature flags (tests). */
  flags?: FeatureFlags;
}

@Global()
@Module({})
export class ServiceKitModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * Wires config, logging, problem details, the global guards (auth, then rate limits, then
   * feature flags; Nest runs them in this order), health, Redis, feature flags and the internal client.
   */
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
      options.flags
        ? { provide: FeatureFlags, useValue: options.flags }
        : { provide: FeatureFlags, useFactory: () => createFeatureFlags(config) },
      HealthRegistry,
      // Global guards run in this order: who is calling, rate limit, feature flag, MFA on admin
      // routes, permissions, consent.
      { provide: APP_GUARD, useClass: AuthGuard },
      { provide: APP_GUARD, useClass: RateLimitGuard },
      { provide: APP_GUARD, useClass: FeatureFlagGuard },
      { provide: APP_GUARD, useClass: AdminMfaGuard },
      { provide: APP_GUARD, useClass: PermissionsGuard },
      { provide: APP_GUARD, useClass: ConsentGuard },
      { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    ];
    return {
      module: ServiceKitModule,
      imports: [loggerModule(config)],
      controllers: [HealthController],
      providers,
      exports: [
        SERVICE_KIT_CONFIG,
        REDIS,
        InternalClient,
        HealthRegistry,
        UserTokenVerifier,
        FeatureFlags,
      ],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
    await shutdownTelemetry();
  }
}
