# Content style guide

How AuraCoach writes: every screen, error, notification, email and AI coach reply. It applies to English (en-IN) now and to Hindi and other languages when they arrive (P2). The rules that code can check live as data in [`packages/i18n/src/style.ts`](../../packages/i18n/src/style.ts); this guide explains them.

Related: [Design system](design-system.md) (principle 2, "Encourage, never shame"; principle 3, "Show uncertainty") · [Personas](personas.md) · [Safety rules in the AI coach LLD](../modules/ai-coach/LLD.md).

## 1. Voice

We sound like a good trainer who is also a friend: warm, plain, practical and honest.

| We are | We are not |
|---|---|
| Supportive: "Nice, that's 3 sessions this week." | Cheerleading: "AMAZING!!! You're a BEAST!" |
| Direct: "Add a katori of dal to reach your protein." | Vague: "Consider optimising your macros." |
| Honest about uncertainty: "≈ 450 kcal, based on a standard katori." | Falsely precise: "452.37 kcal." |
| Respectful of choices: "Want a lighter option?" | Judgemental: "That was a bad choice." |

The user can pick a **Supportive** or **Direct** coach tone in Settings. Both follow every rule here; Direct only means shorter and fewer softeners.

## 2. Tone by moment

| Moment | Tone | Example |
|---|---|---|
| Onboarding | Welcoming, brief, explains why we ask | "We ask your age to keep your plan safe. You must be 18 or over." |
| Daily logging | Quick, neutral, no commentary on food | "Logged. 2 rotis, dal." |
| Hitting a goal | Warm, specific, not over the top | "New best: 60 kg squat for 5. Strong work." |
| Missed day or over target | Neutral and forward-looking, never blaming | "Life happens. Let's pick up with tomorrow's session." |
| Errors | Says what happened and what to do; never blames the user | "Could not save. Check your connection and try again." |
| Safety | Calm, clear, action first | "Stop this exercise. If you have chest pain or feel faint, call 112." |

## 3. Banned phrases

These never appear in the catalogue, in coach replies, in notifications or in emails. The full list, with patterns, reasons and suggested alternatives, is `BANNED_PHRASES` in `packages/i18n/src/style.ts`: a catalogue test fails on a hit, and the coach post-check (TAC-26) uses the same list on every AI reply.

| Category | Never say | Say instead |
|---|---|---|
| Guarantees | "guaranteed", "lose 5 kg in 2 weeks", "100% results", "risk-free", "miracle", "fat-burning tea" | "A steady pace is about 0.25–0.5 kg a week." |
| Diagnosis and treatment | "you have PCOS", "this cures diabetes", "reverse your thyroid", "stop taking your medication" | "That's worth checking with a doctor. I can help you train around it." |
| Shaming | "cheat day", "guilt-free", "bad food", "beach body", "no excuses", "you failed", "burn it off" | "A bigger meal", "a treat"; talk about strength, energy and the user's own goal. |
| Extreme restriction | "starve", "crash diet", "detox", "cleanse", "skip meals", "no pain, no gain" | A small, safe change, never below the calorie floor; "Stop if it hurts." |
| Pressure | "last chance", "act now", "don't miss out", "you'll regret it" | State the facts and let the user decide. |

We may say "not medical advice" and "talk to your doctor"; those are disclaimers, not claims.

## 4. Numbers and estimates

- **Engines own the numbers** (ADR-004). Copy and the AI explain them; they never invent them.
- **Estimates start with "≈"**, joined to the number by a no-break space: "≈ 450 kcal", "≈ 1,800–2,000 kcal". Do not use "~", "about" or "approx." in front of a number. Use `formatEnergy(..., { estimate: true })` or `formatRange`.
- **Show confidence where it matters**: food estimates from a photo or a vague portion carry a confidence badge (design system principle 3), and the copy says what the estimate is based on: "based on 1 standard katori (150 g)".
- **Round for humans**: kcal to the nearest whole number, grams to whole numbers, body weight to 0.1 kg / 0.1 lb, height to whole cm or whole inches.
- **Ranges** use an en dash with no spaces and one unit at the end: "6–8 weeks", "1,800–2,000 kcal".

## 5. Indian English conventions

- **Spelling**: British (colour, fibre, metre, practise as a verb). Dates as "27 October 2026" or "Tue, 27 Oct".
- **Numbers**: Indian grouping (12,34,567) through `formatNumber`; say "lakh" and "crore" only in money contexts. Money is "₹1,299" with no paise for whole amounts (`formatInr`).
- **Time**: 12-hour clock with lower-case "am"/"pm" ("7:30 am"), always in the user's own time zone from their profile (`formatTime`, `localDay`).
- **Food words**: use the names people use: roti, dal, sabzi, dosa, idli, poha, curd (not "yoghurt"), katori, glass. Indian portions first (1 katori, 2 rotis), grams in brackets.
- **Diets**: Vegetarian, Eggetarian, Non-vegetarian, Vegan, Jain, Pescatarian, as the user chose them. Never treat vegetarian as a restriction to work around.
- **Plain words**: "check-in" not "biometric update"; "rest day" not "deload protocol" unless the user is advanced.

