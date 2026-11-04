import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * Which browser origins may call the API. The mobile app is native and sends no Origin, so it is
 * never affected: a request without one always passes. Only a browser enforces this, so it does
 * not replace sign-in, which every private route still needs.
 */
export function corsOptions(
  origins: readonly string[] | undefined,
  nodeEnv = process.env.NODE_ENV,
): CorsOptions {
  if (origins && origins.length > 0) {
    return { origin: (origin, done) => done(null, !origin || origins.includes(origin)) };
  }
  // Open in development so Expo web and the portal work with no setup.
  return { origin: nodeEnv !== 'production' };
}
