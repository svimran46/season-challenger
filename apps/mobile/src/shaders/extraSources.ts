// Second batch of card effects. Same rules as sources.ts: no textures, short loops, cheap maths.

import { Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';
import { COMMON } from './sources';

/** Slowly turning sun rays with a warm glow and twinkles. Daily reward. */
const SUNBURST = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 ca;
uniform float3 cb;
${COMMON}
half4 main(float2 xy) {
  float2 p = xy - size * float2(0.5, 0.38);
  float r = length(p) / size.y;
  float a = atan(p.y, p.x);
  float rays = smoothstep(0.35, 1.0, 0.5 + 0.5 * sin(a * 14.0 + time * 0.5));
  float rays2 = smoothstep(0.6, 1.0, 0.5 + 0.5 * sin(a * 7.0 - time * 0.3));
  float3 col = mix(cb, ca, exp(-r * 2.4));
  col += ca * (rays * 0.35 + rays2 * 0.2) * exp(-r * 1.4);
  col += float3(1.0, 0.95, 0.8) * exp(-r * r * 22.0) * 0.6;
  float2 g = xy / 9.0;
  float h = hash(floor(g));
  float tw = pow(max(0.0, sin(time * 2.5 + h * 50.0)), 12.0) * step(0.9, h);
  col += tw * smoothstep(0.4, 0.0, length(fract(g) - 0.5)) * 0.9;
  return half4(half3(col), 1.0);
}
`;

/** A tank of liquid filled to \`progress\`, with a moving surface and rising bubbles. */
const LIQUID_FILL = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float progress;
uniform float3 ca;
uniform float3 cb;
${COMMON}
half4 main(float2 xy) {
  float2 uv = xy / size;
  float surf = (1.0 - progress
              + 0.035 * sin(uv.x * 7.0 + time * 1.8)
              + 0.020 * sin(uv.x * 15.0 - time * 2.7)) * size.y;
  float inside = smoothstep(-1.2, 1.2, xy.y - surf);
  float depth = clamp((xy.y - surf) / size.y, 0.0, 1.0);

  float3 glass = mix(float3(0.05, 0.07, 0.12), float3(0.08, 0.10, 0.17), uv.y);
  float3 liquid = mix(ca, cb, depth * 1.6);
  liquid += exp(-(xy.y - surf) * 0.12) * 0.35 * inside;
  liquid += 0.06 * sin(uv.x * 20.0 + depth * 30.0 - time * 2.0);

  float2 g = float2(xy.x / 16.0, xy.y / 16.0 + time * 1.4);
  float h = hash(floor(g));
  float2 f = fract(g) - 0.5 + float2(0.15 * sin(time * 2.0 + h * 9.0), 0.0);
  float d = length(f);
  float bubble = (smoothstep(0.2, 0.15, d) - smoothstep(0.13, 0.08, d)) * step(0.88, h);
  liquid += bubble * 0.3;

  float3 col = mix(glass, liquid, inside);
  col += smoothstep(2.0, 0.0, abs(xy.y - surf)) * 0.6;
  return half4(half3(col), 1.0);
}
`;

/** Fire rising from the bottom of the card. Captain pick, hot streaks. */
const FLAME = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 base;
${COMMON}
half4 main(float2 xy) {
  float2 uv = xy / size;
  float aspect = size.x / size.y;
  float n = fbm(float2(uv.x * aspect * 3.0, uv.y * 3.0 + time * 1.6));
  n += 0.5 * fbm(float2(uv.x * aspect * 6.0 - time * 0.3, uv.y * 6.0 + time * 2.6));
  float heat = clamp(n * 1.3 * pow(uv.y, 1.6) - 0.15, 0.0, 1.0);
  float3 fire = float3(1.6 * heat, 1.2 * heat * heat, 0.5 * heat * heat * heat);
  float3 col = base + fire;
  col += float3(0.9, 0.3, 0.05) * pow(uv.y, 4.0) * 0.25;
  return half4(half3(col), 1.0);
}
`;

/** Light on a pool floor seen through water. Pre-match analysis cards. */
const CAUSTICS = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 deep;
uniform float3 shallow;
half4 main(float2 xy) {
  float2 uv = xy / size;
  float2 p = float2(uv.x * size.x / size.y, uv.y) * 4.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    p += 0.45 * float2(sin(p.y * 1.3 + time * 0.7 + fi), sin(p.x * 1.1 - time * 0.6 + fi * 2.0));
  }
  float v = abs(sin(p.x) * sin(p.y));
  float light = pow(1.0 - v, 7.0);
  float3 col = mix(deep, shallow, 1.0 - uv.y * 0.8);
  col += light * float3(0.75, 0.95, 1.0) * 0.45;
  return half4(half3(col), 1.0);
}
`;

/** A field of dots that swell as a wave passes. Sign-in and onboarding heroes. */
const HALFTONE_WAVE = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 bg;
uniform float3 ca;
uniform float3 cb;
${COMMON}
half4 main(float2 xy) {
  float cell = 13.0;
  float2 g = xy / cell;
  float2 id = floor(g);
  float2 f = fract(g) - 0.5;
  float2 c = (id + 0.5) * cell / size;
  float w = 0.5 + 0.5 * sin(c.x * 6.0 - time * 1.4 + sin(c.y * 4.0 + time * 0.6) * 1.6);
  w *= 0.55 + 0.45 * vnoise(id * 0.18 + time * 0.25);
  float r = 0.06 + 0.38 * w;
  float dotMask = smoothstep(r, r - 0.07, length(f));
  dotMask *= mix(1.0, 0.18, smoothstep(0.4, 0.85, c.y));
  float3 col = mix(bg, mix(ca, cb, c.x * 0.7 + c.y * 0.3), dotMask);
  return half4(half3(col), 1.0);
}
`;

/** Rings pulsing out from a point with a radar sweep. Kick-off countdowns. */
const RADAR_PULSE = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 bg;
uniform float3 c;
half4 main(float2 xy) {
  float2 p = (xy - size * float2(0.8, 0.5)) / size.y;
  float r = length(p);
  float rings = 0.0;
  for (int i = 0; i < 3; i++) {
    float ph = fract(time * 0.35 + float(i) / 3.0);
    rings += smoothstep(0.018, 0.0, abs(r - ph * 1.3)) * (1.0 - ph);
  }
  float grid = smoothstep(0.012, 0.0, abs(fract(r * 4.0 + 0.5) - 0.5) / 4.0) * 0.12;
  float a = atan(p.y, p.x);
  float sweep = pow(fract(a / 6.28318 - time * 0.25), 10.0) * exp(-r * 1.2);
  float3 col = bg + c * (rings * 0.8 + grid + sweep * 0.45);
  col += c * exp(-r * r * 400.0) * 0.9;
  return half4(half3(col), 1.0);
}
`;

function compile(name: string, source: string): SkRuntimeEffect {
  const effect = Skia.RuntimeEffect.Make(source);
  if (!effect) throw new Error(`Shader ${name} did not compile`);
  return effect;
}

export const moreEffects = {
  sunburst: compile('sunburst', SUNBURST),
  liquidFill: compile('liquidFill', LIQUID_FILL),
  flame: compile('flame', FLAME),
  caustics: compile('caustics', CAUSTICS),
  halftoneWave: compile('halftoneWave', HALFTONE_WAVE),
  radarPulse: compile('radarPulse', RADAR_PULSE),
};
