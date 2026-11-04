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
  googleWebClientId: string | undefined;
  /** Phone codes are offered only when they can reach a phone (not console in production). */
  phoneSignIn: boolean;
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
    googleWebClientId: parsed.GOOGLE_WEB_CLIENT_ID,
    phoneSignIn,
  };
}