## 6. Units and formatting

Values are stored metric and shown in the user's unit preference (Settings → Units). Use the helpers in `packages/i18n/src/format.ts`, never hand-built strings:

| Quantity | Metric | Imperial | Helper |
|---|---|---|---|
| Body weight, loads | 72.5 kg | 159.8 lb | `formatWeight` |
| Height | 175 cm | 5 ft 9 in | `formatHeight` |
| Body measurements | 82 cm | 32.3 in | `formatLength` |
| Water | 750 ml, 2.5 L | 25 fl oz | `formatVolume` |
| Food energy | kcal in both | | `formatEnergy` |
| Protein, carbs, fat, fibre | g in both | | `formatGrams` |

A number and its unit are joined with a no-break space so they never wrap apart. Dates, times and "today" always use the user's saved time zone (`formatDate`, `formatTime`, `localDay`), not the server's or the device's.

## 7. Notifications

- **Lock-screen safe**: the title and the first line of a push or email subject never reveal health details: no weight, calories, body measurements, injuries, pregnancy, periods, medication, conditions, or "missed"/"behind". `lockScreenIssues(text)` in `style.ts` returns the offending terms; TAC-30 runs it on every template.
  - Yes: "Your workout is ready." · "Time for lunch. Tap to log it." · "Your weekly summary is in."
  - No: "Log your weight (72.5 kg yesterday)." · "You're 300 kcal over." · "You missed 3 workouts."
- One idea per notification, under 60 characters for the title, with a clear action.
- Never guilt-trip and never use urgency (§3 "Pressure"). Quiet hours and frequency caps are respected ([notifications LLD](../modules/notifications/LLD.md)).

## 8. Safety wording

- Safety messages lead with the action: "Stop this exercise." then the reason.
- Emergency symptoms (chest pain, fainting, severe shortness of breath) always point to **112** (India's emergency number) or local emergency services.
- Pre-exercise screening flags (pregnancy, heart condition, recent surgery, eating-disorder history) use "We'll keep your plan gentle and suggest checking with your doctor" rather than refusing service or alarming the user.
- Persistent footer wording: "Fitness guidance only, not medical advice."
- The coach never diagnoses, prescribes or changes medication (§3 "Diagnosis and treatment"). It says what it can do instead.

## 9. Accessibility copy

- **Every control has a name**: icon buttons get `aria-label` (web) or `accessibilityLabel` (mobile) from the catalogue, e.g. the avatar button is "Settings", the back arrow is "Back".
- **Labels describe the thing, not the gesture**: "Display name", not "Tap to edit name". Hints (`accessibilityHint`) say what happens: "Choose your time zone".
- **Errors** say what went wrong and how to fix it, are announced (`role="alert"` / `accessibilityRole="alert"`), and do not rely on colour alone.
- **No text in images**. Charts get a text summary: "Weight down 1.2 kg over 4 weeks."
- **Reading level**: aim for short sentences (under 20 words) and everyday words; screen readers read the whole label, so keep labels short.
- **Capitals**: sentence case everywhere. Section headings that are visually upper-case are written in sentence case and transformed in code (`toLocaleUpperCase(locale)`), so screen readers do not spell them out.

## 10. Writing strings in code

1. Every user-facing string lives in the catalogue (`packages/i18n/src/messages/en-IN.ts`), grouped by screen. Web uses `useTranslations`/`getTranslations` from next-intl; mobile uses `useTranslations` from `src/i18n.tsx`. Keys are type-checked.
2. Use ICU syntax for variables, plurals and choices: `"{count, plural, one {# set} other {# sets}}"`, never string concatenation. Use rich-text tags (`<strong>{email}</strong>`) for emphasis.
3. The ESLint rule `aura/no-hardcoded-ui-strings` fails on text in JSX and on literal strings in props people read or hear (`title`, `label`, `aria-label`, `accessibilityLabel`, `placeholder`, ...). Test ids, class names and routes are not affected.
4. Check layouts with the **en-XA pseudo-locale** (accented, ~40% longer): on the web set `I18N_PSEUDO_LOCALE=true` and the cookie `aura-locale=en-XA` (the Playwright pseudo-locale spec does this); on mobile run with `EXPO_PUBLIC_LOCALE=en-XA`. Text must wrap, not clip.
5. Leave room: buttons and tabs must survive 40% longer text and Devanagari's taller line height.

## 11. Review checklist

- [ ] Plain words, short sentences, sentence case
- [ ] No banned phrase (§3); the catalogue test passes
- [ ] Estimates use "≈" and the format helpers (§4, §6)
- [ ] Indian conventions for numbers, money, dates and food (§5)
- [ ] Notifications are lock-screen safe (§7)
- [ ] Safety wording follows §8
- [ ] Controls and errors have accessible names (§9)
- [ ] Renders in en-XA without clipping (§10)
