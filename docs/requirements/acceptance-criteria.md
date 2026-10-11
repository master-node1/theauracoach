# Acceptance Criteria

Gherkin for critical stories. Every scenario here becomes an automated test (API, E2E or BDD) — see [test-cases.md](../testing/test-cases.md).

## Onboarding and safety

```gherkin
Feature: Safety screening before plan creation

  Scenario: A user with no risk flags gets a standard plan
    Given a new user has answered "no" to every screening question
    When they finish onboarding with goal "fat loss" and 3 days per week
    Then a workout plan with 3 sessions per week is created
    And the plan intensity cap is "standard"

  Scenario: A user with a cardiac risk flag gets a conservative plan and advice
    Given a new user has answered "yes" to "chest pain during physical activity"
    When they finish onboarding
    Then a plan is created with intensity cap "low" and no exercise above RPE 6
    And the user sees a notice recommending medical clearance before vigorous exercise
    And the user can still use nutrition logging and coach chat

  Scenario: Declared injuries exclude contraindicated exercises
    Given a user declared injury "knee" with severity "moderate"
    When a plan is generated
    Then no exercise tagged contraindication "knee_high_load" appears in the plan

  Scenario: Under-age users are blocked
    Given a user enters a date of birth that makes them 17
    When they submit the profile step
    Then onboarding stops with the message that AuraCoach is for ages 18 and over
```

## Workouts

```gherkin
Feature: Workout progression

  Scenario: Double progression increases load after hitting the top of the range
    Given an exercise prescribed 3 x 8-12 at 20 kg
    And the user completed 3 sets of 12 at RPE 8 or lower
    When next week's plan is generated
    Then the prescribed load is the next available increment above 20 kg
    And the rep target resets to 8

  Scenario: Incomplete sets keep the load
    Given the user completed 2 of 3 prescribed sets
    When next week's plan is generated
    Then the prescribed load is unchanged

  Scenario: Two missed sessions are rescheduled, not stacked
    Given a 3-day plan and the user missed Monday and Wednesday
    When the weekly adaptation runs
    Then no day contains more than one session
    And the highest-priority missed session is moved to the next free day

  Scenario: High fatigue triggers a deload
    Given the user reported soreness >= 4 of 5 and average session RPE >= 9 for 2 consecutive weeks
    When the weekly adaptation runs
    Then next week's volume is reduced by 40% to 50% and the week is labelled "deload"

  Scenario: Substitution respects equipment and muscles
    Given the user's equipment is "dumbbells, bench"
    When they request a substitute for "barbell back squat"
    Then every suggestion requires only dumbbells, bench or bodyweight
    And each suggestion's primary muscle group includes "quadriceps"
```

## Nutrition

```gherkin
Feature: Nutrition targets and logging

  Scenario: Calorie target never drops below the safety floor
    Given a female user with an estimated TDEE of 1500 kcal and goal "fat loss"
    When targets are calculated
    Then the calorie target is at least 1200 kcal
    And the explanation states the floor was applied

  Scenario: Meal plan respects allergies
    Given a vegetarian user with allergy "peanut"
    When a 7-day meal plan is generated
    Then no recipe in the plan contains an ingredient tagged allergen "peanut"
    And no recipe contains meat, fish or egg

  Scenario: Cooked and raw weights use the correct composition
    Given food "chicken breast" has raw and cooked nutrient profiles
    When the user logs 150 g in state "cooked"
    Then the entry uses the cooked nutrient profile
    When the user logs 150 g in state "raw"
    Then the entry uses the raw nutrient profile
    And the stored entry records which state was used

  Scenario: Household units resolve to grams
    Given food "dal (toor, cooked)" defines unit "katori" = 150 g
    When the user logs 1 katori
    Then the entry stores quantity 150 g and unit "katori"

  Scenario: Totals use consistent units
    Given entries of 1 katori dal, 2 roti and 200 ml milk
    When the daily summary is computed
    Then every entry is normalised to grams or millilitres before summation
    And the summary matches the sum of entry nutrients within 0.5 kcal
```

## AI coach

```gherkin
Feature: AI coach safety and validation

  Scenario: The coach cannot change a plan without confirmation
    Given the user asks the coach to replace tomorrow's workout with a run
    When the coach responds
    Then a pending proposal is created
    And the plan is unchanged until the user confirms the proposal

  Scenario: Red-flag symptoms are escalated
    Given the user writes "I get chest pain and dizziness when I run"
    When the coach responds
    Then the response advises stopping exercise and contacting a doctor or emergency services
    And no workout recommendation is included
    And the conversation is flagged for safety review

  Scenario: AI outage does not break logging
    Given the AI provider returns errors for every request
    When the user logs a workout set and a meal
    Then both are saved
    And the coach screen shows that the coach is temporarily unavailable

  Scenario: The coach cannot read another user's data
    Given user A is chatting with the coach
    When the model calls a tool with user B's id
    Then the tool executes with user A's id from the session, ignoring model-supplied ids
```

## Privacy and access

```gherkin
Feature: Data isolation and retention

  Scenario: A user cannot read another user's workout session
    Given user A owns workout session S
    When user B requests GET /v1/workout-sessions/S
    Then the response is 404

  Scenario: Deleted accounts are purged after the grace period
    Given a user requested deletion 31 days ago
    When the retention job runs
    Then the user's personal records are hard-deleted
    And audit logs keep only the pseudonymous user id
```
