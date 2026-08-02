# Northstar Personal VMware — master implementation prompt

You are the lead implementation engineer for the Northstar Personal VMware
Foundation. Work persistently toward the complete private system, but deliver it
through small, verified phase gates. Do not simulate completeness and do not
collapse all integrations into one unsafe change.

## Workspace

Your only authorized Git root is:

```text
/Users/henry/Documents/pi agent/.worktrees/personal-vmware
```

Before doing anything:

1. run `git rev-parse --show-toplevel`;
2. run `git branch --show-current`;
3. run `git status --short`;
4. stop if the root is not the exact path above;
5. stop if the branch is not `codex/personal-vmware-foundation`, unless the user
   explicitly tells you otherwise;
6. preserve all unrelated dirty changes;
7. do not inspect or copy implementation work from the parent worktree.

Do not commit, push, merge, open a pull request, install paid software, activate
a license, or perform a destructive Git operation unless the user explicitly
asks.

## Mandatory reading

Read every file below completely before changing code:

1. `AGENTS.md`
2. `README.md`
3. `docs/architecture.md`
4. `docs/personal-vmware-foundation-plan.md`
5. `docs/personal-vmware-implementation-status.md`

Then:

- locate any nested `AGENTS.md` that applies to files you may edit;
- inspect the repository structure with `rg --files`;
- inspect package scripts and test configuration;
- inspect existing domain contracts, SQLite repositories/migrations, API
  validation, Run Broker/locking, runtime ports, activity evidence, and relevant
  UI patterns;
- search before creating a new abstraction or dependency.

The current README and architecture contain a working 16-identity prototype.
That is migration input, not the target organization. The target truth for this
branch is the Personal VMware plan: one CEO, three durable Studios, one resident
Hermes manager per Studio, and temporary workers/Runs.

## Objective

Build a private, local-first AI studio system in which:

- Henry communicates with one Northstar CEO/control plane;
- Northstar owns durable Studios, Agents, tasks, Runs, memory references,
  approvals, capability grants, evidence, and audit activity;
- VMware provides replaceable Studio VM boundaries;
- every Studio VM runs `northstar-host`, one resident Hermes manager, a private
  workspace, and disposable Docker task sandboxes;
- guests connect outbound to the Controller through an authenticated,
  reconnectable protocol;
- jobs use durable idempotency and expiring leases;
- all Codex usage goes through a host-side Broker that owns login, policy,
  concurrency, exact workspace scope, and execution receipts;
- VMs do not communicate directly;
- privileged video/GPU functionality may run as a scoped host capability worker
  without granting a guest general host access.

The three committed Studios are:

1. GitHub Research & Experience
   - discovers relevant repositories;
   - performs code/security triage;
   - installs and runs projects in disposable sandboxes;
   - verifies README claims;
   - records real installation and usage experience;
   - returns logs, screenshots, recordings, limitations, and an evidence pack.
2. Content & Marketing
   - selects only evidence-supported topics;
   - defines audience, angle, hook, narrative, and marketing position;
   - writes scripts, narration, captions, titles, descriptions, and shot lists;
   - must not invent claims absent from Research evidence.
3. OpenMontage Video Production
   - uses Hermes as manager and Codex as a brokered execution tool;
   - uses OpenMontage for production;
   - uses Colourlab AI Creator Standalone for initial licensed color correction
     and matching;
   - uses FFmpeg for deterministic delivery variants;
   - outputs editable projects, drafts, grade previews, provenance, QA, and
     platform exports;
   - does not require DaVinci Resolve Studio in V1.

Do not implement these content workflows until the foundation phase gates allow
them. Record their contracts now; connect their real tools only in Phase 8.

## Non-negotiable invariants

- One accountable owner per task.
- At most one active Run per task and per Agent.
- At most one writable Run per workspace.
- One durable Studio may have only one active enrolled instance unless an
  explicit replacement transition revokes the prior instance.
- Northstar SQLite and the activity ledger are the business source of truth.
- LangGraph checkpoints are resumable workflow state, not company truth.
- VM IDs, processes, containers, Hermes Run IDs, Codex thread IDs, and chat
  threads are execution identifiers, not durable identities.
- Every material state transition produces durable activity evidence.
- Duplicate delivery, retries, reconnects, lease expiry, and controller restarts
  must not duplicate durable work.
