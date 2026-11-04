import { Canvas, Fill, Shader, Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';
import { LOOKS, type LookName } from './looks';

export interface ShaderSurfaceProps {
  look: LookName;
  /** False draws one still frame, which costs nothing after that. */
  animated?: boolean;
  /** Replaces the look's colours, such as the two clubs on a match card. */
  colours?: Record<string, readonly [number, number, number]>;
  /** Starting time, so two surfaces with one look do not move in step. */
  seed?: number;
}

const effects = new Map<string, SkRuntimeEffect>();

function effectFor(source: string): SkRuntimeEffect {
  let effect = effects.get(source);
  if (!effect) {
    const made = Skia.RuntimeEffect.Make(source);
    if (!made) throw new Error('A background shader did not compile.');
    effect = made;
    effects.set(source, effect);
  }
  return effect;
}

/** These move slowly, so 24 frames a second looks the same as 60 and saves battery. */
const FRAME_MS = 1000 / 24;

/** Paints a look across its parent. Sits behind content and never takes touches. */
export default function ShaderFill({
  look,
  animated = true,
  colours,
  seed = 14,
}: ShaderSurfaceProps) {
  const { source, uniforms: base, renderScale } = LOOKS[look];
  const uniforms = { ...base, ...colours };
  const [size, setSize] = useState({ width: 0, height: 0 });
  const reducedMotion = useReducedMotion();
  const time = useSharedValue(seed);
  const pending = useSharedValue(0);

  const clock = useFrameCallback((frame) => {
    pending.value += Math.min(frame.timeSincePreviousFrame ?? 16, 100);
    if (pending.value >= FRAME_MS) {
      time.value += pending.value / 1000;
      pending.value = 0;
    }
  }, false);
  const running = animated && !reducedMotion;
  useEffect(() => {
    clock.setActive(running);
  }, [clock, running]);

  const width = size.width * renderScale;
  const height = size.height * renderScale;
  const values = useDerivedValue(() => ({
    ...uniforms,
    size: [width, height],
    time: time.value,
  }));

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.clip]}
      pointerEvents="none"
      onLayout={(e) => setSize(e.nativeEvent.layout)}
    >
      {width > 0 ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width,
            height,
            transformOrigin: 'left top',
            transform: [{ scale: 1 / renderScale }],
          }}
        >
          <Canvas style={StyleSheet.absoluteFill}>
            <Fill>
              <Shader source={effectFor(source)} uniforms={values} />
            </Fill>
          </Canvas>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ clip: { overflow: 'hidden' } });
