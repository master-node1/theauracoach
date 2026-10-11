# Onboarding and Assessment — Low-Level Design

Service: **profile-service (orchestrator), with workout-service and nutrition-service** · see the [service catalog](../../architecture/service-catalog.md) for owned data, events and allowed calls.

## 1. Flow state

Draft answers saved per step (`PUT /v1/onboarding/draft`, Redis 7 days) so users can resume on another device. `POST /v1/onboarding/complete` validates the full payload with the shared Zod schema and runs as a saga orchestrated by profile-service ([catalog §6.1](../../architecture/service-catalog.md#61-onboarding-saga-orchestrated-by-profile-service)):

1. **profile-service, one local transaction:** Profile + preferences, `SafetyScreening` → flags → `intensityCap`, `HealthCondition` rows, `FitnessGoal`, `FitnessAssessment` (BMI, BMR, TDEE, safe rate), `Onboarding.status = PLANNING`, outbox `OnboardingCompleted` (snapshot of everything workout and nutrition need) and `ProfileChanged`.
2. **In parallel, synchronous with 2 s timeouts:** `POST workout-service /internal/v1/plans` (plan generator, first two weeks materialised) and `POST nutrition-service /internal/v1/targets` (targets engine), both keyed by `onboardingId`.
3. Both succeed → `status = READY`, respond `201` with assessment, plan summary and targets.
4. Either fails or times out → respond `202 { status: "PLANNING" }`. Both services also consume `OnboardingCompleted` and complete idempotently; the app polls `GET /v1/onboarding/status` (or receives the result on its next `GET /v1/me`). profile-service marks READY when it sees `PlanCreated` and `TargetsSet`.
5. notification-service schedules initial reminders when it sees `PlanCreated`.

Idempotent end to end with `Idempotency-Key` on the public call and `onboardingId` on internal calls and events; a second call returns the existing result. No step is ever rolled back across services: a plan or target that fails validation is regenerated from the safe default template, never left missing.

## 2. Screening questionnaire (v1)

PAR-Q+ general questions (7): heart condition / prescribed activity only by doctor; chest pain at rest or in activity; loss of balance/dizziness or loss of consciousness in last 12 months; diagnosed chronic condition (other than heart/blood pressure); prescribed medication for a chronic condition; bone/joint/soft tissue problem made worse by activity; told to only do medically supervised activity. Plus: pregnant or postpartum < 6 months; current injuries (multi-select with severity).

Mapping: any of the first 3 or the last PAR-Q item → `intensityCap=LOW` + "get medical clearance" notice + flag `cardiac` or `supervised`. Chronic condition/medication → `LOW` until the user confirms clearance (`POST /v1/me/screening/clearance`, self-attested, timestamped). Pregnancy → `LOW`, pregnancy contraindications, no calorie deficit. Injuries → contraindication mapping. Screening is re-asked every 12 months or when the user reports new pain.

## 3. Assessment output

`{ bmi, bmiNote, bmrKcal, tdeeKcal, recommendedRatePctPerWeek, rateRangeKgPerWeek, targetDateRange?, rationaleCodes[] }`. BMI note always states its limits (muscle mass, Asian cut-offs: overweight ≥ 23, obese ≥ 27.5 per WHO Asia-Pacific guidance). Unrealistic goals (rate > 1%/week) are capped and explained.

## 4. API

`GET /v1/onboarding/questionnaire` (versioned questions), `PUT /v1/onboarding/draft`, `POST /v1/onboarding/complete`, `GET /v1/onboarding/status`, `POST /v1/me/screening` (re-screen).
