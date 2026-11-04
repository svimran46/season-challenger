import { WithSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import { Loading } from '../ui';

// On the web Skia runs from CanvasKit (WebAssembly), which has to load before any shader code.
// `pnpm --filter @season/mobile web` copies canvaskit.wasm into public/ first.
export function ShaderLabHost() {
  return (
    <WithSkiaWeb
      opts={{ locateFile: (file) => `/${file}` }}
      getComponent={() => import('./ShaderLab')}
      fallback={<Loading />}
    />
  );
}
