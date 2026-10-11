# Onboarding and Assessment — Low-Level Design

## 1. Flow state

Draft answers saved per step (`PUT /v1/onboarding/draft`, stored in Redis 7 days + DB on completion) so users can resume on another device. `POST /v1/onboarding/complete` validates the full payload with the shared Zod schema and runs in one transaction:

1. Profile + preferences.
2. `SafetyScreening` → flags → `intensityCap`.
3. `HealthCondition` rows.
4. `FitnessGoal`.
5. `FitnessAssessment` (BMI, BMR, TDEE, safe rate).
6. `NutritionTarget` via targets engine.
7. `WorkoutPlan` via plan generator (first two weeks materialised).
8. Initial reminders scheduled (after commit, outbox).

Idempotent with `Idempotency-Key` header; second call returns the existing result.

## 2. Screening questionnaire (v1)

PAR-Q+ general questions (7): heart condition / prescribed activity only by doctor; chest pain at rest or in activity; loss of balance/dizziness or loss of consciousness in last 12 months; diagnosed chronic condition (other than heart/blood pressure); prescribed medication for a chronic condition; bone/joint/soft tissue problem made worse by activity; told to only do medically supervised activity. Plus: pregnant or postpartum < 6 months; current injuries (multi-select with severity).

Mapping: any of the first 3 or the last PAR-Q item → `intensityCap=LOW` + "get medical clearance" notice + flag `cardiac` or `supervised`. Chronic condition/medication → `LOW` until the user confirms clearance (`POST /v1/me/screening/clearance`, self-attested, timestamped). Pregnancy → `LOW`, pregnancy contraindications, no calorie deficit. Injuries → contraindication mapping. Screening is re-asked every 12 months or when the user reports new pain.

## 3. Assessment output

`{ bmi, bmiNote, bmrKcal, tdeeKcal, recommendedRatePctPerWeek, rateRangeKgPerWeek, targetDateRange?, rationaleCodes[] }`. BMI note always states its limits (muscle mass, Asian cut-offs: overweight ≥ 23, obese ≥ 27.5 per WHO Asia-Pacific guidance). Unrealistic goals (rate > 1%/week) are capped and explained.

## 4. API

`GET /v1/onboarding/questionnaire` (versioned questions), `PUT /v1/onboarding/draft`, `POST /v1/onboarding/complete`, `POST /v1/me/screening` (re-screen).
