/** One look, night stadium: obsidian, ivory and champagne gold. The shaders are built around it. */
const theme = {
  background: '#07080b',
  surface: 'rgba(15, 16, 21, 0.8)',
  /** For bars and anything content scrolls under, where translucency would muddy the text. */
  solid: '#0c0d12',
  text: '#f6f2e9',
  muted: '#aeaaa0',
  border: 'rgba(217, 182, 106, 0.2)',
  accent: '#dcb76c',
  accentText: '#17110a',
  live: '#ff6b5e',
  todo: '#e8c98a',
};

export type Theme = typeof theme;

export function useTheme(): Theme {
  return theme;
}
