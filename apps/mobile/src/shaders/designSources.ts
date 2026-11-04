// The "design set": our own SkSL versions of the looks MJ picked from the Shaders library, one per
// app area (see project file design/shaders-picks.md). Written from scratch for React Native Skia,
// so they run on any Android phone; no Shaders code is used. Same budget as sources.ts.

import { Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';
import { COMMON } from './sources';

/** Plumes of light rising from the bottom, like floodlights over a dark pitch. Sign-in hero. */
const LIGHT_STREAMS = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 bg;
uniform float3 ca;
uniform float3 cb;
${COMMON}
half4 main(float2 xy) {
  float2 uv = xy / size;
  float3 col = bg;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float cx = 0.14 + 0.24 * fi + 0.05 * sin(time * 0.3 + fi * 1.7)
             + 0.10 * (fbm(float2(uv.y * 1.5 - time * 0.22, fi * 4.0)) - 0.5);
    float w = 0.05 + 0.07 * uv.y;
    float d = (uv.x - cx) / w;
    float plume = exp(-d * d) * smoothstep(0.0, 1.0, uv.y);
    plume *= 0.55 + 0.45 * fbm(float2(uv.x * 6.0 + fi, uv.y * 3.0 - time * 0.5));
    col += mix(ca, cb, step(2.5, fi)) * plume * 0.6;
  }
  col += ca * exp(-(1.0 - uv.y) * 7.0) * 0.3;
  col += (hash(xy + fract(time) * 37.0) - 0.5) * 0.04;
  return half4(half3(col), 1.0);
}
`;

/** Faint dots in panels that brighten and fade in turn. Matches list background. */
const DOT_PANELS = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 bg;
uniform float3 c;
${COMMON}
half4 main(float2 xy) {
  float2 g = xy / 12.0;
  float2 id = floor(g);
  float2 f = fract(g) - 0.5;
  float2 panel = floor(id / 6.0);
  float b = 0.5 + 0.5 * sin(time * 0.8 + hash(panel + 3.0) * 6.28318);
  float r = 0.10 + 0.12 * b;
  float m = smoothstep(r, r - 0.06, length(f));
  float3 col = bg + c * m * (0.08 + 0.20 * b);
  return half4(half3(col), 1.0);
}
`;

/** A grid floor rushing towards you under a dark sky, with a glowing horizon. Match card. */
const GRIDSCAPE = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 bg;
uniform float3 line;
uniform float3 glow;
${COMMON}
half4 main(float2 xy) {
  float2 uv = xy / size;
  float horizon = 0.62;
  float3 col = mix(bg, glow * 0.35, pow(clamp(uv.y / horizon, 0.0, 1.0), 4.0));
  float star = step(0.992, hash(floor(xy / 3.0))) * step(uv.y, horizon - 0.05);
  col += star * 0.5 * (0.5 + 0.5 * sin(time * 2.0 + xy.x));
  if (uv.y > horizon) {
    float py = max(uv.y - horizon, 0.002);
    float z = 0.18 / py;
    float gx = (uv.x - 0.5) * z * 5.0;
    float gz = z * 2.0 + time * 0.9;
    float dx = 0.5 - abs(fract(gx) - 0.5);
    float dz = 0.5 - abs(fract(gz) - 0.5);
    float w = 0.03 + 0.012 * z;
    float grid = max(smoothstep(w, 0.0, dx), smoothstep(w * 1.4, 0.0, dz));
    float fog = exp(-z * 0.22);
    col = bg * 0.7 + line * grid * fog * 0.9 + glow * exp(-py * 9.0) * 0.35;
  }
  col += glow * exp(-abs(uv.y - horizon) * 70.0) * 0.8;
  return half4(half3(col), 1.0);
}
`;

/** Spokes converging on a vanishing point, with dashes flowing inward. Tournaments list. */
const TUNNEL = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 bg;
uniform float3 ca;
uniform float3 cb;
half4 main(float2 xy) {
  float2 p = (xy - size * float2(0.75, 0.5)) / size.y;
  float r = length(p);
  float a = atan(p.y, p.x);
  float s = abs(fract(a / 6.28318 * 28.0) - 0.5);
  float spoke = smoothstep(0.12, 0.0, s);
  float dash = step(0.45, fract(log(r + 0.001) * 3.0 + time * 0.9));
  float k = spoke * dash * smoothstep(0.03, 0.3, r);
  float3 col = bg + mix(ca, cb, smoothstep(0.1, 0.9, r)) * k * 0.55;
  col += ca * exp(-r * 9.0) * 0.5;
  return half4(half3(col), 1.0);
}
`;

