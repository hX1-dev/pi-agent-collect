# Personal VMware Foundation — execution plan

## Decision

This track serves Henry first. It does not begin by producing a downloadable AI-company appliance.

We will use VMware as an existing infrastructure dependency, then build the small Northstar layer that VMware does not provide: durable organization state, authenticated cross-VM coordination, Hermes supervision, Codex brokering, evidence, approvals, and recovery.

The first proof uses one Studio VM. The second and third VMs are added only
after the full path works, because cloning a broken design produces three
broken departments.

## Target system

```text
Physical host
├── Northstar Controller
│   ├── organization/tasks/runs/approvals/activity
│   ├── Studio registry and health
│   ├── job lease and artifact service
│   ├── Codex Broker
│   └── VMware infrastructure adapter
└── VMware
    ├── Studio VM A
    │   ├── northstar-host
    │   ├── one persistent Hermes manager
    │   └── disposable Docker task sandboxes
    ├── Studio VM B (added after VM A passes)
    │   ├── northstar-host
    │   ├── one persistent Hermes manager
    │   └── disposable Docker task sandboxes
    └── Studio VM C (added after VM B proves isolation)
        ├── northstar-host
        ├── one persistent Hermes manager
        └── disposable Docker task sandboxes
```

The Board talks to one Northstar CEO/control-plane identity. Northstar delegates a task to a Studio manager. The manager can plan work and invoke approved tools, but Northstar remains the authority and durable record.

## Committed operating Studios

The foundation will eventually host exactly three initial Studios. These are
committed product decisions, but their content workflows remain paused until
the VM foundation passes.

| Studio | Durable manager | Required output |
| --- | --- | --- |
| GitHub Research & Experience | Hermes Research Manager | Discovery evidence, isolated installation/run results, README verification, real usage experience, limitations, logs, screenshots, and editor-ready recordings |
| Content & Marketing | Hermes Content Manager | Selection decision, audience/angle, hook, narrative, script, captions, title/description options, and a shot/material manifest grounded in Research evidence |
| OpenMontage Video Production | Hermes Production Manager | Editable production project, rendered drafts, grade previews, provenance, QA results, and final platform exports |

The default handoff is:

```text
GitHub evidence and usage report
-> CEO continuation gate
-> Content/Marketing script package
-> script approval
-> OpenMontage production and grade
-> CEO evidence review
-> human edit/publish decision
```

Studios do not hold an always-on group chat. Missing evidence or an infeasible
shot creates a durable clarification/handoff task through Northstar.

### Video Production tool decision

The first Video Studio uses:

```text
Hermes Production Manager
-> Northstar Codex Broker
-> OpenMontage
-> Colourlab AI Creator Standalone
-> FFmpeg delivery
```

- OpenMontage owns editing and production artifacts.
- Codex operates and extends OpenMontage, writes bounded Remotion/FFmpeg tools,
  repairs project dependencies, and records exact changed files and commands.
- Colourlab AI Creator Standalone is the initial licensed color-correction and
  color-matching capability. DaVinci Resolve Studio is not required for V1.
- FFmpeg applies deterministic delivery transforms and produces the requested
  aspect-ratio/codec variants.
- Terminal, code, and product-UI captures receive neutral technical correction,
  not an aggressive creative grade.
- The Colourlab license/activation remains in the video capability environment;
  it is never stored in organization SQLite, passed to Hermes, or embedded in a
  Studio artifact.
- If GPU-heavy video tools cannot run reliably inside VMware, the Studio VM
  submits a scoped job to a host-side Video Capability Worker. This exception
  does not give the guest general host access.

Open-source research grading models remain optional experiments, not V1
production dependencies. Colourlab is replaceable behind the video capability
boundary if its standalone workflow cannot be automated reliably.

## Identity model

| Concept | Lifetime | Meaning |
| --- | --- | --- |
| Studio | Durable | A department-like workspace and policy boundary |
| Manager Agent | Durable | The accountable Hermes-backed role inside a Studio |
| Task | Durable | Work requested by the Board, CEO, or manager |
| Run | Recoverable | One attempt to execute a task |
| Worker/subagent | Temporary | Compute created for a Run; not an employee identity |
| VM | Replaceable infrastructure | One current home for a Studio |
| Docker sandbox | Disposable | Isolated execution environment for one risky job |
| Codex thread/session | Temporary compute context | Broker-owned tool context, never organizational memory |

This avoids pretending that every LLM call is a permanent employee. One resident manager per Studio is the starting point; temporary specialists are created only when the task benefits from them.

## Cross-VM protocol

The guest initiates an authenticated connection to the host-side Controller.

Minimum operations:

1. Enroll a Studio instance with a one-time token and receive a renewable instance credential.
2. Send heartbeats with VM, `northstar-host`, Hermes, sandbox, disk, and queue health.
3. Claim one eligible job through a time-limited lease.
4. Report structured progress, logs, evidence, and artifact metadata.
5. Renew the lease while work is active.
6. Complete, fail, pause-for-approval, or acknowledge cancellation idempotently.
7. Reconnect after restart and reconcile the last known Run rather than starting it twice.

