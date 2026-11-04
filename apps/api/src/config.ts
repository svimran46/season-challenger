import { z } from 'zod';
import { checkSettings, type MoneySettings } from '@season/wallet';

const blankToUndefined = (value: unknown) => (value === '' ? undefined : value);

const schema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
  DATABASE_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
  /** How often the worker syncs the feed and moves tournaments along. */
  WORKER_SECONDS: z.coerce.number().int().min(5).default(60),
  /** Key for hashing sign-in codes. */
  AUTH_SECRET: z.preprocess(blankToUndefined, z.string().optional()),
  /** Who sends sign-in codes: "console" (the server log) or "sslwireless" (SSL Wireless SMS Plus). */
  SMS_PROVIDER: z.enum(['console', 'sslwireless']).default('console'),
  SSLWIRELESS_API_TOKEN: z.preprocess(blankToUndefined, z.string().optional()),
  /** Sender id SSL Wireless assigned to the account. */
  SSLWIRELESS_SID: z.preprocess(blankToUndefined, z.string().optional()),
  SSLWIRELESS_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
  /** Set when the API runs behind a proxy or load balancer, so rate limits see client IPs. */
  TRUST_PROXY: z.preprocess(blankToUndefined, z.enum(['true', 'false']).optional()),
  // ------------------------------------------------------------------ money (Game of 11 flows)
  /** Turns deposits, conversions and withdrawals on. They run unless switched off. */
  MONEY_ENABLED: z.preprocess(blankToUndefined, z.enum(['true', 'false']).optional()),
  /** Which checkout gateway handles deposit invoices. "mock" runs a dev-only checkout page. */
  PAYMENTS_GATEWAY: z.enum(['mock']).default('mock'),
  /** Secret the gateway signs webhook bodies with; falls back to AUTH_SECRET. */
  PAYMENTS_SECRET: z.preprocess(blankToUndefined, z.string().optional()),
  /** Absolute URL of this API, used to build payment links the app can open. */
  API_PUBLIC_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
  /** Deposit and redeem rate, then limits, mirroring Game of 11's settings table. */
  MONEY_COINS_PER_BDT: z.coerce.number().int().min(1).default(50),
  MONEY_MIN_DEPOSIT_BDT: z.coerce.number().int().min(1).default(20),
  MONEY_MAX_DEPOSIT_BDT: z.coerce.number().int().min(1).default(25_000),
  MONEY_MIN_REDEEM_BDT: z.coerce.number().int().min(1).default(1),
  /** Winnings coins per taka when converting coins to cash; must stay above the deposit rate. */
  MONEY_COIN_TO_CASH_COINS_PER_BDT: z.coerce.number().int().min(1).default(60),
  MONEY_MIN_CONVERSION_BDT: z.coerce.number().int().min(1).default(10),
  MONEY_MIN_WITHDRAW_BDT: z.coerce.number().int().min(1).default(500),
  MONEY_MAX_WITHDRAW_BDT: z.coerce.number().int().min(1).default(10_000),
  /** Token the payout review queue expects in the x-admin-token header. */
  ADMIN_TOKEN: z.preprocess(blankToUndefined, z.string().optional()),
});

export interface Config {
  port: number;
  databaseUrl: string | undefined;
  workerSeconds: number;
  authSecret: string;
  sms:
    | { provider: 'console' }
    | { provider: 'sslwireless'; apiToken: string; sid: string; baseUrl?: string };
  trustProxy: boolean;
  money: {
    enabled: boolean;
    settings: MoneySettings;
    gateway: 'mock';
    paymentsSecret: string;
    apiPublicUrl: string;
    adminToken: string;
  };
}

/** Reads the environment once at boot and refuses to start on a setting that would lose data. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(env);
  const problems: string[] = [];
  if (parsed.NODE_ENV === 'production' && !parsed.DATABASE_URL) {
    problems.push('DATABASE_URL must be set in production: without it everything is in memory.');
  }
  if (parsed.NODE_ENV === 'production') {
    if (!parsed.AUTH_SECRET || parsed.AUTH_SECRET.length < 32) {
      problems.push('AUTH_SECRET must be a random value of 32+ characters in production.');
    }
  }
  if (
    parsed.SMS_PROVIDER === 'sslwireless' &&
    (!parsed.SSLWIRELESS_API_TOKEN || !parsed.SSLWIRELESS_SID)
  ) {
    problems.push('SMS_PROVIDER=sslwireless needs SSLWIRELESS_API_TOKEN and SSLWIRELESS_SID.');
  }
  if (parsed.NODE_ENV === 'production') {
    if (parsed.SMS_PROVIDER === 'console') {
      problems.push(
        'SMS_PROVIDER=console only logs sign-in codes; production needs a real SMS provider.',
      );
    }
  }
  if (problems.length > 0) throw new Error(`Bad configuration:\n- ${problems.join('\n- ')}`);
  const moneyEnabled = parsed.MONEY_ENABLED !== 'false';
  const settings: MoneySettings = {
    coinsPerBdt: parsed.MONEY_COINS_PER_BDT,
    minDepositBdt: parsed.MONEY_MIN_DEPOSIT_BDT,
    maxDepositBdt: parsed.MONEY_MAX_DEPOSIT_BDT,
    minRedeemBdt: parsed.MONEY_MIN_REDEEM_BDT,
    coinToCashCoinsPerBdt: parsed.MONEY_COIN_TO_CASH_COINS_PER_BDT,
    minConversionBdt: parsed.MONEY_MIN_CONVERSION_BDT,
    minWithdrawBdt: parsed.MONEY_MIN_WITHDRAW_BDT,
    maxWithdrawBdt: parsed.MONEY_MAX_WITHDRAW_BDT,
  };
  if (moneyEnabled) {
    try {
      checkSettings(settings);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
    if (parsed.NODE_ENV === 'production') {
      if (!parsed.ADMIN_TOKEN || parsed.ADMIN_TOKEN.length < 32) {
        problems.push('ADMIN_TOKEN must be a random value of 32+ characters in production.');
      }
    }
  }
  if (problems.length > 0) throw new Error(`Bad configuration:\n- ${problems.join('\n- ')}`);
  return {
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    workerSeconds: parsed.WORKER_SECONDS,
    authSecret: parsed.AUTH_SECRET ?? 'dev-only-auth-secret',
    sms:
      parsed.SMS_PROVIDER === 'sslwireless'
        ? {
            provider: 'sslwireless',
            apiToken: parsed.SSLWIRELESS_API_TOKEN!,
            sid: parsed.SSLWIRELESS_SID!,
            baseUrl: parsed.SSLWIRELESS_URL,
          }
        : { provider: 'console' },
    trustProxy: parsed.TRUST_PROXY === 'true',
    money: {
      enabled: moneyEnabled,
      settings,
      gateway: parsed.PAYMENTS_GATEWAY,
      paymentsSecret: parsed.PAYMENTS_SECRET ?? parsed.AUTH_SECRET ?? 'dev-only-auth-secret',
      apiPublicUrl: parsed.API_PUBLIC_URL ?? 'http://localhost:3000',
      adminToken: parsed.ADMIN_TOKEN ?? 'dev-admin-token',
    },
  };
}