/** Fast diagonal streaks in hot colours. Live tournament card. */
const SLASHES = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 bg;
uniform float3 ca;
uniform float3 cb;
${COMMON}
half4 main(float2 xy) {
  float2 q = float2(xy.x * 0.87 + xy.y * 0.5, -xy.x * 0.5 + xy.y * 0.87) / size.y;
  float lanes = 16.0;
  float lane = floor(q.y * lanes);
  float h = hash(float2(lane, 1.7));
  float x = q.x * 1.2 - time * (1.2 + 2.2 * h) - h * 10.0;
  float seg = fract(x * 0.45);
  float tail = pow(seg, 4.0);
  float thin = smoothstep(0.22, 0.0, abs(fract(q.y * lanes) - 0.5));
  float on = step(0.5, h);
  float3 col = bg + mix(ca, cb, h) * tail * thin * on * 1.1;
  return half4(half3(col), 1.0);
}
`;

/** A warm glow breathing in one corner, with grain. Wallet header. */
const CORNER_GLOW = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 bg;
uniform float3 c;
uniform float3 c2;
${COMMON}
half4 main(float2 xy) {
  float2 uv = xy / size;
  float aspect = size.x / size.y;
  float2 p = uv * float2(aspect, 1.0);
  float2 o = float2(aspect * (0.92 + 0.04 * sin(time * 0.4)), 0.08 + 0.06 * cos(time * 0.3));
  float d = distance(p, o);
  float n = fbm(p * 2.5 + time * 0.08);
  float3 col = bg + c * exp(-d * 2.0) * (0.55 + 0.6 * n);
  col += c2 * exp(-distance(p, float2(0.0, 1.0)) * 3.0) * 0.25;
  col += (hash(xy + fract(time) * 53.0) - 0.5) * 0.05;
  return half4(half3(col), 1.0);
}
`;

/** Bursts of sparks. \`bursts\` (1..3) and \`scale\` keep the daily reward smaller than a win. */
const FIREWORKS = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 bg;
uniform float3 ca;
uniform float3 cb;
uniform float bursts;
uniform float scale;
${COMMON}
half4 main(float2 xy) {
  float2 uv = xy / size;
  float aspect = size.x / size.y;
  float3 col = bg;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float t = time + fi * 0.9;
    float k = floor(t / 2.6);
    float ph = fract(t / 2.6);
    float2 center = float2(0.2 + 0.6 * hash(float2(k, fi)), 0.25 + 0.35 * hash(float2(fi, k + 3.0)));
    float2 p = (uv - center) * float2(aspect, 1.0);
    float r = length(p);
    float a = atan(p.y, p.x);
    float ray = smoothstep(0.14, 0.0, abs(fract(a / 6.28318 * 20.0) - 0.5));
    float radius = sqrt(ph) * 0.45 * scale;
    float front = exp(-pow((r - radius) * 35.0, 2.0));
    float trail = smoothstep(radius, radius * 0.3, r) * step(r, radius) * 0.25;
    float fade = pow(1.0 - ph, 1.5) * step(fi + 0.5, bursts);
    float3 c = mix(ca, cb, hash(float2(k, fi + 7.0)));
    col += c * ray * (front + trail) * fade * 1.5;
    col += c * exp(-r * 7.0) * 0.18 * fade;
  }
  return half4(half3(col), 1.0);
}
`;

/** Slowly drifting contour lines, like a scouting map. Scout tier. */
const CONTOURS = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 bg;
uniform float3 c;
${COMMON}
half4 main(float2 xy) {
  float2 uv = xy / size;
  float2 p = uv * float2(size.x / size.y, 1.0) * 1.6;
  float h = fbm(p + float2(time * 0.03, time * 0.02));
  float lv = h * 16.0;
  float dist = abs(fract(lv + 0.5) - 0.5);
  float major = step(4.5, mod(floor(lv + 0.5), 5.0));
  float ln = smoothstep(0.09, 0.0, dist);
  float3 col = bg + c * ln * (0.28 + 0.35 * major);
  return half4(half3(col), 1.0);
}
`;

