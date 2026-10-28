import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { SERVICE_KIT_CONFIG } from '@aura/service-kit';
import type { ServiceConfig } from '../config';
import { DeletionService } from './deletion.service';

/**
 * Scheduled work in the worker deployment: start deletions whose grace period is over, finish
 * those every service confirmed, alert on missing confirmations, and expire or fail exports.
 * Each job is idempotent, so running it on several replicas at once only repeats no-ops.
 */
@Injectable()
export class PrivacyJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PrivacyJobs.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    private readonly deletion: DeletionService,
    @Inject(SERVICE_KIT_CONFIG) private readonly config: ServiceConfig,
  ) {}

  onApplicationBootstrap(): void {
    const tick = () => {
      this.running ??= this.runOnce().finally(() => {
        this.running = undefined;
      });
    };
    this.timer = setInterval(tick, this.config.PRIVACY_JOB_INTERVAL_SECONDS * 1000);
    this.timer.unref();
    tick();
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  /** One pass of every job; a failing job is logged and does not stop the others. */
  async runOnce(now = new Date()): Promise<void> {
    const jobs: [string, () => Promise<unknown>][] = [
      ['start due deletions', () => this.deletion.runDueDeletions(now)],
      ['finish deletions', () => this.deletion.runFinishDeletions(now)],
      ['purge acknowledgement alerts', () => this.deletion.runAckAlerts(now)],
      ['export housekeeping', () => this.deletion.runExportHousekeeping(now)],
    ];
    for (const [name, job] of jobs) {
      try {
        await job();
      } catch (err) {
        this.logger.error({ err, msg: `Privacy job failed: ${name}` });
      }
    }
  }
}