There is no direct Studio-to-Studio messaging. Collaboration is represented by durable tasks, evidence, and handoffs through Northstar.

## VMware boundary

Northstar will not create a hypervisor. The VMware adapter may use VMware's supported local automation surface to:

- discover the configured Studio VM;
- read lifecycle status;
- start, stop, suspend, and resume;
- create or restore an explicitly named checkpoint/snapshot when supported;
- report failure without silently changing business state.

VM lifecycle commands must live in `apps/server/infrastructure`. Domain and application code operate on a narrow port and never construct shell commands directly.

## Delivery phases

### Phase 0 — freeze the contract

- Replace the old “16 always-present employees” assumption with the Studio/manager/temporary-worker identity model for this branch.
- Add domain contracts for Studio identity, instance identity, health, job leases, and artifacts.
- Define threat boundaries and the manual local deployment assumptions.

Exit: architecture, contracts, and acceptance tests agree on the same nouns and authority.

### Phase 1 — VMware lifecycle spike

- Add one VMware adapter behind a narrow infrastructure port.
- Configure exactly one existing test VM by path/ID; do not scan or control arbitrary VMs.
- Implement read status plus explicit start/stop/suspend/resume commands.
- Record every lifecycle request and result in activity evidence.

Exit: Mock tests pass, and a manual smoke can observe and control only the configured test VM.

### Phase 2 — `northstar-host` enrollment and heartbeat

- Create a small guest service with no model logic.
- Implement one-time enrollment, credential rotation/revocation, heartbeat, and offline detection.
- Display Studio/VM/agent/sandbox health in the existing evidence UI.

Exit: restarting the guest preserves the Studio identity, creates a new instance session when appropriate, and never creates a duplicate department.

### Phase 3 — reliable job channel

- Add queue claim, leases, renewal, cancellation, progress, logs, artifacts, and reconnect reconciliation.
- Preserve one active Run per Agent/task and one writer per workspace.
- Add idempotency tests for duplicate delivery and expired leases.

Exit: a deterministic job survives controller or guest restart without double execution or lost final state.

### Phase 4 — one Hermes manager

- Run one Hermes manager inside the VM behind `northstar-host`.
- Give it a versioned charter, scoped memory references, and only the capabilities assigned to that Studio.
- Store its durable decisions/evidence in Northstar; Hermes-local state remains replaceable.

Exit: a Board task reaches Hermes, pauses correctly for approval, and returns attributable evidence to the original Northstar task.

### Phase 5 — disposable task sandbox

- Let the manager request a Docker sandbox for unknown repositories or toolchains.
- Apply CPU, RAM, disk, time, network, and secret policy.
- Mount only the task workspace; never mount the host Docker socket or controller secrets.
- Destroy the sandbox after collecting declared artifacts and evidence.

Exit: a test repository can be cloned, run, cancelled, and removed without changing the VM base image or seeing unrelated secrets.

### Phase 6 — Codex Broker

- Implement the host-side Codex capability Broker.
- Accept a scoped engineering request, allocate a permitted workspace, serialize usage initially, and map one Run to exact Codex execution evidence.
- Return results to Hermes without exposing Codex authentication to the VM.

Exit: Hermes can request one coding task, Codex performs it only inside the granted workspace, and Northstar records inputs, outputs, changed files, and final status.

### Phase 7 — prove the remaining Studios

- Clone or provision the second and third Studio VMs with distinct enrollment identities and policies.
- Prove that credentials, workspaces, queues, artifacts, and failures do not cross boundaries.
- Prove a CEO-mediated handoff through Northstar without direct VM-to-VM access.

Exit: all three Studios can work concurrently, but cannot read or mutate another
Studio's private workspace.

### Phase 8 — add the first real department workflow

Only after the foundation passes, choose one real workflow—likely GitHub project discovery and verification—and implement it as a Studio module.

## Current code to preserve

The existing modular monolith remains useful:

- SQLite organization state and activity ledger;
- task/Run ownership and locking;
- Run Broker and runtime ports;
- Hermes adapter seam;
- approvals and evidence-oriented UI;
- deterministic Mock execution.

We should reshape these components, not restart the repository or fork a large “AI company” framework into it.

## Explicitly paused

- downloadable VM image or one-click installer;
- public multi-hypervisor support;
- department marketplace and plug-in packaging;
- automatic public publishing or account creation;
- a fixed 16-agent company hierarchy;
- implementation of the committed Research, Content/Marketing, and Video workflows before the foundation gates pass;
- aesthetic dashboard redesign.

These belong to the future product track or to a later phase after the private foundation has proven useful.

## Phase 0 implementation baseline

The completed Phase 0 slice contains:

1. `Studio`, `StudioInstance`, `StudioHealth`, and lease contracts in `packages/core`;
2. a Mock VM provider and VMware provider port;
3. enrollment/heartbeat HTTP boundary with runtime validation;
4. additive persistence and activity events;
5. focused tests and one small health view.

It does not launch Hermes, Docker, or Codex. This keeps the foundation
reviewable and proves the cross-VM control contract before connecting expensive
or privileged executors. Verified completion evidence is recorded in the
implementation-status ledger; Phase 1 is the next implementation phase.
