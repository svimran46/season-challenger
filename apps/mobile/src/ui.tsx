import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTheme } from './theme';

export function Screen({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <View style={[styles.screen, { backgroundColor: t.background }]}>{children}</View>;
}

export function Card({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
      {children}
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

const styles = StyleSheet.create({
  screen: { flex: 1 },
  card: { borderWidth: 1, borderRadius: 12, padding: 16, marginHorizontal: 16, marginBottom: 12 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  chipText: { fontSize: 12, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  title: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  body: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
