import { CLASH, FLOODLIGHT, MOLTEN, SILK } from './sources';

type Colour = readonly [number, number, number];

export interface Look {
  source: string;
  uniforms: Record<string, Colour>;
  /** Draws at this fraction of the screen's resolution and scales up, to save battery. */
  renderScale: number;
}

const metal = (shadow: Colour, colour: Colour, flash: Colour): Look => ({
  source: MOLTEN,
  uniforms: { shadow, metal: colour, flash },
  renderScale: 1,
});

export const LOOKS = {
  silk: {
    source: SILK,
    uniforms: { deep: [0.022, 0.024, 0.032], sheen: [0.62, 0.47, 0.22], glint: [1, 0.86, 0.55] },
    renderScale: 0.5,
  },
  floodlight: {
    source: FLOODLIGHT,
    uniforms: { lamp: [1, 0.93, 0.78], grass: [0.05, 0.27, 0.13] },
    renderScale: 0.75,
  },
  clash: {
    source: CLASH,
    uniforms: { home: [0.2, 0.4, 1], away: [1, 0.2, 0.2] },
    renderScale: 0.6,
  },
  gold: metal([0.11, 0.06, 0.015], [0.86, 0.62, 0.24], [1, 0.93, 0.72]),
  Scout: metal([0.07, 0.04, 0.03], [0.55, 0.33, 0.2], [1, 0.8, 0.62]),
  Analyst: metal([0.04, 0.05, 0.07], [0.58, 0.64, 0.72], [0.9, 0.96, 1]),
  Tactician: metal([0.01, 0.06, 0.05], [0.1, 0.58, 0.42], [0.72, 1, 0.88]),
  Master: metal([0.05, 0.02, 0.09], [0.46, 0.28, 0.78], [0.9, 0.78, 1]),
  Grandmaster: metal([0.11, 0.06, 0.015], [0.86, 0.62, 0.24], [1, 0.93, 0.72]),
} satisfies Record<string, Look>;

export type LookName = keyof typeof LOOKS;

/** A club's kit colour as shader light: same hue, full brightness, so dark kits still glow. */
export function kitLight(hex: string): Colour {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  const rgb = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  const top = Math.max(...rgb, 1);
  const [r = 0, g = 0, b = 0] = rgb.map((c) => c / top);
  return [r, g, b];
}
