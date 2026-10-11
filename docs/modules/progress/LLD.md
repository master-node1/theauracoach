# Progress, Dashboard and Analytics — Low-Level Design

Service: **progress-service** · see the [service catalog](../../architecture/service-catalog.md) for owned data, events and allowed calls.

## 1. Responsibilities

Measurements, daily check-ins, dashboard aggregation, trends, strength analytics, plateau detection, weekly summaries (data side; text comes from the coach).

## 2. Calculations (`packages/domain/progress`)

- **Weight trend**: exponentially weighted moving average (α = 0.1) over daily weigh-ins (multiple per day → first of the day); weekly rate = slope of trend over last 14 days (least squares) as % bodyweight/week.
- **Goal estimate**: range only — `remaining / rate` using rate ±25% band; hidden when < 14 days of data or rate in the wrong direction; copy "If this trend continues, ≈ Dec to Jan".
- **Consistency**: completed (COMPLETED + PARTIAL×0.5) / planned sessions per ISO week; nutrition adherence = days with ≥ 3 entries and energy within ±15% of target / 7.
- **Strength**: e1RM per exercise (best set per session), weekly hard sets per muscle (sets with RPE ≥ 7 or within 3 reps of failure), PRs.
- **Plateau**: see nutrition LLD §2 (weight) and workouts (e1RM flat 4 weeks with ≥ 80% adherence → propose variation or deload).

## 3. Dashboard read model

progress-service builds `WorkoutDayFact`, `NutritionDayFact` and `ExerciseBestFact` from workout and nutrition events, so dashboard and analytics queries never call other services except for today's session detail.


`GET /v1/dashboard/today` assembles: today's session (sync `GET workout-service /internal/v1/users/{id}/week`, 300 ms timeout; on failure the card links to Train), nutrition totals vs target, protein/fibre/water, consistency strip, weight sparkline (last 30 trend points), check-in status, up to 3 recommendations (engine first, then coach tips). Cached per user 5 min; invalidated by `MealLogged`, `WorkoutCompleted`, `MeasurementAdded`, `RecommendationChanged`. p95 target 150 ms from cache, 400 ms cold.

Pending proposals come from coach-service's `RecommendationCreated` events (title and id only). Recommendation ranking (deterministic): safety notices > pending proposals > protein gap > hydration > activity nudge; at most one per category; copy templates reviewed for tone.

## 4. API

`GET /v1/dashboard/today`, `GET/POST /v1/progress/measurements`, `DELETE /v1/progress/measurements/{id}`, `GET /v1/progress/weight?range=90d`, `GET /v1/progress/strength?exerciseId=`, `GET /v1/progress/consistency?from&to`, `PUT /v1/progress/check-ins/{date}`, `GET /v1/progress/summary?period=week`.

## 5. Progress photos (P2)

Separate consent; upload via pre-signed PUT to private bucket `user-photos/{userId}/` with object-level KMS; thumbnails generated in worker; never sent to AI; deleted immediately on consent withdrawal.
