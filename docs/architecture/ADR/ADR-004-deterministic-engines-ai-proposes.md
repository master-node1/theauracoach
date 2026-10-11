# ADR-004: Deterministic engines own numbers and plans; AI explains and proposes

Status: Proposed · 2026-10-11

## Context
Language models can invent nutrient values, unsafe loads and medical claims. The brief requires validated plans and no unrestricted model authority.

## Options Considered
1. LLM generates plans and numbers directly, validated afterwards.
2. Deterministic engines generate; LLM only explains, summarises and proposes changes through typed tools that call the engines.

## Decision
Option 2. `packages/domain` holds pure functions: `calculateTargets`, `generatePlan`, `progressWeek`, `substituteExercise`, `normaliseServing`, `detectPlateau`. The coach calls tools; write tools create `Recommendation` proposals that are re-validated by the same engines and applied only after user confirmation.

## Consequences
+ Testable, explainable, consistent numbers on every platform.
+ AI outage never blocks core features.
− Less "creative" variety; mitigated by template libraries curated by trainers and model-selected choices among engine-valid options.

## Alternatives Rejected
Option 1: validation-after-generation still lets invented values reach users when validators miss a case.
