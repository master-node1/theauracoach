import noHardcodedUiStrings from './no-hardcoded-ui-strings.mjs';

/** Local ESLint plugin: `aura/<rule>` in eslint.config.mjs. */
export default {
  meta: { name: '@aura/eslint-rules' },
  rules: { 'no-hardcoded-ui-strings': noHardcodedUiStrings },
};
