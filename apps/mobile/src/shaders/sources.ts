// SkSL sources for the card effects. Each one is a small fragment shader that Skia runs on the
// GPU for every pixel of a card. They are written to stay cheap on low-end Android phones: no
// texture reads, at most four noise octaves, and no loops longer than a handful of steps.
//
// Every shader takes `size` (card size in pixels) and `time` (seconds). The rest are per-effect.

import { Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';

const COMMON = /* sksl */ `
float hash(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + float2(1.0, 0.0));
  float c = hash(i + float2(0.0, 1.0));
  float d = hash(i + float2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(float2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + float2(17.1, 9.2);
    a *= 0.5;
  }
  return v;
}

float3 spectrum(float h) {
  return 0.5 + 0.5 * cos(6.28318 * (h + float3(0.0, 0.33, 0.67)));
}
`;

/** Slow, drifting mesh gradient with film grain. Wallet header, hero banners. */
const MESH_GRADIENT = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 c1;
uniform float3 c2;
uniform float3 c3;
uniform float3 c4;
${COMMON}
half4 main(float2 xy) {
  float aspect = size.x / size.y;
  float2 uv = xy / size;
  float2 p = float2(uv.x * aspect, uv.y);
  float t = time * 0.25;
  p += 0.18 * (float2(fbm(p * 1.4 + t), fbm(p * 1.4 - t + 3.1)) - 0.5);

  float2 p1 = float2(aspect * (0.15 + 0.12 * sin(t * 1.3)), 0.25 + 0.2 * cos(t * 1.1));
  float2 p2 = float2(aspect * (0.85 + 0.10 * cos(t * 0.9)), 0.20 + 0.15 * sin(t * 1.7));
  float2 p3 = float2(aspect * (0.70 + 0.15 * sin(t * 0.7)), 0.85 + 0.10 * cos(t * 1.2));
  float2 p4 = float2(aspect * (0.25 + 0.15 * cos(t * 1.5)), 0.80 + 0.15 * sin(t * 0.8));

  float w1 = 1.0 / (0.03 + pow(distance(p, p1), 2.2));
  float w2 = 1.0 / (0.03 + pow(distance(p, p2), 2.2));
  float w3 = 1.0 / (0.03 + pow(distance(p, p3), 2.2));
  float w4 = 1.0 / (0.03 + pow(distance(p, p4), 2.2));
  float3 col = (c1 * w1 + c2 * w2 + c3 * w3 + c4 * w4) / (w1 + w2 + w3 + w4);

  col += (hash(xy + fract(time) * 91.0) - 0.5) * 0.07;
  return half4(half3(col), 1.0);
}
`;

/** Holographic foil with sparkles; the light follows a finger, or drifts on its own. Player cards. */
const HOLO_FOIL = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float2 pointer;
uniform float3 base;
${COMMON}
half4 main(float2 xy) {
  float2 uv = xy / size;
  float2 l = pointer;
  float d = dot(uv - l, normalize(float2(1.0, 0.6)));
  float n = fbm(uv * 3.0 + time * 0.05);
  float3 rainbow = spectrum(d * 1.6 + n * 0.7 + time * 0.03);
  float band = smoothstep(0.6, 0.0, abs(d + 0.08 * sin(uv.y * 8.0 + time)));

  float3 col = base;
  col = mix(col, rainbow, 0.38 * band + 0.10);
  float lines = 0.5 + 0.5 * sin((xy.x + xy.y) * 0.9);
  col += rainbow * lines * 0.07 * band;

  float r = distance(uv, l);
  col += exp(-14.0 * r * r) * 0.35;

  float2 g = xy / 7.0;
  float2 id = floor(g);
  float h = hash(id);
  float twinkle = pow(max(0.0, sin(time * 3.0 + h * 40.0)), 16.0) * step(0.95, h);
  float2 f = fract(g) - 0.5;
  col += twinkle * smoothstep(0.4, 0.0, length(f)) * (0.3 + band) * 1.3;

  col *= 0.82 + 0.18 * smoothstep(1.0, 0.3, length(uv - 0.5));
  return half4(half3(col), 1.0);
}
`;

/** Brushed metal with a light sweep and bevel. Season Mastery tier cards. */
const BRUSHED_METAL = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 tint;
uniform float3 shade;
uniform float sheen;
${COMMON}
half4 main(float2 xy) {
  float2 uv = xy / size;
  float brush = vnoise(float2(xy.x * 0.02, xy.y * 1.1)) * 0.6
              + vnoise(float2(xy.x * 0.06, xy.y * 2.7)) * 0.4;
  float grad = mix(0.55, 1.0, 1.0 - uv.y) + 0.15 * sin(uv.x * 3.0 + 1.0);
  float3 col = mix(shade, tint, clamp(grad * 0.8 + brush * 0.3, 0.0, 1.0));

  float s = uv.x + uv.y * 0.6 - fract(time * 0.16) * 3.2 + 0.8;
  col += exp(-s * s * 30.0) * 0.35 * sheen;

  float2 e = min(uv, 1.0 - uv) * size;
  float edge = min(e.x, e.y);
  col += 0.22 * smoothstep(2.5, 0.0, edge) * (1.0 - uv.y);
  return half4(half3(col), 1.0);
}
`;

/** Aurora ribbons over a night sky with a few stars. Top tier (Grandmaster) and Mastery header. */
const AURORA = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 ca;
uniform float3 cb;
${COMMON}
half4 main(float2 xy) {
  float2 uv = xy / size;
  float t = time * 0.18;
  float3 col = mix(float3(0.03, 0.02, 0.09), float3(0.01, 0.04, 0.10), uv.y);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float y = 0.30 + 0.18 * fi
            + 0.10 * sin(uv.x * 3.2 + t * (1.0 + fi * 0.4) + fi * 2.1)
            + 0.12 * (fbm(float2(uv.x * 2.2 + t, fi * 3.7)) - 0.5);
    float dist = uv.y - y;
    float glow = exp(-dist * dist * (90.0 + fi * 60.0));
    float curtain = glow * (0.6 + 0.4 * vnoise(float2(uv.x * 30.0 + t * 4.0, fi)));
    col += mix(ca, cb, 0.5 + 0.5 * sin(fi * 2.3 + uv.x * 4.0 + t)) * curtain * (0.75 - fi * 0.15);
  }
  float2 g = xy / 5.0;
  float h = hash(floor(g));
  float star = step(0.985, h) * (0.5 + 0.5 * sin(time * 2.0 + h * 60.0));
  col += star * smoothstep(0.35, 0.0, length(fract(g) - 0.5)) * 0.9;
  return half4(half3(col), 1.0);
}
`;

/** A comet of light running round a rounded border, with glow. Live tournament cards. */
const NEON_BORDER = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float radius;
uniform float3 ca;
uniform float3 cb;
uniform float3 fill;

float sdRoundRect(float2 p, float2 b, float r) {
  float2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

half4 main(float2 xy) {
  float2 p = xy - size * 0.5;
  float d = sdRoundRect(p, size * 0.5 - 8.0, radius);
  float ang = atan(p.y * (size.x / size.y), p.x);
  float rot = fract(ang / 6.28318 - time * 0.22);
  float3 c = mix(ca, cb, 0.5 + 0.5 * sin(rot * 12.56636));
  float head = pow(rot, 5.0);
  float line = smoothstep(1.6, 0.0, abs(d));
  float glow = exp(-abs(d) * 0.32);
  float k = line * (0.30 + 1.3 * head) + glow * (0.10 + 0.70 * head);
  if (d < 0.0) {
    float inner = exp(d * 0.18) * 0.35 * head;
    return half4(half3(fill + c * (k + inner)), 1.0);
  }
  float a = clamp(k, 0.0, 1.0);
  return half4(half3(c * a), a);
}
`;

/** Pitch stripes under two sweeping floodlights and drifting haze. Match cards. */
const FLOODLIGHT_PITCH = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 grass;
${COMMON}
float beam(float2 uv, float2 o, float dir, float spread) {
  float2 v = uv - o;
  float a = atan(v.x, v.y);
  return smoothstep(spread, 0.0, abs(a - dir)) * exp(-length(v) * 1.1);
}

half4 main(float2 xy) {
  float aspect = size.x / size.y;
  float2 uv = xy / size;
  float2 q = float2(uv.x * aspect, uv.y);
  float stripe = step(0.5, fract(uv.x * 7.0 + uv.y * 0.6));
  float3 col = grass * (0.78 + 0.12 * stripe);

  float lineX = smoothstep(1.2, 0.0, abs(xy.x - size.x * 0.5));
  float circle = smoothstep(1.2, 0.0, abs(distance(xy, size * 0.5) - size.y * 0.32));
  col += (lineX + circle) * 0.18;

  float b = beam(q, float2(0.0, -0.15), 0.55 + 0.25 * sin(time * 0.45), 0.22)
          + beam(q, float2(aspect, -0.15), -0.55 + 0.25 * cos(time * 0.38), 0.22);
  float haze = fbm(q * 2.5 + float2(time * 0.07, time * 0.03));
  col += float3(1.0, 0.97, 0.88) * b * (0.55 + 0.6 * haze);

  col *= mix(1.0, 0.35, smoothstep(0.35, 1.0, uv.y));
  return half4(half3(col), 1.0);
}
`;

function compile(name: string, source: string): SkRuntimeEffect {
  const effect = Skia.RuntimeEffect.Make(source);
  if (!effect) throw new Error(`Shader ${name} did not compile`);
  return effect;
}

export const effects = {
  meshGradient: compile('meshGradient', MESH_GRADIENT),
  holoFoil: compile('holoFoil', HOLO_FOIL),
  brushedMetal: compile('brushedMetal', BRUSHED_METAL),
  aurora: compile('aurora', AURORA),
  neonBorder: compile('neonBorder', NEON_BORDER),
  floodlightPitch: compile('floodlightPitch', FLOODLIGHT_PITCH),
};

/** '#rrggbb' to the 0..1 float3 the shaders take. */
export function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
