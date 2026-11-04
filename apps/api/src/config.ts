import { parseVaultKey } from './kyc/vault';
import { z } from 'zod';

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
  /** OAuth web client id from Google Cloud; turns on Google sign-in. Not a secret. */
  GOOGLE_WEB_CLIENT_ID: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/\.apps\.googleusercontent\.com$/, 'should end in .apps.googleusercontent.com')
      .optional(),
  ),
  /** Set when the API runs behind a proxy or load balancer, so rate limits see client IPs. */
  TRUST_PROXY: z.preprocess(blankToUndefined, z.enum(['true', 'false']).optional()),
  /** Key for the short codes a voucher holder shows at the till. */
  VOUCHER_PRESENT_SECRET: z.preprocess(blankToUndefined, z.string().optional()),
  /** Comma-separated browser origins allowed to call the API, such as the partner portal. */
  PORTAL_ORIGINS: z.preprocess(blankToUndefined, z.string().optional()),
  /** Key for hashing ID document numbers (one ID, one account). */
  ID_HASH_SECRET: z.preprocess(blankToUndefined, z.string().optional()),
  /** Base64 of 32 random bytes: encrypts ID photos and typed document numbers at rest. */
  KYC_ENCRYPTION_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  /** Directory for encrypted ID photos. Unset in development keeps them in memory. */
  KYC_STORAGE_DIR: z.preprocess(blankToUndefined, z.string().optional()),
  /** Header value for the ID review page and routes; unset turns review off. */
  KYC_REVIEWER_TOKEN: z.preprocess(blankToUndefined, z.string().optional()),
  /** Days after the decision before ID photos are deleted. */
  KYC_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
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
  voucherPresentSecret: string;
  portalOrigins: string[] | undefined;
  googleWebClientId: string | undefined;
  /** Phone codes are offered only when they can reach a phone (not console in production). */
  phoneSignIn: boolean;
  kyc: {
    /** Decoded KYC_ENCRYPTION_KEY; undefined in development (a fixed dev key is used). */
    encryptionKey: Buffer | undefined;
    storageDir: string | undefined;
    reviewerToken: string | undefined;
    retentionDays: number;
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
  const production = parsed.NODE_ENV === 'production';
  // In production the console sender would only log codes, so phone sign-in is switched off.
  const phoneSignIn = !(production && parsed.SMS_PROVIDER === 'console');
  if (production && !phoneSignIn && !parsed.GOOGLE_WEB_CLIENT_ID) {
    problems.push(
      'No way to sign in: set GOOGLE_WEB_CLIENT_ID, or a real SMS_PROVIDER for phone codes.',
    );
  }
  let encryptionKey: Buffer | undefined;
  if (parsed.KYC_ENCRYPTION_KEY) {
    try {
      encryptionKey = parseVaultKey(parsed.KYC_ENCRYPTION_KEY);
    } catch {
      problems.push('KYC_ENCRYPTION_KEY must be base64 of 32 random bytes.');
    }
  }
  if (parsed.NODE_ENV === 'production') {
    if (!parsed.ID_HASH_SECRET || parsed.ID_HASH_SECRET.length < 32) {
      problems.push('ID_HASH_SECRET must be a random value of 32+ characters in production.');
    }
    if (!parsed.VOUCHER_PRESENT_SECRET || parsed.VOUCHER_PRESENT_SECRET.length < 32) {
      problems.push(
        'VOUCHER_PRESENT_SECRET must be a random value of 32+ characters in production.',
      );
    }
    if (!parsed.KYC_ENCRYPTION_KEY) {
      problems.push('KYC_ENCRYPTION_KEY must be set in production: it encrypts ID photos.');
    }
    if (!parsed.KYC_STORAGE_DIR) {
      problems.push('KYC_STORAGE_DIR must be set in production: without it ID photos are lost.');
    }
    if (parsed.KYC_REVIEWER_TOKEN && parsed.KYC_REVIEWER_TOKEN.length < 32) {
      problems.push('KYC_REVIEWER_TOKEN must be a random value of 32+ characters in production.');
    }
  }
  if (problems.length > 0) throw new Error(`Bad configuration:\n- ${problems.join('\n- ')}`);
  return {
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    workerSeconds: parsed.WORKER_SECONDS,
    authSecret: parsed.AUTH_SECRET ?? 'dev-only-auth-secret',
    voucherPresentSecret: parsed.VOUCHER_PRESENT_SECRET ?? 'dev-only-present-secret',
    portalOrigins: parsed.PORTAL_ORIGINS?.split(',').map((o) => o.trim()),
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
    googleWebClientId: parsed.GOOGLE_WEB_CLIENT_ID,
    phoneSignIn,
    kyc: {
      encryptionKey,
      storageDir: parsed.KYC_STORAGE_DIR,
      reviewerToken: parsed.KYC_REVIEWER_TOKEN,
      retentionDays: parsed.KYC_RETENTION_DAYS,
    },
  };
}