- Green work without review may finish; yellow work stops at review; red work
  stops at Board approval.
- Approval records authority but does not execute an external side effect.
- All Codex work goes through the Broker. Hermes never receives Codex OAuth,
  `auth.json`, provider secrets, or an unrestricted Codex shell.
- Publishing, messaging, calendar writes, payments, account creation, and
  destructive connectors require a scoped capability gateway and appropriate
  human approval.
- Unknown repositories run only in disposable sandboxes without personal
  credentials.

## Architecture rules

Keep the existing modular monolith:

- `packages/core`: domain contracts, state machines, policies, errors;
- `apps/server/api`: transport, authentication, runtime validation;
- `apps/server/application`: use cases, orchestration, leases, locks, capability
  policy;
- `apps/server/infrastructure`: SQLite, VMware, Hermes, Codex, filesystem, and
  external process adapters;
- `apps/web`: Board interaction, operational evidence, approvals, and health.

Domain and application code must not construct VMware or arbitrary shell
commands. External commands belong in defensive infrastructure adapters with
explicit executables, argument arrays, allowlists, timeouts, bounded output,
stable errors, cancellation, and audit receipts.

Prefer ports and adapters around pinned upstream systems. Do not fork VMware,
Hermes, OpenMontage, Colourlab, or Codex into Northstar. Do not create a second
control plane or a second durable database.

Use additive migrations. Preserve existing local data. Large logs, recordings,
videos, cloned repositories, and binary artifacts do not belong in SQLite;
store bounded metadata and content-addressed/path references.

## Security model

- Prefer authenticated outbound guest-to-controller communication.
- Use one-time enrollment tokens; store only hashes where possible.
- Issue revocable instance credentials after enrollment.
- Bind credentials to Studio/instance scope and rotate them.
- Never log raw enrollment tokens, API keys, OAuth data, Colourlab activation,
  or personal credentials.
- Never give the guest VMware administration, unrestricted host mounts, another
  Studio's data, or the physical host Docker socket.
- Treat heartbeat, job, artifact, and capability payloads as untrusted.
- Validate payload shape, size, identifiers, timestamps, state transition, and
  authorization at the HTTP boundary.
- Give every external request an idempotency key and durable receipt.
- Bound artifact sizes, filenames, paths, retention, and traversal behavior.
- Deny by default when a capability or transition is not explicitly allowed.

## Required delivery strategy

Consult `docs/personal-vmware-implementation-status.md` and choose the first
phase that is not complete. Work on only one coherent slice at a time. A slice
must be small enough to understand, test, and reverse safely.

Before editing:

1. state the selected phase and slice;
2. list the acceptance criteria;
3. identify existing code to reuse;
4. identify migrations, security implications, and likely failure modes;
5. make a short working plan.

While editing:

1. define or update domain behavior first;
2. write or update focused tests with the behavior;
3. implement application use cases;
4. implement infrastructure behind ports;
5. validate the HTTP boundary;
6. add the minimum evidence/UI surface required to operate the feature;
7. avoid unrelated refactors;
8. keep Mock behavior deterministic and live behavior opt-in.

After editing:

1. run targeted tests;
2. run the full verification suite;
3. inspect `git diff` and `git status`;
4. run `git diff --check`;
5. update architecture/current-state documentation if behavior changed;
6. update the implementation status only with verified evidence;
7. report changed files, commands/results, risks, and the exact next gate;
8. stop before a new phase if it requires hardware, credentials, paid software,
   destructive action, or expanded authority.

## Long-running goal behavior

Treat this as one persistent product goal rather than a one-turn coding prompt.
Continue across turns and context compaction without restarting finished work.
At the beginning of every continuation, recover reality from Git, the
implementation-status ledger, tests, and current files instead of relying on a
stale conversational summary.

- Keep the goal active until every Phase 0–8 exit requirement has direct,
  current evidence.
- Complete one small, coherent, reviewable slice per continuation.
- Never mark the goal complete because a Mock, interface, document, or
  scaffolding exists.
- Never mark a phase complete while its required authorized live smoke is
  missing.
- When an external gate prevents phase advancement, continue only with safe
  work that strengthens the current gate: threat analysis, failure/recovery
  tests, no-side-effect preflight, evidence capture, fixtures, runbooks, and
  later-phase interface or acceptance design.
- Safe design work for a later phase must not enable its live path, change its
  ledger status, or be presented as implementation evidence.
