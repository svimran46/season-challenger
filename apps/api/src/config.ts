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
  /** Who sends sign-in codes. Only "console" (the server log) until a provider is chosen. */
  SMS_PROVIDER: z.enum(['console']).default('console'),
  /** Set when the API runs behind a proxy or load balancer, so rate limits see client IPs. */
  TRUST_PROXY: z.preprocess(blankToUndefined, z.enum(['true', 'false']).optional()),
});

export interface Config {
  port: number;
  databaseUrl: string | undefined;
  workerSeconds: number;
  authSecret: string;
  smsProvider: 'console';
  trustProxy: boolean;
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
    if (parsed.SMS_PROVIDER === 'console') {
      problems.push(
        'SMS_PROVIDER=console only logs sign-in codes; production needs a real SMS provider.',
      );
    }
  }
  if (problems.length > 0) throw new Error(`Bad configuration:\n- ${problems.join('\n- ')}`);
  return {
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    workerSeconds: parsed.WORKER_SECONDS,
    authSecret: parsed.AUTH_SECRET ?? 'dev-only-auth-secret',
    smsProvider: parsed.SMS_PROVIDER,
    trustProxy: parsed.TRUST_PROXY === 'true',
  };
}
