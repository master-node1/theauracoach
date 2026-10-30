# @aura/i18n

Message catalogues and formatting shared by `apps/web` (next-intl) and `apps/mobile` (use-intl). Rules for the words themselves: [content style guide](../../docs/ux/content-style-guide.md).

- `src/messages/en-IN.ts`: the source catalogue, ICU MessageFormat, grouped by screen. Its type (`Messages`) makes every `t('...')` key type-checked in both apps.
- `src/locales.ts`: supported locales (en-IN now, Hindi in P2), `resolveLocale` and the `en-XA` pseudo-locale.
- `src/pseudo.ts`: pseudo-localisation that keeps ICU arguments, plural/select branches and rich-text tags intact.
- `src/format.ts`: metric/imperial conversion and display, "≈" estimates, ₹ with Indian grouping, dates and days in the user's time zone.
- `src/style.ts`: banned phrases and lock-screen terms as data, for catalogue tests, the coach post-check (TAC-26) and notification templates (TAC-30).

## Adding a string

1. Add the key to `en-IN.ts` under its screen.
2. Use it: `const t = useTranslations('settings'); t('displayName')`; server components on the web use `await getTranslations()`.
3. `pnpm --filter @aura/i18n test` checks it is valid ICU, uses no banned phrase, and still formats in en-XA.

## Adding a locale

Add a catalogue typed as `Messages`, list it in `SUPPORTED_LOCALES`, return it from `messagesFor`, and run the apps in it and in en-XA to check layouts.
