# ADR-002: Next.js for web, Expo React Native for iOS and Android

Status: Proposed · 2026-10-11

## Context
Three platforms, one small team, native feel required (haptics, offline, camera, health integrations later).

## Options Considered
1. Native Swift + Kotlin + React web.
2. Flutter mobile + React web.
3. Expo React Native + Next.js, shared TypeScript packages.

## Decision
Option 3. Expo (New Architecture, Expo Router, EAS Build/Submit/Update), Next.js App Router for web and admin. Shared: `contracts` (Zod), `domain` (calculations for offline previews), `ui-tokens`, API client generated from OpenAPI. Platform-specific UI where conventions differ (sheets, pickers, navigation).

## Consequences
+ ~70% code sharing of logic and tokens; one language.
+ HealthKit / Health Connect via config plugins (`react-native-health`, `react-native-health-connect`) in P2.
− Some UI duplicated between `react-dom` and `react-native` renderers.
− Native module upgrades follow Expo SDK cadence.

## Alternatives Rejected
Native (2–3× effort); Flutter (second language, no sharing with web).
