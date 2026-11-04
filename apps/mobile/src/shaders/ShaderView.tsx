import { Canvas, RoundedRect, Shader, type SkRuntimeEffect } from '@shopify/react-native-skia';
import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, type GestureResponderEvent, type ViewStyle } from 'react-native';
import {
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';

type Uniform = number | readonly number[];

/**
 * Turns every shader on the screen on or off at once. A low-end phone setting, or a "reduce
 * effects" switch in Profile, would set this to false and every card freezes on one frame.
 */
export const ShaderMotion = createContext(true);

/**
 * Paints a shader behind its children, clipped to a rounded card. The shader only runs while it
 * should: it stops when the screen loses focus, when the phone asks for reduced motion, and when
 * `animated` is false (one still frame is drawn instead, which costs nothing after that).
 */
export function ShaderView({
  effect,
  uniforms,
  animated = true,
  interactive = false,
  radius = 16,
  seed = 0,
  style,
  children,
}: {
  effect: SkRuntimeEffect;
  uniforms: Record<string, Uniform>;
  animated?: boolean;
  /** Passes a `pointer` uniform (0..1) that follows a finger dragged across the card. */
  interactive?: boolean;
  radius?: number;
  /** Starting time, so cards using the same shader don't move in step. */
  seed?: number;
  style?: ViewStyle;
  children?: ReactNode;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const motionOn = useContext(ShaderMotion);
  const reducedMotion = useReducedMotion();
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const time = useSharedValue(1.5 + seed);
  const clock = useFrameCallback((frame) => {
    time.value += Math.min(frame.timeSincePreviousFrame ?? 16, 50) / 1000;
  }, false);
  const running = animated && motionOn && !reducedMotion && focused;
  useEffect(() => {
    clock.setActive(running);
  }, [clock, running]);

  // x, y in 0..1, and whether a finger is down.
  const touch = useSharedValue<[number, number, number]>([0.5, 0.5, 0]);
  const onTouch = (e: GestureResponderEvent) => {
    if (!size.width) return;
    touch.value = [
      Math.min(1, Math.max(0, e.nativeEvent.locationX / size.width)),
      Math.min(1, Math.max(0, e.nativeEvent.locationY / size.height)),
      1,
    ];
  };
  const release = () => {
    touch.value = [touch.value[0], touch.value[1], 0];
  };

  const { width, height } = size;
  const allUniforms = useDerivedValue(() => {
    const t = time.value;
    const u: Record<string, Uniform> = { ...uniforms, size: [width, height], time: t };
    if (interactive) {
      const [x, y, down] = touch.value;
      u.pointer = down ? [x, y] : [0.5 + 0.38 * Math.cos(t * 0.55), 0.5 + 0.3 * Math.sin(t * 0.8)];
    }
    return u;
  });

  return (
    <View
      style={[{ borderRadius: radius, overflow: 'hidden' }, style]}
      onLayout={(e) => setSize(e.nativeEvent.layout)}
      onStartShouldSetResponder={() => interactive}
      onMoveShouldSetResponder={() => interactive}
      onResponderGrant={onTouch}
      onResponderMove={onTouch}
      onResponderRelease={release}
      onResponderTerminate={release}
    >
      {width > 0 ? (
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <RoundedRect x={0} y={0} width={width} height={height} r={radius}>
            <Shader source={effect} uniforms={allUniforms} />
          </RoundedRect>
        </Canvas>
      ) : null}
      {children}
    </View>
  );
}
