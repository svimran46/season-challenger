# Shader design picks

Research notes on which [Shaders](https://shaders.com) library presets suit each area of the app. Nothing here is built yet, and no preset has been exported or installed.

## Status

- **Coverage:** 1,116 presets across 212 of the library's 215 collections were crawled. About 85 finalists were compared by thumbnail. The 59 ready-made page sections were not reviewed.
- **Not yet verified:** the picks were chosen from still thumbnails. None has been seen animated, recoloured, or running on a phone.
- **Account:** the Shaders account is on the Free tier and has no saved shaders or projects.

## Constraints to settle before building

1. **The mobile app is native.** `apps/mobile` is Expo / React Native. The `shaders` package is documented only for web frameworks (React, Vue, Svelte, JS), so it cannot render in a native screen directly. It would run in the Expo web build, or inside a WebView on Android.
2. **WebGPU only.** Shaders has no WebGL fallback. Without WebGPU the canvas stays transparent and `onUnavailable` fires, so every use needs a fallback gradient or image. Support on low-end Android WebViews is unconfirmed and must be tested on a real device.
3. **Licence and cost.** 32 of the 34 presets below are Pro. Previews are public, but exporting and using Pro content requires an active Pro plan. Only 6 collections are free. The licence covers "applications" without naming mobile apps, so confirm with Shaders before shipping. Pricing was not visible to the research tools; see <https://shaders.com/pro#pricing>.
4. **Performance.** Shaders publishes no mobile figures. Animate only the sign-in hero, the live card and the win moment, and keep list backgrounds still.

## Options for the native app

| Option                                                                 | Works on low-end Android | Cost         | Trade-off                                                   |
| ---------------------------------------------------------------------- | ------------------------ | ------------ | ----------------------------------------------------------- |
| Static images or gradients styled after the picks                      | Yes                      | Free         | No animation; check the licence before using Shaders output |
| Our own effects with a native shader library such as React Native Skia | Likely; needs testing    | Dev time     | Original work, not the Shaders presets; adds a dependency   |
| Shaders inside a WebView                                               | Unconfirmed              | Pro for most | Blank without WebGPU; extra WebView cost on each screen     |

**Recommendation:** test the free `arrow-grid-2` preset in an Android WebView on a cheap phone before paying for Pro. If it stays blank, Pro will not fix that, so use static images or native shaders and treat this list as art direction.

## Picks

All picks are in the `background` category except `holofoil-4`, which is `logo` and needs an SVG crest. Each link redirects to the preset's public preview page.

Colours: navy `#0b1120` and green `#22c55e` match the dark theme in `apps/mobile/src/theme.ts`. Gold `#facc15` was part of the research brief and is not in the theme yet.

| App area           | Best pick                                                          | Runner-up                                                                 | Colour changes                                         | Why it fits                                                       |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| Sign-in hero       | [color-stream-8](https://shaders.com/p/color-stream-8)             | [synthesis-5](https://shaders.com/p/synthesis-5)                          | Base navy, glow green, small gold accent               | Looks like floodlight rising over a dark pitch                    |
| Matches list       | [dot-panels-2](https://shaders.com/p/dot-panels-2)                 | [specular-lines-6](https://shaders.com/p/specular-lines-6)                | Base navy, dots dim green                              | Barely visible, so text stays clear                               |
| Match card         | [retro-gridscape-2](https://shaders.com/p/retro-gridscape-2)       | [lit-rays-2](https://shaders.com/p/lit-rays-2)                            | Lines green, sky navy                                  | Perspective grid reads as a pitch; text goes in the dark top half |
| Tournaments list   | [ascii-tunnel-3](https://shaders.com/p/ascii-tunnel-3)             | [arrow-grid-2](https://shaders.com/p/arrow-grid-2) (free)                 | Already green and gold; base navy                      | Lines pull inward, like a road to the final                       |
| Live tournament    | [undertones-5](https://shaders.com/p/undertones-5)                 | [comet-streaks-1](https://shaders.com/p/comet-streaks-1)                  | Keep red-orange, base navy                             | Fast slashes feel urgent, and red marks it as live                |
| Wallet header      | [color-stream-10](https://shaders.com/p/color-stream-10)           | [hex-path-3](https://shaders.com/p/hex-path-3)                            | Base navy, glow gold                                   | Warm corner glow leaves room for the balance                      |
| Daily reward       | [fireworks-3](https://shaders.com/p/fireworks-3)                   | [traced-paths-4](https://shaders.com/p/traced-paths-4)                    | Base navy, rays gold                                   | A small burst, smaller than the win moment                        |
| Tier: Scout        | [drifting-contours-3](https://shaders.com/p/drifting-contours-3)   | [geogrid-9](https://shaders.com/p/geogrid-9)                              | Base navy, lines green; must be darkened               | Map contours suit scouting                                        |
| Tier: Analyst      | [hex-path-7](https://shaders.com/p/hex-path-7)                     | [enter-the-matrix-2](https://shaders.com/p/enter-the-matrix-2)            | Cyan to green                                          | Glowing cells feel like data                                      |
| Tier: Tactician    | [outshine-4](https://shaders.com/p/outshine-4)                     | [lost-rays-8](https://shaders.com/p/lost-rays-8)                          | Base navy, rings green                                 | Linked rings suggest a formation                                  |
| Tier: Master       | [digital-activation-8](https://shaders.com/p/digital-activation-8) | [hex-path-3](https://shaders.com/p/hex-path-3)                            | Already gold on near-navy                              | A gold dotted sphere, like a ball                                 |
| Tier: Grandmaster  | [royal-purple-1](https://shaders.com/p/royal-purple-1)             | [color-eclipse-5](https://shaders.com/p/color-eclipse-5)                  | Keep purple, add gold glint                            | A gem, and the only tier off-palette, so it feels rare            |
| Pre-match analysis | [deep-signal-1](https://shaders.com/p/deep-signal-1)               | [rolling-shadows-9](https://shaders.com/p/rolling-shadows-9)              | Keep navy, lines dim blue                              | Quiet fine lines, the calmest pick here                           |
| Player cards       | [holographic-waves-3](https://shaders.com/p/holographic-waves-3)   | [holofoil-4](https://shaders.com/p/holofoil-4)                            | Common silver, rare green, epic purple, legendary gold | Foil look; one preset covers all rarities; text on a dark panel   |
| Vouchers shop      | [slide-press-6](https://shaders.com/p/slide-press-6)               | [stretched-chevrons-6](https://shaders.com/p/stretched-chevrons-6) (free) | Gold chevron, white to navy                            | Bold arrow shape feels like a ticket                              |
| Profile header     | [color-eclipse-1](https://shaders.com/p/color-eclipse-1)           | [northern-lights-2](https://shaders.com/p/northern-lights-2)              | Base navy, ring green and gold                         | The avatar fits inside the dark disc                              |
| Win moment         | [fireworks-6](https://shaders.com/p/fireworks-6)                   | [radial-overlap-9](https://shaders.com/p/radial-overlap-9)                | Base navy, rays gold and green                         | Full burst on a near-navy base                                    |

## Rejected

- `smokescreen-2`: matches the palette on paper but renders bright green, so text would not read over it.
- The `image-effects` category: these effects need a photo as input.
