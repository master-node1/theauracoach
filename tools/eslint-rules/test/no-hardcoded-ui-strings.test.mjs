import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, it } from 'vitest';
import rule from '../no-hardcoded-ui-strings.mjs';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run('no-hardcoded-ui-strings', rule, {
  valid: [
    'const a = <h1>{t("title")}</h1>;',
    'const a = <p className="fine-print" data-testid="me-email">{email}</p>;',
    'const a = <Text testID="save" nativeID="display-name" style={styles.x}>{t("save")}</Text>;',
    'const a = <span>{" · "}</span>;',
    'const a = <span> — </span>;',
    'const a = <Card title={t("comingSoon")} body={t("train.placeholder")} />;',
    'const a = <a href="/settings" aria-label={t("settings")} />;',
    'const a = <Icon path="M12 22s8-4 8-10V5" />;',
    'const a = <input type="radio" name="theme" value="dark" autoComplete="nickname" />;',
    'const a = <Stack.Screen name="settings" />;',
    { code: 'const a = <span>AuraCoach</span>;', options: [{ allow: ['AuraCoach'] }] },
  ],
  invalid: [
    { code: 'const a = <h1>Settings</h1>;', errors: [{ messageId: 'text' }] },
    { code: 'const a = <p>\n  Signed in as <strong>{email}</strong>\n</p>;', errors: 1 },
    { code: 'const a = <span>{"Save"}</span>;', errors: [{ messageId: 'text' }] },
    { code: 'const a = <span>{`Hi ${name}`}</span>;', errors: [{ messageId: 'text' }] },
    { code: 'const a = <span>{ok ? "Saved" : "Failed"}</span>;', errors: 2 },
    { code: 'const a = <Card title="Coming soon" />;', errors: [{ messageId: 'prop' }] },
    { code: 'const a = <Card body={"Log meals here"} />;', errors: [{ messageId: 'prop' }] },
    { code: 'const a = <a aria-label="Settings" />;', errors: [{ messageId: 'prop' }] },
    {
      code: 'const a = <Pressable accessibilityLabel="Back" accessibilityHint={hint || "Go back"} />;',
      errors: 2,
    },
    { code: 'const a = <img alt="Logo" />;', errors: [{ messageId: 'prop' }] },
    { code: 'const a = <input placeholder="Search foods" />;', errors: [{ messageId: 'prop' }] },
    {
      code: 'const a = <Widget heading="Hello" />;',
      options: [{ props: ['heading'] }],
      errors: [{ messageId: 'prop' }],
    },
  ],
});