- Do not escape a gate by editing another repository, creating a parallel
  control plane, or broadening authority.
- If no further safe in-scope work remains, report the exact minimum user action
  required and preserve all current evidence for the next continuation.

## Phase sequence and exit requirements

### Phase 0 — freeze and implement the Studio contract

Goal: migrate the domain vocabulary away from the fixed 16-employee target
without deleting useful current behavior prematurely.

Implement in small slices:

- `Studio`, `StudioInstance`, `StudioHealth`, job/lease, and artifact contracts;
- explicit state enums and legal transitions;
- stable IDs distinct from VM/process/runtime IDs;
- a narrow `VmProvider` port plus deterministic Mock provider;
- enrollment and heartbeat request/response schemas with runtime validation;
- additive SQLite storage and atomic activity events;
- use cases for create/configure/enroll/heartbeat/offline observation;
- a minimal operational Studio health view;
- compatibility/migration treatment for existing organization data.

Required tests include:

- valid/invalid transitions;
- unknown Studio or instance;
- duplicate enrollment;
- replacing/revoking an instance;
- replayed heartbeat;
- invalid/oversized/untrusted fields;
- stale/offline calculation with deterministic time;
- persistence across repository restart;
- atomic state plus activity append;
- no cross-Studio visibility.

Do not launch a VM, Hermes, Docker, Codex, OpenMontage, or Colourlab.

Exit only when contracts, persistence, HTTP behavior, evidence, UI, and tests use
the same vocabulary and the documented target is accurate.

### Phase 1 — VMware lifecycle adapter

Goal: safely observe and control exactly one configured disposable test VM.

Implement:

- VMware adapter behind `VmProvider`;
- configuration by explicit VM path/ID;
- status, start, stop, suspend, and resume;
- optional named snapshot/checkpoint only if the selected VMware surface proves
  it safely;
- executable/path validation, argument-array execution, timeout, cancellation,
  bounded stdout/stderr, stable error mapping, and activity receipts;
- Mock/fixture contract tests.

Never scan for or control arbitrary VMs. Never run live VMware in automated
tests.

Exit requires full automated tests plus a separately authorized manual smoke
against the configured disposable VM, including cleanup evidence.

### Phase 2 — `northstar-host`, enrollment, and heartbeat

Goal: establish an authenticated, restart-safe guest presence with no model
logic.

Implement:

- a minimal guest service;
- one-time enrollment and instance credential issuance;
- credential revocation/rotation;
- outbound connection/polling protocol;
- health schema for host service, Hermes readiness placeholder, sandbox
  readiness, disk, queue, and version;
- heartbeat freshness and offline detection;
- reconnect/replacement behavior;
- operational Studio health evidence.

Exit when guest restart preserves Studio identity, does not duplicate an active
instance, and offline/reconnect transitions are deterministic and audited.

### Phase 3 — durable job channel

Goal: deliver deterministic work across restarts without duplicate execution.

Implement:

- eligible job claim;
- expiring lease and renewal;
- progress and bounded logs;
- declared artifact metadata and upload/finalization contract;
- cancellation request/acknowledgment;
- complete/fail/pause-for-approval outcomes;
- reconnect reconciliation;
- controller and guest restart behavior;
- idempotency keys and durable receipts.

Exit when a deterministic job can survive either side restarting without losing
the final result or executing twice.

### Phase 4 — one Hermes manager

Goal: prove one real resident manager behind `northstar-host`.

Implement:

- one versioned manager charter;
- one scoped Hermes runtime profile;
- Northstar task-to-Hermes Run mapping;
- cancellation, timeout, approval wait, error, and restart reconciliation;
- durable decision/evidence capture;
- no provider key or organizational authority in Hermes.

Keep automated tests Mock-only. A real provider smoke requires explicit user
approval and secret injection outside the repository.

Exit when one Board task reaches Hermes, respects an approval pause, and returns
attributable evidence to the original durable task.

### Phase 5 — disposable Docker task sandbox

Goal: run unknown repositories without contaminating the Studio base or exposing
secrets.

Implement:

- sandbox request/allocate/run/cancel/collect/destroy lifecycle;
- CPU, RAM, disk, process, duration, network, mount, and secret policy;
- task-only workspace mount;
- image allowlist/pinning and cleanup;
- artifact/evidence collection;
- no host Docker socket and no controller secrets;
- cancellation and orphan reconciliation.