/** Hexagon cells whose edges glow and fill in turn, like data lighting up. Analyst tier. */
const HEX_CELLS = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 bg;
uniform float3 ca;
uniform float3 cb;
${COMMON}
float hexDist(float2 p) {
  p = abs(p);
  return max(dot(p, float2(0.5, 0.8660254)), p.x);
}
half4 main(float2 xy) {
  float2 uv = xy / size;
  float2 s = float2(1.0, 1.7320508);
  float2 p = xy / 16.0;
  float2 a = floor(p / s) + 0.5;
  float2 b = floor((p - float2(0.5, 0.8660254)) / s) + 0.5;
  float2 ha = p - a * s;
  float2 hb = p - (b * s + float2(0.5, 0.8660254));
  bool useA = dot(ha, ha) < dot(hb, hb);
  float2 h = useA ? ha : hb;
  float2 id = useA ? a : b + 0.5;
  float edge = 0.5 - hexDist(h);
  float g = pow(0.5 + 0.5 * sin(time * 1.3 + hash(id) * 6.28318), 8.0);
  float border = smoothstep(0.05, 0.0, edge);
  float3 c = mix(ca, cb, uv.x);
  float3 col = bg + c * (border * 0.30 + g * 0.45 * smoothstep(0.0, 0.25, edge));
  return half4(half3(col), 1.0);
}
`;

/** Interlinked rings turning slowly, like a formation. Tactician tier. */
const LINKED_RINGS = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 bg;
uniform float3 c;
half4 main(float2 xy) {
  float2 p = (xy - size * float2(0.8, 0.5)) / size.y;
  float k = 0.0;
  for (int i = 0; i < 5; i++) {
    float an = float(i) * 1.2566 + time * 0.3;
    float2 o = float2(cos(an), sin(an)) * 0.2;
    float d = abs(length(p - o) - 0.22);
    k += smoothstep(0.012, 0.0, d) * 0.6 + exp(-d * 28.0) * 0.12;
  }
  float3 col = bg + c * k;
  return half4(half3(col), 1.0);
}
`;

/** A turning sphere made of gold dots, like a ball. Master tier. */
const DOT_SPHERE = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 bg;
uniform float3 gold;
half4 main(float2 xy) {
  float2 p = (xy - size * float2(0.8, 0.5)) / size.y;
  float R = 0.4;
  float r = length(p);
  float3 col = bg + gold * exp(-r * 3.0) * 0.12;
  if (r < R) {
    float3 n = float3(p, sqrt(R * R - r * r)) / R;
    float ca = cos(time * 0.4);
    float sa = sin(time * 0.4);
    float3 m = float3(n.x * ca - n.z * sa, n.y, n.x * sa + n.z * ca);
    float lat = asin(clamp(m.y, -1.0, 1.0));
    float lon = atan(m.x, m.z);
    float2 cell = float2(lon / 6.28318 * 30.0, lat / 3.14159 * 15.0);
    float2 f = fract(cell) - 0.5;
    float d = smoothstep(0.32, 0.16, length(f));
    float light = 0.3 + 0.7 * max(0.0, dot(n, normalize(float3(-0.4, -0.5, 0.8))));
    col += gold * d * light;
  }
  col += gold * exp(-abs(r - R) * 45.0) * 0.25;
  return half4(half3(col), 1.0);
}
`;

/** A cut purple gem with a gold glint sweeping over it. Grandmaster tier. */
const GEM = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 deep;
uniform float3 light;
uniform float3 glint;
${COMMON}
half4 main(float2 xy) {
  float2 uv = xy / size;
  float2 p = (xy - size * float2(0.8, 0.5)) / size.y;
  float r = length(p);
  float a = atan(p.y, p.x);
  float facet = floor(a / 6.28318 * 10.0 + 0.5 * floor(r * 5.0));
  float shade = hash(float2(facet, floor(r * 5.0)));
  float tw = 0.5 + 0.5 * sin(time * 0.7 + shade * 6.28318);
  float3 col = mix(deep, light, (0.25 + 0.55 * shade * tw) * exp(-r * 1.4));
  col = mix(col, deep * 0.6, smoothstep(0.5, 1.2, r));
  float s = uv.x - fract(time * 0.12) * 2.6 + 0.6;
  col += glint * exp(-s * s * 160.0) * 0.6;
  float2 star = p - float2(-0.12, -0.12);
  float sp = pow(max(0.0, sin(time * 1.5)), 8.0);
  col += glint * sp * (exp(-abs(star.x) * 120.0) * exp(-abs(star.y) * 8.0)
                     + exp(-abs(star.y) * 120.0) * exp(-abs(star.x) * 8.0)) * 0.8;
  return half4(half3(col), 1.0);
}
`;

