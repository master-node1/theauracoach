# Notifications and Integrations — Low-Level Design

Service: **notification-service** · see the [service catalog](../../architecture/service-catalog.md) for owned data, events and allowed calls.

## 1. Inputs

notification-service needs no sync calls. It keeps `NotificationPreference` (with a copy of timezone and notification consent from `UserRegistered` / `ConsentChanged`), training schedule from `PlanCreated` / `PlanWeekReady`, and `SuppressionFact` rows from `WorkoutCompleted` and `MealLogged`.

## 2. Scheduling

BullMQ queues: `notifications.schedule` (repeatable per-user jobs computed nightly for the next 36 h), `notifications.send` (delayed jobs), `notifications.receipts` (Expo receipt polling).

Nightly planner (per user, in user timezone) creates `Notification` rows with a `dedupeKey` (`workout_reminder:2026-10-12`) → unique constraint prevents duplicates across retries and multiple workers.

| Type | When | Suppressed if |
|---|---|---|
| workout_reminder | preferred time on training days (default 30 min before) | session already started/completed, quiet hours |
| meal_reminder | user-chosen slots (max 3/day) | slot already logged |
| weekly_summary | Sunday 09:00 | user opted out |
| inactivity | after 3 days without any log, max `inactivityNudges` per week, never 2 days in a row | opted out, pending deletion |
| plan_ready | after weekly adaptation | — |

## 3. Delivery

`send` job: load notification → re-check suppression → render template (i18n, tone-reviewed, no health details on lock screen: "Your workout is ready" not "Leg day for your knee injury") → Expo Push (APNs/FCM) or SES email → update status. Retries: 3 with exponential backoff (30 s, 2 min, 10 min); `DeviceNotRegistered` receipts remove the token. In-app inbox always written.

Idempotency: job id = notification id; status transitions guarded (`SCHEDULED → SENT|FAILED|SUPPRESSED|CANCELLED` only).

## 4. Preferences

`GET/PATCH /v1/me/notification-preferences` (reminder toggles, times, quiet hours, inactivity frequency), `POST/DELETE /v1/me/devices`. `GET /v1/notifications` (inbox), `POST /v1/notifications/{id}/read`.

## 5. Health integrations (P2)

Owned by progress-service. Mobile reads HealthKit / Health Connect on device (steps, sleep, resting HR, workouts) with explicit per-type permission, and posts daily aggregates to `POST /v1/integrations/{provider}/sync` (idempotent by date + type). Only aggregates stored (`DailyCheckIn.steps`, `sleepHours`, `BodyMeasurement` with `source`). Disconnect deletes imported data on request.
