# User Journeys and Flows

## 1. Journey map — Priya's first two weeks

| Stage | Doing | Thinking / feeling | Product response |
|---|---|---|---|
| Discover | Installs from Play Store ad | "Will this know Indian food?" | Welcome shows Indian meals and home workouts |
| Onboard | 6 short steps, ~3 min | Wary of long forms | Progress bar, skip for optional fields, why-we-ask tooltips |
| First plan | Sees assessment and plan | Wants to trust numbers | Plain-language explanation and "ask the coach why" |
| Day 1 | 30-min dumbbell session | Unsure of form | Demo video, cues, rest timer, haptic set done |
| Day 1–3 | Logs meals | Logging fatigue | Recent foods, katori units, "same as yesterday" |
| Day 5 | Misses a session | Guilt | Neutral nudge, plan re-arranged, no streak shaming |
| Week 1 end | Weekly summary | "Is it working?" | Trend range, consistency, one focus for next week |
| Week 2 | Asks coach about protein | Wants practical help | Answer from her targets with veg options; proposes meal swap |

## 2. Core flows

### 2.1 Onboarding

```mermaid
flowchart TD
  A[Welcome] --> B[Sign up: Google / Apple / email]
  B --> C[Basics: DOB, sex, height, weight, units]
  C -->|age < 18| X[Stop: not eligible]
  C --> D[Goal + experience]
  D --> E[Schedule + equipment + location]
  E --> F[Diet type, cuisines, allergies, dislikes]
  F --> G[Safety screening]
  G -->|any flag| H[Medical-clearance notice + low-intensity cap]
  G -->|no flags| I[Consents: core, AI coach, notifications]
  H --> I
  I --> J[Generate assessment + plan + targets]
  J -->|engine error| K[Retry with saved answers; nothing lost]
  J --> L[Plan reveal + first-day CTA]
```

### 2.2 Active workout

```mermaid
flowchart TD
  A[Today card: Start] --> B[Session overview + warm-up]
  B --> C[Exercise screen]
  C --> D[Log set: reps, load, RPE]
  D --> E{More sets?}
  E -->|yes| F[Rest timer] --> C
  E -->|no| G{More exercises?}
  G -->|yes| C
  G -->|no| H[Session feedback: difficulty, soreness, notes]
  C --> S[Substitute] --> C
  C --> P[Pain reported] --> Q[Stop exercise, show guidance, flag]
  H --> I[Summary: volume, PRs] --> J[Sync / queued offline]
```

### 2.3 Food logging

```mermaid
flowchart LR
  A[+ Log food] --> B{Method}
  B --> C[Search] --> F[Pick food]
  B --> D[Barcode] --> F
  B --> E[Recent / favourites] --> F
  B --> M[Manual: name + macros]
  F --> G[Quantity + unit + raw/cooked]
  G --> H[Preview nutrients + confidence]
  H --> I[Save to meal slot] --> J[Daily totals update]
  M --> I
```

### 2.4 AI coach

```mermaid
sequenceDiagram
  actor U as User
  participant App
  participant API
  participant Coach as Coach orchestrator
  participant LLM as AI gateway
  U->>App: "Can I swap tomorrow's legs for a run?"
  App->>API: POST /coach/conversations/{id}/messages (SSE)
  API->>Coach: handle(userId, text)
  Coach->>Coach: safety pre-check
  Coach->>LLM: prompt + tools
  LLM-->>Coach: tool_call get_plan_week
  Coach->>Coach: execute with session userId
  LLM-->>Coach: tool_call propose_workout_swap
  Coach->>Coach: validate via workout engine, store proposal
  LLM-->>Coach: final text
  Coach-->>App: streamed text + proposal card
  U->>App: Confirm
  App->>API: POST /recommendations/{id}/accept
```

### 2.5 Progress check-in

Weekly prompt on Sunday morning → weigh-in (optional) → measurements (optional) → sleep/energy/soreness → summary with trend band and one adjustment proposal → accept/decline.

## 3. Error and edge journeys

| Situation | Behaviour |
|---|---|
| Offline mid-session | Logs stored locally; banner "Saved on this device, will sync" |
| AI unavailable | Coach shows status and FAQ shortcuts; everything else works |
| Food not found | Offer manual entry and "request this food" for admin review |
| Unrealistic goal (e.g. 10 kg in 2 weeks) | Explain safe rate (0.25–1% bodyweight/week) and propose a realistic date |
| Concerning eating pattern | Gentle message, removes calorie deficit suggestions, links to professional help |
