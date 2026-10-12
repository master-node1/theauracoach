# Low-Fidelity Wireframes

Mobile-first (360 × 800 dp). Desktop adaptations noted per screen. The approved high-fidelity designs that supersede these are in [hifi-designs.md](hifi-designs.md).

## W1 Welcome

```text
┌──────────────────────────────┐
│          AuraCoach           │
│  [hero: home workout + thali]│
│ Your trainer and nutrition   │
│ coach, any time.             │
│                              │
│ [ Continue with Google     ] │
│ [ Continue with Apple      ] │
│ [ Sign up with email       ] │
│   Already have an account?   │
│   Log in                     │
│ Not medical advice · Privacy │
└──────────────────────────────┘
```

## W2 Onboarding step (pattern)

```text
┌──────────────────────────────┐
│ ←  Step 2 of 6   ▓▓▓░░░░░░░  │
│ What's your main goal?       │
│ ( ) Lose fat                 │
│ (•) Build muscle             │
│ ( ) Get stronger             │
│ ( ) Improve endurance        │
│ ( ) Feel fitter overall      │
│ ⓘ Why we ask                 │
│                              │
│ [          Continue        ] │
└──────────────────────────────┘
```

## W3 Safety screening

```text
┌──────────────────────────────┐
│ ←  Step 5 of 6               │
│ A few safety questions       │
│ Has a doctor said you have a │
│ heart condition?   [No][Yes] │
│ Chest pain during activity?  │
│                    [No][Yes] │
│ ... (7 items + injuries)     │
│ Injuries: [Knee ▾][+ add]    │
│ Pregnant or postpartum?      │
│                    [No][Yes] │
│ [          Continue        ] │
└──────────────────────────────┘
```

## W4 Plan reveal

```text
┌──────────────────────────────┐
│ Your starting plan           │
│ ≈ 1,850 kcal · 110 g protein │
│ 3 sessions/week · 35 min     │
│ Safe pace: 0.3–0.5 kg/week   │
│ [ Why these numbers? ]       │
│ Mon Full body A   ▸          │
│ Wed Full body B   ▸          │
│ Fri Full body A   ▸          │
│ [     Start day 1 now      ] │
│ [ Maybe later ]              │
└──────────────────────────────┘
```

## W5 Today (dashboard)

```text
┌──────────────────────────────┐
│ Good morning, Priya   (avatar)│
│ Sat 11 Oct   [How do you feel?]│
│ ┌──────────────────────────┐ │
│ │ Full body B · 35 min     │ │
│ │ 6 exercises   [ Start ]  │ │
│ └──────────────────────────┘ │
│ ┌────────┐ Protein ▓▓▓▓░ 62/110│
│ │ ≈ 980  │ Fibre   ▓▓░░░ 11/30 │
│ │ left   │ Water   ▓▓▓░░ 1.2/2.5L│
│ └────────┘                   │
│ For today                    │
│ • Add a paneer or dal snack  │
│ • 10-min walk after lunch    │
│ This week ●●○○○○○  2 of 3    │
│ Weight ╱╲_╱ 68.4 → 67.9      │
├──────────────────────────────┤
│ Today  Train  Eat  Coach  Prog│
└──────────────────────────────┘
```

Desktop: two columns — left workout + recommendations, right nutrition + trends; coach as collapsible right panel.

## W6 Active session

```text
┌──────────────────────────────┐
│ ✕  Goblet squat     2/6   ⋯  │
│ [ video / animation        ] │
│ Target 3 × 8–12 · RPE 7 · 90s│
│ Set Target  Reps  kg   RPE ✓ │
│ 1   8–12   [12]  [16] [7] ✔ │
│ 2   8–12   [10]  [16] [8] ✔ │
│ 3   8–12   [  ]  [16] [ ] ○ │
│ ┌──────────────┐             │
│ │   01:12      │ +15s  Skip  │
│ └──────────────┘             │
│ [Swap exercise] [Pain? ]     │
│ [        Set done          ] │
└──────────────────────────────┘
```

