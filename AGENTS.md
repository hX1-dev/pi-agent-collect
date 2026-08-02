# Northstar Personal VMware Foundation development guide

This worktree builds Henry's private, local-first AI studio system. The immediate
goal is a dependable VMware-based foundation, not a public appliance and not a
demo with many simulated employees.

## Instruction precedence

When instructions disagree, use this order:

1. the user's current request;
2. this `AGENTS.md`;
3. `docs/personal-vmware-foundation-plan.md`;
4. `docs/architecture.md`;
5. `README.md` and older blueprints.

`README.md` and `docs/architecture.md` still describe parts of the working
16-identity prototype. Preserve useful code from that prototype, but do not
extend the 16-person model. The Personal VMware plan is the target architecture
for this branch.

## Workspace boundary

Work only in this Git root:

```text
/Users/henry/Documents/pi agent/.worktrees/personal-vmware
```

- At the start of every task, run `git rev-parse --show-toplevel` and
  `git branch --show-current`.
- Stop if the root is not the path above or the branch is not
  `codex/personal-vmware-foundation`, unless the user explicitly changed it.
- Do not read implementation work from, edit, or copy changes from the parent
  worktree unless the user explicitly asks.
- Preserve unrelated user changes and inspect `git status` before editing.
- Read any more-specific nested `AGENTS.md` before editing files under it.

This worktree isolation prevents accidental cross-track development; it is not
a security sandbox. Never weaken runtime isolation because the source trees are
separate.

## Mandatory reading before implementation

Read these files completely, in this order:

1. `AGENTS.md`
2. `README.md`
3. `docs/architecture.md`
4. `docs/personal-vmware-foundation-plan.md`
5. `docs/personal-vmware-implementation-status.md`

Then inspect the relevant existing code and tests before proposing new
abstractions. Do not start by scaffolding a second application or importing a
large framework.

## Product target

The durable organization is:

- one Board/user;
- one host-side Northstar CEO/control plane;
- three durable Studios:
  - GitHub Research & Experience;
  - Content & Marketing;
  - OpenMontage Video Production;
- one resident Hermes manager per Studio;
- temporary workers, workflows, Codex executions, and Docker sandboxes created
  per Run rather than represented as permanent employees.

The host owns Northstar, durable state, VMware control, the Codex Broker, and
privileged capability workers. A Studio VM runs `northstar-host`, one Hermes
manager, its private workspace, and disposable task sandboxes. Studio VMs never
communicate directly.

The initial Video Studio tool decision is:

```text
Hermes Production Manager
-> Northstar Codex Broker
-> OpenMontage
-> Colourlab AI Creator Standalone
-> FFmpeg delivery
```

DaVinci Resolve Studio is not a V1 dependency. If GPU-heavy tools are unreliable
inside VMware, expose them through a scoped host-side Video Capability Worker;
do not grant the guest general host access.

## Scope restrictions

Do not implement any of the following before the foundation phase gates pass:

- public or downloadable VM appliances;
- Proxmox, Hyper-V, Incus, cloud VM, or multi-provider support;
- a marketplace or department package distribution system;
- automatic public posting, account registration, purchasing, or messaging;
- the three real content workflows before Studio enrollment, job leases,
  recovery, Hermes, sandboxing, and Codex brokering are proven in order;
- aesthetic dashboard redesign unrelated to operational evidence;
- more permanent Agents merely to simulate a larger company.

A narrow `VmProvider` port is allowed to keep VMware commands out of the domain,
but VMware is the only real provider in this track.

## Phase discipline

Follow `docs/personal-vmware-foundation-plan.md` in order.

- Work on the first incomplete phase only.
- Break a phase into the smallest coherent, testable slice.
- Do not begin a later phase because its UI or demo is more exciting.
- Do not connect a live VM, Hermes provider, Codex login, Docker daemon,
  Colourlab license, or publishing capability while the corresponding Mock
  contract is untested.
- Update `docs/personal-vmware-implementation-status.md` only with evidence.
- A phase is complete only when its exit criteria are implemented and verified.
- If hardware, credentials, a paid license, destructive action, or external
  authority is required, finish all safe Mock work first and report the exact
  manual gate.

The Phase 1 safe implementation is complete. Its remaining gate is the manual
smoke in `docs/runbooks/vmware-fusion-lifecycle-smoke.md`. Do not begin Phase 2
or execute a real VMware command until the user supplies and explicitly
approves a disposable test VM. Automated tests continue to use fake runners.
Do not launch Hermes, Docker, Codex, OpenMontage, or Colourlab in this phase.

## Architectural boundaries

Keep the modular monolith:

| Location | Responsibility |
| --- | --- |
| `packages/core` | Domain contracts, state machines, policies, and invariants |
| `apps/server/api` | HTTP transport, authentication boundary, and runtime validation |
| `apps/server/application` | Use cases, orchestration, leases, locks, and capability policy |
| `apps/server/infrastructure` | SQLite, VMware, Hermes, Codex, filesystem, and external adapters |
| `apps/web` | Board interaction, operational evidence, approvals, and health |

- Domain code must not import VMware, shell, HTTP server, SQLite, Hermes, Codex,
  OpenMontage, Colourlab, or UI implementations.
