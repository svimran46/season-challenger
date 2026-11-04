/*
 * The app's look: a floodlit stadium at night, black silk and liquid gold. These are original
 * Skia shaders. Each one dithers its output, because dark gradients band badly on phone screens,
 * and each keeps its noise calls low, because they run on cheap Android phones.
 */
const COMMON = `
uniform float2 size;
uniform float time;

float hash(float2 p) {
  float3 q = fract(float3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float noise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(hash(i), hash(i + float2(1, 0)), u.x),
             mix(hash(i + float2(0, 1)), hash(i + float2(1, 1)), u.x), u.y);
}
float fbm2(float2 p) {
  return 0.67 * noise(p) + 0.33 * noise(p * 2.03 + 7.1);
}
float fbm3(float2 p) {
  return 0.57 * noise(p) + 0.29 * noise(p * 2.03 + 7.1) + 0.14 * noise(p * 4.01 + 3.7);
}
half4 finish(float3 c, float2 xy) {
  c += (hash(xy + fract(time)) - 0.5) * 0.012;
  return half4(half3(max(c, float3(0))), 1);
}
`;

/** Black silk: slow folds of cloth catching a low gold light. Sits behind the whole app. */
export const SILK = `${COMMON}
uniform float3 deep;
uniform float3 sheen;
uniform float3 glint;

float folds(float2 p, float2 warp) {
  return sin(fbm3(p + warp * 2.6) * 13.0);
}

half4 main(float2 xy) {
  float2 uv = xy / size.y;
  float t = time * 0.028;
  float2 p = float2(uv.x * 0.9 + uv.y * 0.55, uv.y * 1.2 - uv.x * 0.9) * 1.25;
  float2 warp = float2(fbm2(p * 0.8 + float2(0, t)), fbm2(p * 0.8 + float2(5.2, -t * 0.8)));

  float e = 0.012;
  float f = folds(p, warp);
  float dx = folds(p + float2(e, 0), warp) - f;
  float dy = folds(p + float2(0, e), warp) - f;
  float3 n = normalize(float3(-dx / e * 0.13, -dy / e * 0.13, 1));

  float3 light = normalize(float3(0.55 + 0.25 * sin(t * 2.3), -0.75, 0.55));
  float3 halfway = normalize(light + float3(0, 0, 1));
  float nh = max(dot(n, halfway), 0.0);
  float broad = pow(nh, 11.0);
  float fine = pow(nh, 90.0);

  float pool = smoothstep(1.15, 0.0, length(uv - float2(0.72 * size.x / size.y, 0.12)));
  float3 c = deep * (0.55 + 0.45 * f);
  c += sheen * broad * (0.11 + 0.62 * pool);
  c += glint * fine * (0.1 + 0.55 * pool);
  c *= 0.55 + 0.45 * smoothstep(1.3, 0.2, length(uv - float2(0.5 * size.x / size.y, 0.42)));
  return finish(c, xy);
}
`;

