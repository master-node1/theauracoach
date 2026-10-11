# Product Requirements (PRD)

Status: Draft · Owner: Product · Related: [discovery report](../discovery/discovery-report.md), [user stories](user-stories.md), [acceptance criteria](acceptance-criteria.md)

## 1. Goal

Give every user a safe, adaptive training and nutrition plan and a 24/7 coach that explains it, on web, Android and iOS, backed by one API and one data store.

## 2. Scope legend

`MVP` ships in Phase 5. `P2` follows MVP. `Later` is out of current plan.

## 3. Functional requirements

### FR-A Onboarding and profile

| ID | Requirement | Scope |
|---|---|---|
| A1 | Register with email + password, Google or Apple; verify email; log in; log out all devices | MVP |
| A2 | Password recovery by emailed one-time link (15 min expiry, single use) | MVP |
| A3 | Collect date of birth (age ≥ 18 at MVP, because DPDP treats under-18s as children needing verifiable parental consent), sex for energy equations, height, weight, activity level | MVP |
| A4 | Collect goal (fat loss, muscle gain, strength, endurance, general fitness), experience, equipment, days/week, session length, preferred time | MVP |
| A5 | Collect diet type (vegetarian, eggetarian, non-vegetarian, vegan, Jain), cuisines, allergies, intolerances, dislikes, fasting days | MVP |
| A6 | Safety screening (PAR-Q+ style 7 questions, pregnancy, injuries, conditions). Any "yes" restricts the plan to low intensity and shows a see-a-professional notice; it never blocks the account | MVP |
| A7 | Generate starting assessment (BMI with caveats, estimated TDEE, recommended weekly rate of change) and first plan | MVP |
| A8 | Edit profile and goals at any time; edits that affect plans trigger re-plan proposal | MVP |
| A9 | Units: metric default, imperial supported; locale `en-IN` default | MVP |

### FR-B AI personal trainer

| ID | Requirement | Scope |
|---|---|---|
| B1 | Deterministic plan generator from templates + rules (split, volume, intensity) based on goal, experience, schedule, equipment, restrictions | MVP |
| B2 | Daily workout: exercises, sets, rep range, target RPE/RIR, rest, tempo cue, progression note | MVP |
| B3 | Exercise detail: video/animation, steps, target muscles, common mistakes, regressions/progressions | MVP |
| B4 | Active session: log reps, load, RPE per set; rest timer; skip/substitute; offline capable | MVP |
| B5 | Track completed, partial and missed sessions; session-level fatigue and difficulty | MVP |
| B6 | Weekly adaptation (double progression, deload on fatigue, re-schedule missed sessions) | MVP |
| B7 | Gym, home, dumbbell-only, bodyweight modes; equipment-aware substitutions | MVP |
| B8 | Ask fitness questions in coach chat (see FR-F) | MVP |
| B9 | Reminders and motivational nudges; non-shaming copy rules | MVP |

### FR-C AI nutrition coach

| ID | Requirement | Scope |
|---|---|---|
| C1 | Calorie target (Mifflin-St Jeor × activity, goal adjustment, safety floors) and macro targets | MVP |
| C2 | Meal plans from curated recipes honouring diet, allergies, dislikes, cuisine, budget tier | MVP |
| C3 | Track calories, protein, carbs, fat, fibre, water; micronutrients iron, calcium, vitamin B12, vitamin D, sodium | MVP |
| C4 | Indian and regional foods; vegetarian and non-vegetarian | MVP |
| C5 | Raw vs cooked measures with yield factors; household units (katori, roti, ladle, cup, piece) mapped to grams | MVP |
| C6 | Recipes with steps, ingredient substitutions, grocery list per meal plan week | MVP |
| C7 | Log by search, manual entry, barcode (Open Food Facts + curated) | MVP |
| C8 | Meal-image recognition producing editable suggestions, never auto-logged | P2 |
| C9 | Practical alternatives (eating out, cannot cook, travelling) | MVP |
| C10 | Adapt targets using 2–3 week weight trend and adherence | MVP |
| C11 | Show estimate confidence and source on every nutrient value | MVP |

### FR-D Dashboard

D1 Today's workout and meals; D2 calories/macros vs target; D3 protein and fibre rings; D4 weekly consistency; D5 weight and measurement trend; D6 goal progress estimate with range, not a promise; D7 check-in (sleep, energy, soreness, mood); D8 up to three actionable recommendations. All MVP.

### FR-E Progress and analytics

| ID | Requirement | Scope |
|---|---|---|
| E1 | Weight and measurements (waist, chest, hips, arms, thighs, neck) | MVP |
| E2 | Strength: estimated 1RM, volume per muscle group, PRs | MVP |
| E3 | Weekly and monthly views; planned vs completed for workouts and nutrition | MVP |
| E4 | Progress photos with explicit consent, private encrypted storage, never sent to AI unless separately consented | P2 |
| E5 | Plateau detection (weight trend flat ≥ 3 weeks with ≥ 80% adherence) with a proposed adjustment | MVP |

### FR-F AI coach conversation

F1 explain exercises and recommendations; F2 answer using authorised profile and history via tools; F3 daily/weekly summaries; F4 suggest adjustments after misses or overeating; F5 explain the "why" with references to rules; F6 remember user-approved preferences; F7 ask clarifying questions; F8 changes to plans are **proposals** the user confirms; F9 safety escalation. All MVP.

### FR-G Notifications and integrations

G1 workout and meal reminders; G2 weekly summary; G3 inactivity nudges with frequency cap; G4 preferences and quiet hours — MVP. G5 Apple Health / Health Connect (steps, sleep, heart rate, workouts) — P2. G6 other wearables — Later.

### FR-H Administration

H1 CRUD exercises, media, foods, recipes, templates with draft/publish and versioning; H2 manage prompts, model routing, coaching policies; H3 review flagged AI answers and user feedback; H4 errors, usage, health; H5 RBAC; H6 AI usage and cost; H7 audit log of every content and config change. All MVP except H4 health beyond links to Grafana (MVP links only).

### FR-I Account and privacy

I1 consent capture per purpose (core service, AI coach, marketing, photos, health integrations) with timestamps and versions; I2 export all data as JSON + CSV within 72 h (target: minutes); I3 delete account with 30-day grace then hard delete; I4 subscription screen (hidden while monetization flag off). MVP except I4 (P2).

## 4. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | p95 < 400 ms for non-AI reads; dashboard loads < 2.5 s LCP on mid-range Android over 4G; coach first token < 3 s p95 |
| Availability | 99.5% monthly; core logging works when AI is down |
| Offline | Mobile: today's plan, active session logging, food logs queue offline and sync |
| Scalability | 50k MAU on a single region without re-architecture; horizontal API scaling |
| Security | OWASP ASVS L2 targets; authz on every resource; secrets in AWS Secrets Manager |
| Privacy | DPDP Act 2023 (India), GDPR-ready; data minimisation; no sensitive data in logs |
| Accessibility | WCAG 2.2 AA web; platform screen readers (VoiceOver, TalkBack); dynamic type |
| Compatibility | iOS 16+, Android 9+ (API 28), last two versions of evergreen browsers |
| Localisation | English at MVP; i18n-ready strings; Hindi in P2 |
| Observability | Structured logs, OpenTelemetry traces, RED metrics, AI token and cost metrics |
| Cost | AI spend ≤ admin-set per-user budget; infra ≤ USD 600/month at beta scale |

## 5. Out of scope

Medical diagnosis, clinical diets, supplements prescription, live human coaching, social feed, marketplace.