- API handlers validate untrusted values at runtime; TypeScript types are not
  validation.
- Application services depend on ports, not infrastructure implementations.
- Shell commands are constructed only inside defensive infrastructure adapters
  with explicit argument handling and allowlists.
- Keep migrations additive and preserve existing local data.
- Prefer small adapters around pinned upstream projects instead of copying their
  internals into Northstar.
- Do not let chat state become business state.

## Durable identity and execution invariants

- Northstar is the source of truth for Studios, Agents, tasks, Runs, approvals,
  capability grants, evidence, and activity.
- A VM, process, container, LangGraph thread, Hermes Run, Codex thread, or chat
  conversation is never a durable organizational identity.
- Every task has exactly one accountable owner.
- A task and an Agent each have at most one active Run.
- A writable workspace has at most one active writer.
- One Studio identity may have only one currently active enrolled instance unless
  an explicit replacement transition revokes the previous instance.
- Job claims use expiring leases; duplicate delivery, retry, reconnect, and
  controller restart must not duplicate durable work.
- Material state changes append activity evidence in the same durable operation
  when practical.
- Green/no-review work may finish; yellow/reviewer work stops at review; red work
  stops at Board approval.
- Approval records authority but never performs an external effect by itself.

## Security and capability rules

- Prefer authenticated outbound guest-to-controller connections.
- Store only hashes or secret references where possible; never log raw secrets.
- Do not expose configured host paths through provider errors, activity
  evidence, API responses, screenshots, or guest-visible results. Only
  adapter-sanitized diagnostics may cross an infrastructure boundary.
- Never commit `.env`, OAuth material, provider keys, enrollment tokens,
  Colourlab activation data, or personal credentials.
- A Studio guest never receives VMware administration rights, the host Codex
  login, unrestricted host paths, another Studio's credentials, or the physical
  host Docker socket.
- All Codex work goes through the host-side Broker. Hermes submits a scoped
  request and never invokes a raw unrestricted Codex command.
- Unknown repositories run only in disposable sandboxes with explicit CPU, RAM,
  disk, time, network, mount, and secret policy.
- Publishing, messaging, calendar writes, payments, account creation, and
  destructive connectors require a separate scoped capability gateway and
  appropriate human approval.
- Capability results include an idempotency key and durable receipt; approval
  alone is not proof that an action occurred.

## Implementation style

- Prefer explicit state machines and named transitions over scattered boolean
  flags.
- Make retries and cancellation first-class behavior.
- Use dependency injection and deterministic clocks/IDs in tests where timing or
  leases matter.
- Reuse existing repository patterns before adding libraries.
- Keep public contracts small and versionable.
- Return stable machine-readable errors at process and HTTP boundaries.
- Bound logs and artifacts; large binary data should not live in SQLite.
- Add comments for policy or recovery reasoning, not for obvious syntax.
- Do not silently represent an unimplemented live path as working.
- Do not replace Mock behavior with live behavior; live integrations are explicit
  opt-in adapters.

## Required testing

For every code slice, add or update tests proportional to the behavior:

- unit tests for domain transitions and policy;
- integration tests for SQLite persistence and atomic activity events;
- HTTP contract tests for validation, authentication, and stable errors;
- concurrency/idempotency tests for locks, duplicate delivery, leases, expiry,
  cancellation, reconnect, and restart behavior where relevant;
- adapter tests using fakes or recorded harmless fixtures;
- UI tests for important operational state when the presentation changes;
- regression tests for every bug fixed.

Automated tests must not:

- start or control a real VM;
- call a paid model or live Hermes;
- use the developer's Codex login;
- contact Colourlab or require its activation;
- run unknown repositories;
- publish or mutate an external service.

Run from the repository root:

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

Run targeted tests during development, but run the complete suite before calling
a code slice complete. If a command cannot run, report the exact command,
failure, and unverified risk. Do not describe a skipped check as passing.

Live VMware and licensed-tool checks are separate, explicit manual smoke tests.
They require a configured disposable test VM and must record the target,
command/capability, observed result, cleanup, and evidence without exposing
secrets.

## Definition of done for a slice

A slice is done only when:

1. its scope and acceptance criteria are stated;
2. relevant current code and tests were inspected;
3. implementation respects the layer boundaries and invariants above;
4. migrations are additive and rollback/recovery implications are explained;
5. tests cover happy path, invalid input, duplicate/retry behavior, and the
   relevant failure path;
6. the full verification commands pass, or failures are truthfully reported;
7. operational evidence is visible under the relevant task, Run, or Studio;
8. documentation and implementation status match reality;
9. no secrets, generated data, large artifacts, or unrelated changes are added;
10. the final handoff lists changed files, tests, remaining risks, and the next
    phase gate.

## Git discipline

- Keep work on `codex/personal-vmware-foundation` unless the user requests
  another branch.
- Do not commit, push, merge, open a pull request, install paid software, or
  activate a license unless the user asks.
- Do not merge the future productization track into this branch merely to make
  the branches look similar.
- Never discard unrelated changes with destructive Git commands.

This file applies recursively. A nested `AGENTS.md` may add narrower rules but
may not weaken this file.
