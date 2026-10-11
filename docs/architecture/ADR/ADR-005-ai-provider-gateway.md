# ADR-005: Provider-independent AI gateway, Anthropic Claude as default provider

Status: Proposed · 2026-10-11

## Context
Need tool calling, structured outputs, streaming, safety handling, usage metering and the freedom to change providers or models on cost or quality grounds. The sibling repo uses OpenAI via LangChain in Python.

## Options Considered
1. Call a provider SDK directly from feature code.
2. LangChain/LangGraph in a Python sidecar.
3. Thin `ai-gateway` module (TypeScript) inside coach-service with a provider port and adapters.

## Decision
Option 3. The gateway lives in coach-service (the only service that calls AI providers). Port `LlmProvider { generate(req): Promise<LlmResult>; stream(req): AsyncIterable<LlmEvent> }` with a neutral request shape (system, messages, tools with JSON Schema, output schema, effort, max tokens, timeout). Default adapter: Anthropic TypeScript SDK (`@anthropic-ai/sdk`), model `claude-opus-5-5`, adaptive thinking (always on for this model) with per-feature `effort` (chat `low`, weekly summary `medium`, safety classifier `low`). Model routing per feature is configured in admin (`AiModelConfig`) so cheaper tiers can be adopted after evals show equal quality. A second adapter (e.g. OpenAI or AWS Bedrock) can be added without touching features. Strict tool schemas (`strict: true`) and structured outputs (`output_config.format`) for machine-read responses; all tool inputs re-validated with Zod.

## Consequences
+ One place for retries, timeouts, budgets, redaction, logging and evals.
+ Features are provider-agnostic.
− We maintain the abstraction; we deliberately support only the common subset (text, tools, structured output, streaming).
Data residency: first-party API processes outside India; acceptable with consent and minimisation under DPDP (cross-border transfer is permitted except to notified countries). Revisit with Claude on Amazon Bedrock if an in-region requirement arises.

## Alternatives Rejected
Direct SDK calls (lock-in, scattered controls); Python sidecar (second runtime, network hop, duplicated validation).
