import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ShaderSurface } from './shaders/ShaderSurface';
import type { LookName } from './shaders/looks';
import { font, useTheme } from './theme';

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Card({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
      {children}
    </View>
  );
}

/** A headline card cast in liquid metal. The veil keeps text readable over its highlights. */
export function MetalCard({ look, children }: { look: LookName; children: ReactNode }) {
  const t = useTheme();
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return (
    <View style={[styles.metal, { borderColor: t.border }]}>
      <ShaderSurface look={look} animated={focused} />
      <View style={styles.veil} />
      <View style={styles.metalBody}>{children}</View>
    </View>
  );
}

/** A club's badge until licensed crests exist: its short name on its kit colour. */
export function ClubCrest({
  shortName,
  colour,
  size = 52,
}: {
  shortName: string;
  colour: string;
  size?: number;
}) {
  return (
    <View
      style={[
        styles.crest,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: colour },
      ]}
    >
      <Text style={[styles.crestText, { fontSize: size * 0.27 }]}>{shortName}</Text>
    </View>
  );
}

/** A thin gold gauge, for how full something is. */
export function Gauge({ share }: { share: number }) {
  const t = useTheme();
  return (
    <View style={[styles.gauge, { backgroundColor: t.border }]}>
      <View
        style={[
          styles.gaugeFill,
          { backgroundColor: t.accent, width: `${Math.round(Math.min(1, share) * 100)}%` },
        ]}
      />
    </View>
  );
}

export function Chip({ label, tone }: { label: string; tone: 'done' | 'todo' | 'live' | 'muted' }) {
  const t = useTheme();
  const colour = { done: t.accent, todo: t.todo, live: t.live, muted: t.muted }[tone];
  return (
    <View style={[styles.chip, { borderColor: colour }]}>
      <Text style={[styles.chipText, { color: colour }]}>{label}</Text>
    </View>
  );
}

export function Loading() {
  const t = useTheme();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={t.accent} />
    </View>
  );
}

export function Message({ title, body }: { title: string; body?: string }) {
  const t = useTheme();
  return (
    <View style={styles.center}>
      <Text style={[styles.title, { color: t.text }]}>{title}</Text>
      {body ? <Text style={[styles.body, { color: t.muted }]}>{body}</Text> : null}
    </View>
  );
}

export function Button({
  label,
  onPress,
  disabled,
  busy,
  kind = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  kind?: 'primary' | 'secondary';
}) {
  const t = useTheme();
  const primary = kind === 'primary';
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? (off ? t.border : t.accent) : 'transparent',
          borderColor: primary ? 'transparent' : off ? t.border : t.accent,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? t.accentText : t.accent} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            { color: primary ? (off ? t.muted : t.accentText) : off ? t.muted : t.accent },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** Two or more options side by side, one selected. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.segmented, { borderColor: t.border, backgroundColor: t.surface }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, on && { backgroundColor: t.accent }]}
          >
            <Text style={{ color: on ? t.accentText : t.text, fontWeight: '600' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.sectionTitle, { color: t.accent }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  crest: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.34)',
  },
  crestText: { color: '#ffffff', fontFamily: font.heavy, letterSpacing: 0.3 },
  gauge: { height: 4, borderRadius: 2, overflow: 'hidden' },
  gaugeFill: { height: 4, borderRadius: 2 },
  metal: {
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#14100a',
  },
  veil: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(5, 5, 7, 0.58)' },
  metalBody: { padding: 18 },
  button: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 46,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 15, fontFamily: font.title },
  segmented: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 10,
    padding: 3,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  sectionTitle: {
    fontSize: 12,
    fontFamily: font.title,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
  },
  screen: { flex: 1 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, marginHorizontal: 16, marginBottom: 12 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  chipText: { fontSize: 12, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  title: { fontSize: 17, fontFamily: font.title, textAlign: 'center' },
  body: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