## W7 Exercise detail

Video, "How to" (numbered steps), target muscles (SVG map), common mistakes, easier / harder variants, equipment, contraindication notes.

## W8 Eat — day log

```text
┌──────────────────────────────┐
│ ‹ Today ›         ≈ 870 left │
│ P ▓▓▓░ C ▓▓▓▓ F ▓▓░ Fib ▓░   │
│ Breakfast            420 kcal│
│  Idli ×3, sambar 1 katori    │
│ Lunch                610 kcal│
│  Roti ×2, dal, bhindi sabzi  │
│ Snack            [ + Add ]   │
│ Dinner           [ + Add ]   │
│ Water ○○○●●●●● 1.2 / 2.5 L   │
│ [ Meal plan ]  [ Grocery ]   │
└──────────────────────────────┘
```

## W9 Food search and quantity

```text
┌──────────────────────────────┐
│ ← [ dal            ] [▣ scan]│
│ Recent: Toor dal (cooked)    │
│ Results                      │
│ Toor dal, cooked   ●high  ▸ │
│ Moong dal, cooked  ●high  ▸ │
│ Dal makhani        ●med   ▸ │
├──────────────────────────────┤
│ Toor dal, cooked             │
│ Qty [ 1 ] Unit [katori 150g▾]│
│ State (•)cooked ( )raw       │
│ ≈ 170 kcal · P 9 · C 25 · F 4│
│ Source: IFCT 2017 · ●high    │
│ [        Add to lunch       ]│
└──────────────────────────────┘
```

## W10 Meal plan and recipe

Week strip → day meals with swap button → recipe: servings stepper, ingredients with raw weights, steps, per-serving nutrients with confidence, substitutions, "add to grocery list".

## W11 Coach chat

```text
┌──────────────────────────────┐
│ ← Coach               ⋯      │
│ ┌ You're 2 of 3 this week.  ┐│
│ └ Want to plan Sunday?      ┘│
│        Can I swap legs for a ││
│        run tomorrow? ┘       │
│ ┌ Sure. A 30-min easy run   ┐│
│ │ keeps your week balanced. ││
│ │ ┌ Proposal ─────────────┐ ││
│ │ │ Sun: Legs → Easy run  │ ││
│ │ │ Why: knee rest, cardio│ ││
│ │ │ [Accept]  [No thanks] │ ││
│ │ └───────────────────────┘ ││
│ └───────────────────────────┘│
│ Suggestions: [Why this plan?]│
│ [ Message the coach…    ] ➤ │
│ Coach can make mistakes.     │
└──────────────────────────────┘
```

## W12 Progress

Segmented: Weight · Body · Strength · Consistency. Weight: line with 7-day average and goal band, range "on current trend ≈ Dec–Jan" (not a date promise). Strength: e1RM per lift, PR list. Consistency: calendar heatmap with planned vs done.

## W13 Settings

Grouped list: Profile, Goals & plan, Equipment, Diet & allergies, Units, Notifications & quiet hours, Reminders, Integrations (P2), Privacy (consents, export, delete), Subscription (flagged), About & disclaimers.

## W14 Admin dashboard (web)

```text
┌ Rail ─┬──────────────────────────────────────────────┐
│ Dash  │ Today: DAU 1,240 · AI cost $18.40 / $40 budget│
│ Exerc │ Flagged answers: 7 ▸   Food requests: 23 ▸   │
│ Foods │ Errors (24h): 0.3% ▸   p95 API: 210 ms       │
│ Recip │ ┌ AI cost by day ┐ ┌ Coach thumbs-up rate ┐  │
│ Templ │ └────────────────┘ └──────────────────────┘  │
│ Prompt│ Recent changes (audit)                        │
│ Review│  Rahul published "Goblet squat" v3  10:02     │
│ Usage │  Asha changed policy "deficit-floor" 09:40   │
│ Audit │                                               │
│ Roles │                                               │
└───────┴──────────────────────────────────────────────┘
```
