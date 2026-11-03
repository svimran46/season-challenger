/** Small deterministic PRNG (mulberry32) so the fake feed is the same on every machine. */
export function createRandom(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error('pick from empty list');
      return item;
    },
    /** Poisson sample, good enough for goals and cards. */
    poisson: (mean: number) => {
      const limit = Math.exp(-mean);
      let k = 0;
      let p = 1;
      do {
        k += 1;
        p *= next();
      } while (p > limit);
      return k - 1;
    },
  };
}

export type Random = ReturnType<typeof createRandom>;

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
