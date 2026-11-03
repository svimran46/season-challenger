import { useColorScheme } from 'react-native';

const light = {
  background: '#f6f7f9',
  surface: '#ffffff',
  text: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  accent: '#16a34a',
  accentText: '#ffffff',
  live: '#dc2626',
  todo: '#f59e0b',
};

const dark: typeof light = {
  background: '#0b1120',
  surface: '#111827',
  text: '#f1f5f9',
  muted: '#94a3b8',
  border: '#1f2937',
  accent: '#22c55e',
  accentText: '#04130a',
  live: '#f87171',
  todo: '#fbbf24',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
