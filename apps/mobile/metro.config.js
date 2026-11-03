// Expo's default config already understands pnpm workspaces and resolves the
// TypeScript source that @season/* packages ship.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