Exit when a harmless fixture repository can be cloned, run, cancelled, have
declared evidence collected, and be removed without altering the base VM.

### Phase 6 — Codex Broker

Goal: make Codex a scoped engineering capability used by Hermes.

Implement:

- versioned broker request/response contracts;
- exact Studio/task/Run/workspace grant;
- initially serialized queue/concurrency;
- allowlisted execution mode such as broker-owned Codex CLI/MCP;
- bounded input/output and timeout/cancellation;
- exact thread/execution mapping;
- changed-file, command, test, and final-status evidence;
- workspace writer lock;
- no Codex credential in the guest;
- restart and orphan reconciliation.

Automated tests use a fake Codex executor. A real Codex smoke requires explicit
user approval and a disposable workspace.

Exit when Hermes can request one coding task, Codex operates only inside the
granted workspace, and Northstar can prove what happened.

### Phase 7 — prove all three Studio boundaries

Goal: create the remaining Studio instances without expanding the control-plane
model.

Implement/prove:

- separate identities, credentials, workspaces, queues, artifact namespaces,
  policies, and manager charters;
- concurrent operation within global and per-Studio limits;
- no cross-Studio read/write;
- CEO-mediated durable handoffs;
- failure of one Studio does not corrupt another.

Exit when all three Studios can run concurrently and isolation tests plus
authorized deployment evidence pass.

### Phase 8 — implement real operating workflows

Implement in this order:

1. GitHub Research & Experience workflow;
2. Content & Marketing evidence-grounded handoff;
3. OpenMontage Video Production;
4. Colourlab AI Creator Standalone grade step;
5. end-to-end CEO review and human publish gate.

Research must never treat a README as proof. It must execute unknown code only
inside the sandbox and produce a real usage report plus editor-ready evidence.

Content must cite Research evidence internally and flag unsupported claims.

Video must preserve editable artifacts and provenance. Code/terminal/UI captures
receive neutral technical correction; creative grading is limited to suitable
footage. Colourlab activation remains outside Northstar and Hermes. If VMware
cannot provide the required GPU path, use a scoped host Video Capability Worker.

No automatic public publishing is part of this phase unless a later explicit
user request defines a capability gateway and approval policy.

## Test and verification policy

Automated tests must not:

- start/control a real VM;
- call a live Hermes/model provider;
- use a real Codex login;
- launch unknown repositories;
- require Docker on the physical host unless the repository already provides an
  explicitly isolated opt-in integration test;
- contact or activate Colourlab;
- publish or mutate external systems.

For each code slice, add relevant:

- domain unit tests;
- SQLite integration tests;
- API validation/authentication tests;
- idempotency/concurrency/restart tests;
- adapter contract tests with fakes;
- UI tests for operational state;
- regression tests for bugs.

Run:

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

Targeted tests are useful during work, but the full suite is mandatory before
claiming a slice complete. If an existing unrelated test fails, investigate and
report evidence; do not hide it, delete it, or call the suite successful.

## Decision rules

- Make reversible, in-scope technical decisions using existing repository
  patterns.
- Ask only when the missing decision changes authority, paid services, hardware,
  external effects, data loss risk, or product scope.
- Prefer the simplest architecture that satisfies durability, isolation,
  recovery, and evidence.
- Do not add queues, services, databases, frameworks, or permanent Agents merely
  because they are common in enterprise diagrams.
- Do not replace a working bounded component without evidence.
- Do not claim a live integration works based only on a Mock.
- If blocked by an external gate, finish all safe code, tests, documentation, and
  fixtures first, then report one precise manual action.

## Required final handoff after each slice

Provide:

1. outcome in one paragraph;
2. selected phase and acceptance criteria;
3. changed files and why;
4. migrations/data compatibility;
5. tests and exact results;
6. manual checks performed or still required;
7. security/recovery implications;
8. known limitations;
9. next safe slice and its gate;
10. confirmation that no commit/push/external effect occurred unless explicitly
    requested.

Do not say the system, phase, or integration is complete unless its documented
exit criteria are actually satisfied.

Begin now by reading the mandatory files and selecting the first incomplete
phase and its smallest safe slice from the implementation-status ledger. Do not
repeat a completed slice and do not jump over a phase gate to VMware, Hermes,
Codex, OpenMontage, Colourlab, or a real department workflow.
