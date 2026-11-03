/**
 * Injection tokens. Every injection in the API names its token explicitly with @Inject, so the
 * code works under esbuild-based tools (tsx, tsup, vitest) that do not emit decorator metadata.
 */
export const FOOTBALL_FEED = Symbol('FOOTBALL_FEED');
export const CLOCK = Symbol('CLOCK');
export const LEDGER_STORE = Symbol('LEDGER_STORE');
export const ECONOMY_STORES = Symbol('ECONOMY_STORES');

export type Clock = () => Date;
