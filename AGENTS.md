# Northstar development guide

This repository is a local-first private AI organization control plane. Preserve the distinction between durable organizational state and temporary model execution.

## Before changing code

- Read `README.md` and `docs/architecture.md`.
- Keep domain contracts in `packages/core`, orchestration in `apps/server/application`, adapters in `apps/server/infrastructure`, and presentation in `apps/web`.
- Do not treat a Codex thread as an Agent identity or long-term memory.

## Invariants

- One accountable owner per task.
- At most one active Run per task and per Agent.
- At most one writable Run per workspace.
- All Codex work goes through the Broker.
- Green/no-review work may finish; yellow/reviewer work stops at review; red work stops at Board approval.
- Approval records authority but must never be assumed to execute an external side effect.
- No publishing, messaging, calendar write, payment, or destructive connector may bypass a scoped capability gateway.

## Commands

```bash
npm run typecheck
npm test
npm run build
```

Mock execution is the default. Do not enable live Codex execution in automated tests.

## Implementation style

- Prefer explicit workflow transitions and append an activity event for material state changes.
- Validate untrusted values at the HTTP boundary; TypeScript types are not runtime validation.
- Keep migrations additive and preserve existing local data.
- Add tests for workflow, locking, approval, or persistence changes.
- Show evidence under tasks and Runs rather than creating additional chat-centric UI.
