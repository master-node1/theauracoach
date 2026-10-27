import { Controller, Get, HttpCode, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { SkipRateLimit } from '../rate-limit/rate-limit';

export type HealthCheck = () => Promise<void>;

/** Services register readiness checks (database, Redis, streams) at start-up. */
@Injectable()
export class HealthRegistry {
  private readonly checks = new Map<string, HealthCheck>();

  register(name: string, check: HealthCheck): void {
    this.checks.set(name, check);
  }

  async run(timeoutMs = 1500): Promise<Record<string, 'up' | 'down'>> {
    const entries = await Promise.all(
      [...this.checks].map(async ([name, check]) => {
        try {
          await Promise.race([
            check(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
          ]);
          return [name, 'up'] as const;
        } catch {
          return [name, 'down'] as const;
        }
      }),
    );
    return Object.fromEntries(entries);
  }
}

@Public()
@SkipRateLimit()
@Controller('health')
export class HealthController {
  constructor(private readonly registry: HealthRegistry) {}

  /** Liveness: the process is serving requests. Never checks dependencies. */
  @Get('live')
  @HttpCode(200)
  live() {
    return { status: 'ok' };
  }

  /** Readiness: every registered dependency answers. Kubernetes stops routing traffic when this fails. */
  @Get('ready')
  async ready() {
    const checks = await this.registry.run();
    const ok = Object.values(checks).every((s) => s === 'up');
    if (!ok) throw new ServiceUnavailableException({ status: 'unavailable', checks });
    return { status: 'ok', checks };
  }
}