/** A stadium at night: banks of floodlights through haze, over a mown pitch. For the sign-in hero. */
export const FLOODLIGHT = `${COMMON}
uniform float3 lamp;
uniform float3 grass;

float beam(float2 uv, float2 origin, float angle, float width) {
  float2 d = uv - origin;
  float along = d.x * sin(angle) + d.y * cos(angle);
  float across = d.x * cos(angle) - d.y * sin(angle);
  if (along <= 0.0) return 0.0;
  float spread = width * (0.08 + along);
  return exp(-across * across / (spread * spread)) / (1.0 + along * 2.6);
}

float lampBank(float2 uv, float2 origin) {
  float glow = 0.0;
  for (int i = 0; i < 4; i++) {
    float2 d = uv - (origin + float2((float(i) - 1.5) * 0.034, 0));
    glow += 0.00016 / (dot(d, d) + 0.00016);
  }
  float2 d = uv - origin;
  float flare = exp(-abs(d.y) * 260.0) * exp(-abs(d.x) * 9.0);
  return glow + flare * 0.5;
}

half4 main(float2 xy) {
  float aspect = size.x / size.y;
  float2 uv = float2(xy.x / size.y, xy.y / size.y);
  float t = time;
  float mid = aspect * 0.5;
  float horizon = 0.70;

  float2 left = float2(mid - aspect * 0.36, 0.13);
  float2 right = float2(mid + aspect * 0.36, 0.11);
  float sway = 0.035 * sin(t * 0.17);

  float haze = fbm3(uv * float2(2.2, 3.4) + float2(t * 0.022, -t * 0.012));
  float light = beam(uv, left, 0.34 + sway, 0.30) + beam(uv, left, 0.1 - sway, 0.16);
  light += beam(uv, right, -0.34 - sway, 0.30) + beam(uv, right, -0.1 + sway, 0.16);
  light *= 0.22 + 1.5 * haze * haze;

  float3 sky = mix(float3(0.012, 0.015, 0.03), float3(0.03, 0.045, 0.06),
                   smoothstep(0.0, horizon, uv.y));
  float3 c = sky + lamp * float3(1.0, 0.92, 0.76) * light * 0.36;
  c += lamp * (lampBank(uv, left) + lampBank(uv, right)) * 0.85;

  float stand = smoothstep(horizon - 0.075, horizon - 0.01, uv.y + 0.012 * noise(float2(uv.x * 34.0, 2.0)));
  float seats = noise(float2(uv.x * 260.0, uv.y * 190.0));
  float crowd = 0.012 + 0.05 * seats * seats * (1.0 + 2.5 * light);
  c = mix(c, lamp * crowd + float3(0.004, 0.005, 0.008), stand);

  if (uv.y > horizon) {
    float depth = (uv.y - horizon) / (1.0 - horizon);
    float z = 1.0 / (depth + 0.09);
    float px = (uv.x - mid) * z;
    float stripes = smoothstep(-0.08, 0.08, sin(px * 7.5));
    float blade = noise(float2(px * 90.0, z * 60.0));
    float3 pitch = grass * (0.5 + 0.5 * stripes) * (0.8 + 0.3 * blade);
    float wash = exp(-pow((uv.x - mid) / (0.34 + depth * 0.8), 2.0));
    pitch *= 0.10 + 0.9 * wash * (0.42 + 0.58 * smoothstep(1.0, 0.0, depth));
    float arc = abs(length(float2(px * 0.42, (z - 4.2) * 0.42)) - 0.46);
    pitch += float3(0.45) * smoothstep(0.018, 0.0, arc) * wash;
    pitch += float3(0.4) * smoothstep(0.05, 0.0, abs(z - 4.2)) * wash;
    c = pitch + lamp * 0.05 * exp(-depth * 7.0);
  }

  for (int i = 0; i < 2; i++) {
    float scale = 26.0 + float(i) * 22.0;
    float2 g = uv * scale + float2(sin(t * 0.08 + float(i)) * 0.8, t * (0.10 + 0.05 * float(i)));
    float2 cell = floor(g);
    float2 at = fract(g) - 0.5 + (float2(hash(cell), hash(cell + 3.7)) - 0.5) * 0.8;
    float on = step(0.72, hash(cell + 9.1));
    float twinkle = 0.5 + 0.5 * sin(t * 0.9 + hash(cell) * 40.0);
    c += lamp * on * smoothstep(0.075, 0.0, length(at)) * twinkle * light * 0.8;
  }

  c *= smoothstep(1.18, 0.34, length((uv - float2(mid, 0.45)) * float2(1.0 / max(aspect, 0.5), 1.0)));
  c = c / (1.0 + c * 0.32);
  return finish(c, xy);
}
`;

