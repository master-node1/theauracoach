# Notifications and Integrations — Low-Level Design

## 1. Scheduling

BullMQ queues: `notifications.schedule` (repeatable per-user jobs computed nightly for the next 36 h), `notifications.send` (delayed jobs), `notifications.receipts` (Expo receipt polling).

Nightly planner (per user, in user timezone) creates `Notification` rows with a `dedupeKey` (`workout_reminder:2026-10-12`) → unique constraint prevents duplicates across retries and multiple workers.

| Type | When | Suppressed if |
|---|---|---|
| workout_reminder | preferred time on training days (default 30 min before) | session already started/completed, quiet hours |
| meal_reminder | user-chosen slots (max 3/day) | slot already logged |
| weekly_summary | Sunday 09:00 | user opted out |
| inactivity | after 3 days without any log, max `inactivityNudges` per week, never 2 days in a row | opted out, pending deletion |
| plan_ready | after weekly adaptation | — |

## 2. Delivery

`send` job: load notification → re-check suppression → render template (i18n, tone-reviewed, no health details on lock screen: "Your workout is ready" not "Leg day for your knee injury") → Expo Push (APNs/FCM) or SES email → update status. Retries: 3 with exponential backoff (30 s, 2 min, 10 min); `DeviceNotRegistered` receipts remove the token. In-app inbox always written.

Idempotency: job id = notification id; status transitions guarded (`SCHEDULED → SENT|FAILED|SUPPRESSED|CANCELLED` only).

## 3. Preferences

`GET/PATCH /v1/me/preferences` (reminder toggles, times, quiet hours, inactivity frequency). `GET /v1/notifications` (inbox), `POST /v1/notifications/{id}/read`.

## 4. Health integrations (P2)

Mobile reads HealthKit / Health Connect on device (steps, sleep, resting HR, workouts) with explicit per-type permission, and posts daily aggregates to `POST /v1/integrations/{provider}/sync` (idempotent by date + type). Only aggregates stored (`DailyCheckIn.steps`, `sleepHours`, `BodyMeasurement` with `source`). Disconnect deletes imported data on request.
