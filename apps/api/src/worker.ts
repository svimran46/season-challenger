import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { FEED_SYNC, WORKER_SECONDS } from './common/tokens';
import type { FeedSync } from './feed/feed-sync';

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
  ) {}

  /** The first sync runs before the API takes traffic: an empty database has nothing to serve. */
  async onApplicationBootstrap() {
    if (this.seconds <= 0 || !this.feedSync) return;
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
      await this.feedSync?.run();
    } catch (error) {
      // A failed run is retried on the next tick; reads keep serving the last good sync.
      this.logger.error(`Feed sync failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
