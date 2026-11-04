import { Logger } from '@nestjs/common';
import { maskPhone } from './phone';

/**
 * Sends text messages. The sign-in code is the only message so far. A real provider (an SMS
 * gateway with Bangladesh routes) implements this; until one is chosen the API uses
 * ConsoleSmsSender, which writes the message to the server log instead of sending it.
 */
export interface SmsSender {
  /** Short name shown in /health and logs, e.g. "console". */
  readonly name: string;
  /** Throws if the provider refused the message, so the caller can tell the player. */
  send(to: string, text: string): Promise<void>;
}

/** Development and test mode: prints the message, sends nothing. Refused in production. */
export class ConsoleSmsSender implements SmsSender {
  readonly name = 'console';
  private readonly logger = new Logger('SMS');

  async send(to: string, text: string): Promise<void> {
    this.logger.log(`to ${maskPhone(to)} (${to}): ${text}`);
  }
}

/** Keeps every message in memory, for tests that read the code back. */
export class MemorySmsSender implements SmsSender {
  readonly name = 'memory';
  readonly sent: { to: string; text: string }[] = [];

  async send(to: string, text: string): Promise<void> {
    this.sent.push({ to, text });
  }

  /** The code in the newest message to this number. */
  lastCode(to: string): string | undefined {
    const message = [...this.sent].reverse().find((m) => m.to === to);
    return message?.text.match(/\b(\d{6})\b/)?.[1];
  }
}
