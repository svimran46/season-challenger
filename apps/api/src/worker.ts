import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { FEED_SYNC, WORKER_SECONDS } from './common/tokens';
import { ContestsService } from './economy/contests.service';
import type { FeedSync } from './feed/feed-sync';
import { KycService } from './kyc/kyc.service';
import { MasteryService } from './mastery/mastery.service';

/**
 * Background work on a timer, running inside the API process. Everything it runs is safe to
 * repeat and safe across instances, so no queue or separate worker process is needed yet.
 */
@Injectable()
export class Worker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(Worker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    @Optional() @Inject(FEED_SYNC) private readonly feedSync: FeedSync | undefined,
    @Inject(WORKER_SECONDS) private readonly seconds: number,
    @Optional() @Inject(ContestsService) private readonly contests: ContestsService | undefined,
    @Optional() @Inject(KycService) private readonly kyc: KycService | undefined,
    @Optional() @Inject(MasteryService) private readonly mastery: MasteryService | undefined,
  ) {}

  /** The first run happens before the API takes traffic: an empty database has nothing to serve. */
  async onApplicationBootstrap() {
    if (this.seconds <= 0) return;
    await this.tick();
    this.timer = setInterval(() => void this.tick(), this.seconds * 1000);
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      try {
        await this.feedSync?.run();
      } catch (error) {
        // A failed run is retried on the next tick; reads keep serving the last good sync.
        this.logger.error(`Feed sync failed: ${String(error)}`);
      }
      try {
        // Locks tournaments at kick-off, cancels or settles them, even when nobody is reading.
        await this.contests?.refresh();
      } catch (error) {
        this.logger.error(`Tournament refresh failed: ${String(error)}`);
      }
      try {
        await this.mastery?.gradeFinished();
      } catch (error) {
        this.logger.error(`Mastery grading failed: ${String(error)}`);
      }
      try {
        // Deletes ID photos once the retention period after the decision is over.
        await this.kyc?.purgeExpired();
      } catch (error) {
        this.logger.error(`ID photo cleanup failed: ${String(error)}`);
      }
    } finally {
      this.running = false;
    }
  }
}
