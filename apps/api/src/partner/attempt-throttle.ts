import type { Clock } from '../common/tokens';

export interface ThrottlePolicy {
  maxAttempts: number;
  windowSeconds: number;
}

const SWEEP_ABOVE_KEYS = 10_000;

/**
 * Counts unproven attempts per key over a sliding window. An attempt counts as soon as it starts,
 * before any await, so a burst of parallel guesses cannot all slip past the limit; one that turns
 * out fine is forgiven afterwards.
 *
 * It lives in this process's memory: a restart clears it and each API instance counts on its own.
 */
export class AttemptThrottle {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly clock: Clock,
    private readonly policy: ThrottlePolicy,
  ) {}

  /** Records an attempt. Returns 0 if it may go ahead, or the seconds to wait if it may not. */
  attempt(key: string): number {
    const now = this.clock().getTime();
    const windowMs = this.policy.windowSeconds * 1000;
    const recent = (this.attempts.get(key) ?? []).filter((t) => t > now - windowMs);
    if (recent.length >= this.policy.maxAttempts) {
      this.attempts.set(key, recent);
      return Math.max(1, Math.ceil((recent[0]! + windowMs - now) / 1000));
    }
    recent.push(now);
    this.attempts.set(key, recent);
    if (this.attempts.size > SWEEP_ABOVE_KEYS) this.sweep(now - windowMs);
    return 0;
  }

  /** Takes back the latest attempt, because it turned out to be legitimate. */
  forgive(key: string): void {
    this.attempts.get(key)?.pop();
  }

  private sweep(cutoff: number): void {
    for (const [key, times] of this.attempts) {
      if (times.every((t) => t <= cutoff)) this.attempts.delete(key);
    }
  }
}
