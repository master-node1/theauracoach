# Data Dictionary

Conventions: UUID v4 primary keys (`@db.Uuid`), `camelCase` columns quoted in SQL, timestamps `timestamptz` in UTC, user-local calendar dates stored as `date` with the user's timezone on `User.timezone`. Weights in kg, lengths in cm, energy in kcal, volumes in ml — conversion to imperial happens only in clients via `packages/domain/units`.

Sensitivity: **S** sensitive health, **P** personal, **B** behavioural, **C** content, **O** operational.

## 1. Tables

| Table | Class | Purpose | Key fields and rules |
|---|---|---|---|
| User | P | Account | `cognitoSub` unique; `status` drives deletion; `timezone` IANA |
| Profile | S | Body, diet and training profile | DOB date only; `allergens` from `Allergen.code`; `intensityCap` from latest screening |
| UserPreference | P | Theme, reminders, quiet hours | `inactivityNudges` max per week |
| Role / Permission / RolePermission / UserRole | O | RBAC | Role ids are stable strings |
| Consent | P | Purpose-level consent history | Append-only; latest row per purpose wins |
| DataRequest | P | Export / delete requests | Export artefact expires after 7 days |
| FitnessGoal | B | Goals over time | One ACTIVE per user (service rule) |
| SafetyScreening | S | Questionnaire snapshots | `answers` JSON keyed by question code; `freeTextEnc` field-encrypted |
| HealthCondition | S | Injuries and conditions | Controlled `code`; `notesEnc` encrypted |
| FitnessAssessment | S | BMR/TDEE snapshots | `engineVersion` for reproducibility |
| Equipment / UserEquipment | C / B | What the user can train with | `incrementKg` drives load progression |
| MuscleGroup, Exercise, ExerciseMuscle, ExerciseEquipment, ExerciseMedia | C | Exercise library | Versioned, `contraindications` codes match `HealthCondition.code` mapping |
| WorkoutTemplate, WorkoutTemplateExercise | C | Trainer-authored programmes | Selected by goal/experience/days/location |
| WorkoutPlan, WorkoutPlanWeek | B | User plan and weekly instances | One ACTIVE plan; `rationale` explanation codes |
| WorkoutSession, PlannedExercise, WorkoutSet | B | Prescription and performance | `clientId` idempotency for offline sync |
| PersonalRecord | B | PRs | Recomputed on session completion |
| Nutrient, Allergen | C | Vocabularies | |
| FoodItem, FoodNutrient, FoodUnit | C (USER foods: B) | Foods per 100 g | `source`, `sourceRef`, `confidence`, `state`, `yieldFactor` |
| Recipe, RecipeIngredient | C | Recipes; ingredient grams are raw | Composite `FoodItem` generated on publish |
| NutritionTarget | B | Targets over time | `rationale` codes, `engineVersion` |
| MealPlan, MealPlanItem | B | Weekly meal plans | |
| MealEntry | B | Food log | `grams` normalised; `nutrients` snapshot so later dataset edits do not rewrite history |
| WaterEntry | B | Water log | |
| DailyNutritionSummary | B | Materialised daily totals | Upserted on each log |
| BodyMeasurement | S | Weight and girths | `source` for integrations |
| DailyCheckIn | S | Sleep, energy, soreness, mood | One row per user per date |
| CoachConversation, CoachMessage | S | Chat history | `toolCalls` metadata only, never raw tool outputs |
| Recommendation | B | Proposals from engine or coach | `basisVersion` optimistic check, `expiresAt` default 72 h |
| CoachMemory | B | User-approved facts | Max 50 per user |
| UserFeedback | B | Ratings and comments | Review workflow |
| SafetyReview | S | Flagged conversations | Reviewer access audited |
| Device, Notification | P / O | Push tokens, delivery log | `dedupeKey` unique per channel |
| DeviceIntegration | P | Health platform links (P2) | |
| Subscription | P | Paid plans (P2) | |
| UsageRecord | O | AI tokens and cost | `userId` set null on deletion |
| AiPromptVersion, AiModelConfig, CoachingPolicy, FeatureFlag | O | AI and product configuration | Every change audited |
| AuditLog | O | Append-only audit | `before/after` exclude sensitive fields |

## 2. Retention

| Data | Retention | Deletion behaviour |
|---|---|---|
| Account and all S/B/P user data | Life of account | Request → `PENDING_DELETION` (login blocked, 30-day grace, cancellable) → hard delete via cascade |
| Coach messages | 24 months rolling, or until account deletion | Older messages summarised then deleted |
| Notifications | 90 days | Purged by job |
| Export artefacts | 7 days | S3 lifecycle |
| UsageRecord | 24 months | `userId` nulled on account deletion |
| AuditLog | 7 years | `actorId` kept as pseudonymous id; personal values never stored in `before/after` |
| Backups | 35 days | Deleted data ages out of backups |
| Logs | 30 days (prod) | No personal data by design |

## 3. Index summary

| Table | Index | Query served |
|---|---|---|
| WorkoutSession | (userId, scheduledDate) | Calendar, today |
| WorkoutSet | (exerciseId, completedAt) | Exercise history, PRs |
| MealEntry | (userId, date) | Day log |
| BodyMeasurement | (userId, type, measuredAt desc) | Trends |
| CoachConversation | (userId, lastMessageAt desc) | Conversation list |
| Recommendation | (userId, status, createdAt desc) | Pending proposals |
| Notification | (status, scheduledFor) | Dispatcher |
| UsageRecord | (feature, createdAt), (userId, createdAt) | Cost dashboards, quotas |
| FoodItem | GIN trigram on name/localNames | Search |
