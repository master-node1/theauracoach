# Information Architecture and Navigation

## 1. Primary navigation

Mobile uses a bottom tab bar (5 items); web ≥ 1024 px uses a left rail with the same items; tablet uses the rail collapsed to icons.

| Tab | Purpose | Key screens |
|---|---|---|
| **Today** | What to do now | Dashboard, check-in, recommendations |
| **Train** | Workouts | Plan week, session detail, active session, exercise detail, history, substitutions |
| **Eat** | Nutrition | Day log, food search, barcode, meal plan, recipe, grocery list, water |
| **Coach** | AI conversation | Chat, proposals, conversation list |
| **Progress** | Trends | Weight, measurements, strength, consistency, calendar |

Profile and settings open from the avatar in the header (Today/Progress) — not a tab.

## 2. Site map

```text
/ (marketing, web only)
/auth: sign-in, sign-up, verify-email, reset-password
/onboarding: basics → goal → schedule → diet → safety → consents → plan-reveal
/today
/train
  /plan/:weekStart
  /session/:sessionId (overview) → /session/:sessionId/active
  /exercise/:slug
  /history
/eat
  /day/:date
  /search?meal=breakfast
  /scan
  /plan/:weekStart → /recipe/:slug → /grocery/:weekStart
/coach → /coach/:conversationId
/progress: /weight, /measurements, /strength, /consistency, /calendar
/settings: profile, goals, equipment, diet, units, notifications, reminders, integrations (P2),
           privacy (consents, export, delete), subscription (flagged), about & disclaimers
/admin (web only, RBAC): dashboard, exercises, foods, recipes, templates, prompts, policies,
       review queue, feedback, users (support view), usage & cost, audit log, roles
```

## 3. Platform conventions

| Concern | iOS | Android | Web |
|---|---|---|---|
| Back | Swipe-back, nav bar back | System back | Browser back; routes are deep-linkable |
| Tabs | Bottom tab bar | Bottom navigation bar | Left rail ≥ 1024 px, bottom bar < 768 px |
| Modals | Sheets with detents | Bottom sheets | Dialogs / side panels |
| Haptics | Set done, timer end | Same via Expo Haptics | None |
| Pickers | Wheel/date native | Material pickers | Native inputs |

## 4. Content hierarchy on Today

1. Greeting + date + check-in chip.
2. Today's workout card (start / done / rest day).
3. Nutrition ring: calories remaining, protein and fibre bars.
4. Up to 3 recommendations.
5. Weekly consistency strip.
6. Weight trend sparkline (only if ≥ 3 weigh-ins).
