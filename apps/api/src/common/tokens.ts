/**
 * Injection tokens. Every injection in the API names its token explicitly with @Inject, so the
 * code works under esbuild-based tools (tsx, tsup, vitest) that do not emit decorator metadata.
 */
export const FOOTBALL_FEED = Symbol('FOOTBALL_FEED');
export const CLOCK = Symbol('CLOCK');
export const LEDGER_STORE = Symbol('LEDGER_STORE');
export const ECONOMY_REPOSITORY = Symbol('ECONOMY_REPOSITORY');
export const DATABASE = Symbol('DATABASE');
export const FEED_SYNC = Symbol('FEED_SYNC');
export const WORKER_SECONDS = Symbol('WORKER_SECONDS');

export const PARTNER_STORE = Symbol('PARTNER_STORE');
export const PARTNER_LIMITS = Symbol('PARTNER_LIMITS');
export const VOUCHER_PRESENT_SECRET = Symbol('VOUCHER_PRESENT_SECRET');

export type Clock = () => Date;