/** Fine horizontal lines that ripple where a quiet signal passes. Pre-match analysis. */
const SIGNAL_LINES = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 bg;
uniform float3 c;
${COMMON}
half4 main(float2 xy) {
  float2 uv = xy / size;
  float rows = size.y / 9.0;
  float y = uv.y * rows;
  float row = floor(y);
  float f = fract(y) - 0.5;
  float centre = 0.5 + 0.35 * sin(time * 0.2 + row * 0.25);
  float env = exp(-pow((uv.x - centre) * 3.0, 2.0));
  float disp = 0.32 * sin(uv.x * 14.0 - time * 1.6 + row * 0.7) * env;
  float ln = smoothstep(0.07, 0.0, abs(f - disp));
  float3 col = bg + c * ln * (0.10 + 0.55 * env);
  return half4(half3(col), 1.0);
}
`;

/** Big chevrons sliding sideways, fading out behind the text. Vouchers shop. */
const CHEVRONS = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 bg;
uniform float3 gold;
half4 main(float2 xy) {
  float2 uv = xy / size;
  float aspect = size.x / size.y;
  float x = uv.x * aspect - time * 0.12;
  float v = fract((x - abs(uv.y - 0.5) * 0.9) * 1.1);
  float band = smoothstep(0.0, 0.015, v) * smoothstep(0.42, 0.405, v);
  float3 base = mix(bg * 1.6, bg, uv.x);
  float3 col = mix(base, gold, band * smoothstep(0.25, 0.75, uv.x) * 0.9);
  return half4(half3(col), 1.0);
}
`;

/** A dark disc with a living corona, for the avatar to sit in. Profile header. */
const ECLIPSE = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float3 bg;
uniform float3 ca;
uniform float3 cb;
${COMMON}
half4 main(float2 xy) {
  float2 p = (xy - size * 0.5) / size.y;
  float r = length(p);
  float a = atan(p.y, p.x);
  float R = 0.27;
  float3 c = mix(ca, cb, 0.5 + 0.5 * sin(a * 2.0 + time * 0.5));
  float flick = 0.6 + 0.5 * fbm(float2(a * 2.5 + time * 0.1, r * 5.0 - time * 0.5));
  float corona = exp(-max(r - R, 0.0) * 8.0) * step(R, r) * flick;
  float3 col = bg + c * corona;
  if (r < R) col = bg * 0.5 + c * exp(-(R - r) * 70.0) * 0.8;
  return half4(half3(col), 1.0);
}
`;

function compile(name: string, source: string): SkRuntimeEffect {
  const effect = Skia.RuntimeEffect.Make(source);
  if (!effect) throw new Error(`Shader ${name} did not compile`);
  return effect;
}

export const designEffects = {
  lightStreams: compile('lightStreams', LIGHT_STREAMS),
  dotPanels: compile('dotPanels', DOT_PANELS),
  gridscape: compile('gridscape', GRIDSCAPE),
  tunnel: compile('tunnel', TUNNEL),
  slashes: compile('slashes', SLASHES),
  cornerGlow: compile('cornerGlow', CORNER_GLOW),
  fireworks: compile('fireworks', FIREWORKS),
  contours: compile('contours', CONTOURS),
  hexCells: compile('hexCells', HEX_CELLS),
  linkedRings: compile('linkedRings', LINKED_RINGS),
  dotSphere: compile('dotSphere', DOT_SPHERE),
  gem: compile('gem', GEM),
  signalLines: compile('signalLines', SIGNAL_LINES),
  chevrons: compile('chevrons', CHEVRONS),
  eclipse: compile('eclipse', ECLIPSE),
};
