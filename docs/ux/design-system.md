# Design System — "Aura"

Implemented once as tokens in `packages/ui-tokens` (source: [tokens.json](tokens.json); approved screens: [high-fidelity designs](hifi-designs.md)) (JSON → CSS variables for web, TS constants for React Native). Components live in `packages/ui` with web (`react-dom`) and native (`react-native`) renderers sharing props and behaviour.

## 1. Principles

1. **One next action.** Every screen leads with the single most useful action.
2. **Encourage, never shame.** No red for missed days; neutral grey and "let's pick up tomorrow".
3. **Show uncertainty.** Estimates carry "≈" and a confidence badge.
4. **Thumb-first.** Primary actions in the bottom 40% on mobile; touch targets ≥ 48 × 48 dp.
5. **Calm density.** Max 3 data visualisations above the fold.

## 2. Tokens

### Colour (semantic; light / dark)

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#FAFAF7` | `#0F1115` | App background |
| `surface` | `#FFFFFF` | `#181B21` | Cards |
| `surface-2` | `#F1F2EE` | `#21252D` | Inputs, chips |
| `text` | `#16181D` | `#ECEDEF` | Body |
| `text-muted` | `#5B606B` | `#A3A8B3` | Secondary |
| `primary` | `#0E7C66` | `#38C6A5` | Primary actions, progress |
| `on-primary` | `#FFFFFF` | `#06231D` | Text on primary |
| `accent` | `#E07A2E` | `#F29A57` | Highlights, PRs |
| `protein` | `#3D5AFE` | `#8C9EFF` | Protein series |
| `carbs` | `#C77800` | `#FFB74D` | Carbs series |
| `fat` | `#8E44AD` | `#CE93D8` | Fat series |
| `fibre` | `#2E7D32` | `#81C784` | Fibre series |
| `info` | `#1565C0` | `#64B5F6` | Info banners |
| `warning` | `#9A6700` | `#F2C94C` | Caution |
| `danger` | `#B3261E` | `#F2B8B5` | Errors and safety only |
| `border` | `#DADCD6` | `#2E333C` | Dividers |

All text/background pairs meet WCAG AA (4.5:1 body, 3:1 large text and UI). Charts never rely on colour alone: series also differ by pattern or direct label.

### Typography

Font: **Inter** (Latin) with **Noto Sans Devanagari** fallback for P2 Hindi. Scale (rem / sp): display 2.0, h1 1.5, h2 1.25, h3 1.125, body 1.0, small 0.875, caption 0.75. Line height 1.4 body, 1.2 headings. Numbers use tabular figures. Respect OS dynamic type up to 200%.

### Spacing, radius, elevation, motion

- Spacing scale (4-pt): 0, 4, 8, 12, 16, 24, 32, 48, 64.
- Radius: 8 (inputs), 12 (cards), 999 (chips, rings).
- Elevation: 0 flat, 1 card, 2 sheet, 3 dialog. Dark mode uses lighter surfaces instead of shadows.
- Motion: 150 ms micro, 250 ms transitions, ease-out; honour reduce-motion (disable confetti, ring animation).

### Iconography

Lucide icon set (MIT) on web and native via `lucide-react` / `lucide-react-native`; 24 px default, 1.75 stroke. Exercise muscle maps are custom SVG.

## 3. Components

| Component | Variants / notes |
|---|---|
| Button | primary, secondary, ghost, destructive; sizes md/lg; loading state keeps width |
| IconButton | requires `accessibilityLabel` |
| Card | default, interactive, highlighted (today) |
| ListItem | leading icon/avatar, trailing value/chevron |
| TextField, NumberField | label always visible, helper, error; unit suffix (kg, cm) |
| Stepper | for reps/load with long-press acceleration |
| SegmentedControl | units, meal slots |
| Chip / FilterChip | diet tags, equipment |
| ProgressRing | calories; centre label "≈ 640 left" |
| MacroBar | protein/carbs/fat/fibre with target tick |
| RestTimer | circular, +15 s / skip, haptic + sound + screen-reader announcement |
| SetRow | set #, target, reps, load, RPE, done |
| ConfidenceBadge | high / medium / low with tooltip explaining source |
| ProposalCard | coach proposal: what changes, why, accept/decline |
| ChatBubble | user, coach, system notice; streaming caret |
| Chart: LineTrend | weight with 7-day moving average band |
| Chart: BarWeekly | volume, consistency |
| EmptyState, ErrorState, OfflineBanner, Skeleton, Toast | see §5 |
| Sheet / Dialog | focus-trapped, escape closes |

Charts: Victory Native (mobile) and Recharts (web) wrapped by one `@aura/charts` API so data shaping is shared.

## 4. Layouts

| Breakpoint | Width | Layout |
|---|---|---|
| Mobile | < 768 | Single column, bottom tabs |
| Tablet | 768–1023 | Two columns on Today/Progress, rail icons |
| Desktop | ≥ 1024 | Rail + 12-col grid, max content 1200 px; chat as right panel on Train/Eat |

## 5. States

| State | Pattern |
|---|---|
| Loading | Skeletons matching final layout; never block > 300 ms without a skeleton |
| Empty | Illustration + one sentence + primary action ("Log your first meal") |
| Error | Plain-language cause, retry, support link; keep user input |
| Offline | Top banner; queued count; disabled actions explain why |
| Success | Toast 3 s, or inline check; PR celebration respects reduce-motion |
| AI unavailable | Coach banner "Coach is resting — your plan and logs still work" |
| Partial data | Charts show gaps, not interpolated lines |

## 6. Accessibility

- WCAG 2.2 AA on web; automated axe checks in CI and manual VoiceOver/TalkBack passes per release.
- Every interactive element has role, name, state. Rings and charts expose text summaries ("Protein 82 of 120 grams").
- Keyboard: full tab order, visible focus ring (2 px `primary` + offset), skip-to-content, shortcuts in active session (Space = set done, R = rest +15 s).
- Rest timer announces at 10 s and 0 s via live region / `AccessibilityInfo.announceForAccessibility`.
- Minimum touch target 48 dp; spacing ≥ 8 dp between targets.
- Captions and transcripts for all exercise videos.
- Language that is plain (reading age ~12), no body-shaming terms, gender-neutral by default.

## 7. Content style

The full rules are in the [content style guide](content-style-guide.md); the essentials:

- "You've done 2 of 3 sessions this week" not "You missed 1".
- Numbers: "≈ 1,850 kcal" for estimates; exact only for user-entered values.
- Safety copy reviewed by a qualified professional before launch.
