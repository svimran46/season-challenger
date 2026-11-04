import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
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

export interface SslWirelessOptions {
  /** API token from the SSL Wireless SMS Plus panel. */
  apiToken: string;
  /** Sender id (SID) SSL Wireless assigned to the account, e.g. a masked "SeasonChal". */
  sid: string;
  /** API host; the default is SSL Wireless's SMS Plus. */
  baseUrl?: string;
  /** Milliseconds before giving up on a send. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

interface SslWirelessReply {
  status?: string;
  status_code?: number;
  error_message?: string;
  smsinfo?: { sms_status?: string; msisdn?: string; sms_id?: string }[];
}

/**
 * SSL Wireless SMS Plus, API v3 single send: POST {baseUrl}/api/v3/send-sms with
 * { api_token, sid, msisdn, sms, csms_id }. A send succeeded when the reply says
 * status "SUCCESS". The token and message text are never logged.
 */
export class SslWirelessSmsSender implements SmsSender {
  readonly name = 'sslwireless';
  private readonly logger = new Logger('SMS');
  private readonly url: string;
  private readonly fetch: typeof fetch;

  constructor(private readonly options: SslWirelessOptions) {
    this.url = `${(options.baseUrl ?? 'https://smsplus.sslwireless.com').replace(/\/+$/, '')}/api/v3/send-sms`;
    this.fetch = options.fetch ?? fetch;
  }

  async send(to: string, text: string): Promise<void> {
    // Our own id for the message, unique per send; SSL Wireless rejects a repeated csms_id.
    const csmsId = randomBytes(8).toString('hex');
    let reply: SslWirelessReply = {};
    let httpStatus = 0;
    try {
      const res = await this.fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          api_token: this.options.apiToken,
          sid: this.options.sid,
          msisdn: to.replace(/^\+/, ''),
          sms: text,
          csms_id: csmsId,
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
      httpStatus = res.status;
      reply = (await res.json().catch(() => ({}))) as SslWirelessReply;
    } catch (error) {
      this.logger.error(`SSL Wireless unreachable for ${maskPhone(to)}: ${String(error)}`);
      throw new Error('SMS provider unreachable');
    }
    if (httpStatus < 200 || httpStatus >= 300 || reply.status !== 'SUCCESS') {
      this.logger.error(
        `SSL Wireless refused ${maskPhone(to)} (${csmsId}): HTTP ${httpStatus}, ` +
          `${reply.status_code ?? '?'} ${reply.error_message ?? reply.status ?? ''}`.trim(),
      );
      throw new Error('SMS provider refused the message');
    }
    this.logger.log(`sent to ${maskPhone(to)} (${csmsId}, ${reply.smsinfo?.[0]?.sms_id ?? '-'})`);
  }
}
