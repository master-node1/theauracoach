# High-Fidelity Designs

Status: **Approved by the product owner on 2026-10-12** ([TAC-3](https://harisireddi7776.atlassian.net/browse/TAC-3)).

**Interactive designs:** https://claude.ai/artifact/4fHVe5YXUBpD55Jd2ZqX3g (private claude.ai design canvas; ask the owner for access). Press Play on any screen to click through it; each screen has a dark-mode switch under Tweaks.

These designs replace the [low-fidelity wireframes](wireframes.md) as the reference for building screens. They use the tokens in [tokens.json](tokens.json) and the components in the [component inventory](component-inventory.md). Sample content is India-first (Indian dishes, metric units, en-IN) for a demo user, "Priya"; the free beta has no subscription UI.

## Screens

| Ref | Screen | Mobile (iOS / Android) | Web |
|---|---|---|---|
| W1 | Welcome and sign-in (Apple, Google, email) | ✓ | — |
| W2 | Onboarding step: main goal | ✓ | — |
| W3 | Safety screening, gentler-plan notice on any "yes" | ✓ | — |
| W4 | Plan reveal with "Why these numbers?" | ✓ | — |
| W5 | Today | ✓ (iOS, Android Material, dark) | ✓ (light, dark, coach side panel) |
| — | Train: this week | ✓ | ✓ |
| W6 | Active session: set rows, rest timer, swap, pain | ✓ (light, dark) | — (sessions run on the phone) |
| W7 | Exercise detail: how to, mistakes, variants | ✓ | — |
| W8 | Eat: day log, macros, water | ✓ (light, dark) | ✓ |
| W9 | Food search and quantity sheet with confidence | ✓ | quick add on Eat |
| W10 | Meal plan and recipe, grocery list | ✓ | — |
| W11 | Coach chat with accept/decline proposal | ✓ (light, dark) | ✓ |
| W12 | Progress: weight trend, body, strength, habits | ✓ | ✓ |
| W13 | Settings | ✓ | — |
| W14 | Admin dashboard (web only, RBAC) | — | ✓ |

## Decisions shown in the designs

- Navigation: five tabs (Today, Train, Eat, Coach, Progress); profile and settings from the avatar. Web uses a left rail that stacks above the content on narrow screens.
- Android uses Material conventions: navigation bar with a pill indicator and an extended FAB for "Log food". iOS uses the tab bar and sheets.
- Estimates carry "≈" and a confidence badge with the data source; weight projections are a range ("December to January"), never a date.
- Coach changes are proposals the user accepts or declines; the coach never edits the plan on its own (ADR-004).
- Encouraging copy: "2 of 3 sessions", never "missed"; red is reserved for errors and destructive actions.

## Placeholders still to produce

Exercise videos and photos, food photography, logo and final brand name, illustrations for empty states. User testing with 5–6 target users (delivery plan, Phase 2) has not been run yet.
