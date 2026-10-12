// Metro for the pnpm monorepo: Expo's default config already watches the workspace root and
// resolves symlinked workspace packages (@aura/*), which are consumed from their built dist.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
