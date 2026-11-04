import { WithSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import type { ShaderSurfaceProps } from './ShaderFill';

// On the web Skia runs from CanvasKit (WebAssembly), which has to load before any Skia code.
// `pnpm --filter @season/mobile web` copies canvaskit.wasm into public/ first.
export function ShaderSurface(props: ShaderSurfaceProps) {
  return (
    <WithSkiaWeb
      opts={{ locateFile: (file) => `/${file}` }}
      getComponent={() => import('./ShaderFill')}
      fallback={null}
      componentProps={props}
    />
  );
}
