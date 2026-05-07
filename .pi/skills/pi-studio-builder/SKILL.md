---
name: pi-studio-builder
description: Build and operate PI Studio touch-first orchestration workflows, provider flows, and plugin/skill lifecycle UX with strict validation and optimization gates.
---

# PI Studio Builder

Use this skill when implementing or operating PI Studio product features across web UI, orchestration runtime surfaces, and coding-agent RPC-connected settings.

## Source-of-Truth Docs

- Skills behavior and packaging:
  - `../../../packages/coding-agent/docs/skills.md`
- RPC contracts and event semantics:
  - `../../../packages/coding-agent/docs/rpc.md`
- Provider and local-model setup behavior:
  - `../../../packages/coding-agent/docs/providers.md`

## Build + Operate Workflow

1. Scope and contracts first
- Confirm whether changes belong to reusable web UI (`packages/web-ui/src`) and/or example product wiring (`packages/web-ui/example/src`).
- Keep extension points compatible (custom message/tool renderers, message interceptor hooks, session metadata contracts).

2. Feature implementation
- Implement touch-first/mobile behavior behind feature flags default-off.
- Preserve desktop dense cockpit behavior unless explicitly changing desktop UX.
- Keep single-agent behavior unchanged when sequential orchestration mode is off.

3. Provider and lifecycle integration
- Keep local/provider flows actionable with clear status and recovery messaging.
- Maintain plugin/skill lifecycle UX through coding-agent RPC as source of truth.

4. Validation discipline
- Run root validation gate after code changes:
  - `npm run check`
- Resolve all errors/warnings/infos before finalizing.

5. Optimization and release quality
- Verify core user flows manually after green checks:
  - sequential run start/edit/retry/complete
  - local provider setup and role mapping
  - plugin/skill lifecycle actions
  - export and persistence round-trip
- Confirm no regressions in existing desktop or single-agent flows.

## Output Expectations

When using this skill, return:
- concise summary of implemented behavior
- affected interfaces/types and persistence changes
- validation evidence (`npm run check` result)
- known risks or deferred items, if any