/** Liquid metal with a thin-film shimmer, tinted by uniforms. For the wallet and tier cards. */
export const MOLTEN = `${COMMON}
uniform float3 shadow;
uniform float3 metal;
uniform float3 flash;

float surface(float2 p, float t) {
  float2 q = float2(fbm2(p + float2(t, 0)), fbm2(p * 1.2 + float2(3.1, -t * 0.7)));
  return fbm3(p * 1.05 + q * 1.9);
}

half4 main(float2 xy) {
  float2 uv = xy / size.y;
  float t = time * 0.07;
  float2 p = float2(uv.x * 0.7, uv.y * 1.05) * 1.7;

  float e = 0.014;
  float h = surface(p, t);
  float dx = surface(p + float2(e, 0), t) - h;
  float dy = surface(p + float2(0, e), t) - h;
  float3 n = normalize(float3(-dx / e * 0.42, -dy / e * 0.42, 1));

  // Reflects a horizon of light and dark bands, which is what makes metal read as metal.
  float3 r = reflect(float3(0, 0, -1), n);
  float bands = 0.5 + 0.5 * sin(r.y * 5.6 + r.x * 2.0 + h * 4.0 + 0.8);
  bands = bands * bands * (3.0 - 2.0 * bands);
  float3 c = mix(shadow, metal, bands);
  c += flash * 0.55 * smoothstep(0.93, 1.0, bands) * (0.5 + 0.5 * r.x);

  float film = h * 5.0 + r.x * 2.0;
  float3 iridescence = 0.5 + 0.5 * cos(film + float3(0.0, 0.7, 1.5));
  c = mix(c, c * (0.72 + 0.56 * iridescence), 0.22);

  float3 light = normalize(float3(-0.45, -0.65, 0.7));
  float spec = pow(max(dot(r, light), 0.0), 22.0);
  c += flash * spec * 0.8;

  float2 corner = (xy / size - float2(0.92, 0.0)) * float2(1.0, 0.9);
  c *= 0.62 + 0.5 * smoothstep(1.25, 0.1, length(corner));
  return finish(c, xy);
}
`;

/** Two clubs' colours driven into each other through smoke, burning where they meet. Match cards. */
export const CLASH = `${COMMON}
uniform float3 home;
uniform float3 away;

half4 main(float2 xy) {
  float2 uv = xy / size;
  float aspect = size.x / size.y;
  float t = time * 0.12;
  float2 p = float2(uv.x * aspect, uv.y) * 2.4;

  // Warped twice over, so the smoke curls rather than showing the noise's square grid.
  float2 warp = float2(fbm2(p * 0.7 + float2(t, 1.7)), fbm2(p * 0.7 + float2(4.1, -t)));
  float smokeA = fbm3(p + warp * 2.4 + float2(t, t * 0.4));
  float smokeB = fbm3(p * 1.25 - warp * 2.0 + float2(-t, 2.7 - t * 0.3));
  float wobble = (fbm2(float2(uv.y * 3.0, t * 1.4)) - 0.5) * 0.22;
  float seam = uv.x - 0.5 + (uv.y - 0.5) * 0.28 + wobble;

  float leftPool = smoothstep(0.52, -0.5, seam) * (0.32 + 1.0 * smokeA * smokeA);
  float rightPool = smoothstep(-0.52, 0.5, seam) * (0.32 + 1.0 * smokeB * smokeB);
  float3 c = float3(0.012, 0.013, 0.018);
  c += home * leftPool * 0.62;
  c += away * rightPool * 0.62;

  float edge = abs(seam);
  float burn = exp(-edge * 42.0) * (0.45 + 0.9 * smokeA);
  float halo = exp(-edge * 7.0) * 0.16;
  c += float3(1.0, 0.86, 0.6) * (burn * 0.75 + halo);

  float2 g = float2(uv.x * aspect * 34.0 - t * 2.0, uv.y * 34.0 + t * 5.0);
  float2 cell = floor(g);
  float2 at = fract(g) - 0.5 + (float2(hash(cell), hash(cell + 2.3)) - 0.5) * 0.7;
  float spark = step(0.86, hash(cell + 5.5)) * smoothstep(0.09, 0.0, length(at));
  c += float3(1.0, 0.8, 0.5) * spark * exp(-edge * 6.0) * 0.9;

  c *= 0.62 + 0.38 * smoothstep(0.95, 0.15, abs(uv.y - 0.42) * 1.6);
  return finish(c, xy);
}
`;
