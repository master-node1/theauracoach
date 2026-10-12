# Component Inventory

Components used by the approved [high-fidelity designs](hifi-designs.md), to be built in `packages/ui` with web (`react-dom`) and native (`react-native`) renderers sharing props. Tokens come from [tokens.json](tokens.json); behaviour rules from the [design system](design-system.md).

| Component | Variants and states | Used on |
|---|---|---|
| Button | primary, secondary (outline), ghost, destructive; md 44–48 px, lg 52–58 px; loading keeps width; disabled | everywhere |
| SocialSignInButton | Apple (black on light, white on dark), Google (outlined) | Welcome |
| IconButton | 44 × 44 minimum, requires `accessibilityLabel` | headers, session |
| TabBar | iOS tab bar; Android navigation bar with pill indicator; `aria-current` on the active tab | all tab screens |
| SideRail | web left rail with five destinations, admin link, profile; stacks on narrow screens | web |
| AdminRail | dark rail, section list with count badges | admin |
| StepProgress | segmented bar "2 of 6", progressbar role | onboarding |
| OptionCard | radio card with icon, title, hint, checked ring | onboarding goal |
| YesNoToggle | two-segment pressed buttons per question | safety screening |
| Chip / FilterChip | selected, removable, dashed "add" | injuries, mood check-in, suggestions |
| SegmentedControl | 2–4 segments, tab or radio role | exercise info, progress views, cooked/raw |
| Card | default, highlighted (today's workout in primary), interactive (whole card is a link) | Today, Train |
| StatTile | label, value, note | plan reveal, admin KPIs |
| ProgressRing | calories with centre label "≈ 980 kcal left" | Today, Eat |
| MacroBar | protein, carbs, fat, fibre, water; label + value + bar | Today, Eat |
| WeekStrip | 7 days with done, today, rest, moved states | Train, meal plan |
| ListRow | title, subtitle, trailing value or chevron or switch; grouped lists | Settings, plan reveal |
| SetRow / SetTable | set #, target, reps, kg, RPE, done; next set highlighted | active session |
| RestTimer | ring countdown, +15 s, skip, live region | active session |
| VideoPlaceholder | play button, captions badge, duration | session, exercise detail |
| ConfidenceBadge | high (primary-soft), medium (warning-soft) | food search, recipe |
| QuantityStepper | ½ steps, unit picker (katori, piece, g) | food quantity sheet, recipe servings |
| BottomSheet | grab handle, focus-trapped; Android bottom sheet and iOS detent | food quantity |
| WaterTracker | 10 × 250 ml tappable glasses | Eat |
| ChatBubble | user, coach; timestamp separator | Coach |
| ProposalCard | what changes, why, Accept / No thanks, resolved state | Coach |
| ChatComposer | pill input, send button, disclaimer line | Coach |
| InfoBanner | info (neutral blue), warning (amber); never red for safety prompts | safety, exercise caution |
| LineTrend | dots for weigh-ins, 7-day average line, goal-pace band, legend | Progress |
| BarWeekly / BarDaily | bars with budget line | admin AI cost |
| CalendarHeatmap | done, planned, rest | Progress habits |
| Switch | role="switch", 52 × 32 | Settings |
| DataTable | sortable later; horizontal scroll on narrow screens | web Train, admin audit |
| Avatar | initials on accent-soft | headers |
| EmptyState, ErrorState, OfflineBanner, Skeleton, Toast | per design-system §5 (not yet drawn) | all |
