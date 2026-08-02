# Personal VMware implementation status

This file records verified implementation progress. Plans and intentions do not
count as completion. Update a phase only when its exit criteria have evidence.

## Current baseline

- Branch: `codex/personal-vmware-foundation`
- Target: private VMware-based Northstar system
- Current application: Studio-v1 Northstar planner with SQLite, Mock runtime,
  Hermes adapter seam, task/Run locking, approvals, and evidence UI; the old
  16-identity roster remains compatibility data rather than planning authority
- Migration target: one CEO plus three durable Studios, one Hermes manager per
  Studio, and temporary workers per Run
- Next phase: Phase 1

## Phase ledger

| Phase | Status | Evidence | Blocking gate |
| --- | --- | --- | --- |
| 0. Freeze Studio contract | Complete | Studio-v1 planning contract, Mock VM boundary, additive persistence, validated API, heartbeat/offline supervision, three-Studio bootstrap, manager-owned temporary-work plans, and health UI | None |
| 1. VMware lifecycle spike | In progress | Single-target Fusion adapter, durable idempotency/evidence, strict API, disabled-by-default configuration, and fake-runner tests | User-approved disposable VMware test VM for the manual smoke |
| 2. Enrollment and heartbeat | Not started | — | Phase 1 contract complete |
| 3. Reliable job channel | Not started | — | Phase 2 complete |
| 4. One Hermes manager | Not started | Existing Hermes seam is not this phase's VM proof | Hermes provider configuration and user-approved live smoke |
| 5. Disposable task sandbox | Not started | — | Phase 4 complete; safe guest Docker environment |
| 6. Codex Broker | Not started | Design only | Phase 5 complete; user-approved local Codex smoke |
| 7. Remaining Studio isolation | Not started | — | First Studio end-to-end proof |
| 8. Real department workflows | Not started | Operating contracts only | Foundation phases complete |

Allowed status values are `Not started`, `In progress`, `Blocked`, and
`Complete`. `Blocked` must name a concrete external gate. Never mark a phase
`Complete` because files were scaffolded or a Mock response was displayed.

## Evidence required for each update

Record:

- date and phase/slice;
- acceptance criteria proved;
- files or migrations involved;
- exact tests and results;
- manual smoke evidence, if any;
- known limitations;
- next safe action.

## Change log

### 2026-07-31 — Phase 0, core Studio vocabulary

- Added durable `Studio` and replaceable `StudioInstance` contracts without
  treating VM provider IDs as organizational identity.
- Added Studio health, heartbeat freshness, job lease, and external artifact
  metadata contracts. Large artifacts remain outside SQLite.
- Added explicit Studio and instance transition rules, deterministic heartbeat
  freshness evaluation, and active-lease expiry evaluation.
- Added seven focused tests covering valid and terminal transitions, recovery,
  deterministic fresh/stale/offline thresholds, invalid thresholds/timestamps,
  and lease expiry.
- Added an application-level `VmProviderPort` with opaque configured targets,
  lifecycle observations, idempotent requests, and execution receipts.
- Added a deterministic Mock VM provider that rejects unknown targets, invalid
  lifecycle actions, and conflicting reuse of an idempotency key. It does not
  discover or execute any real VM.
- Added four Mock provider contract tests.
- Added additive `studios` and `studio_instances` tables while preserving the
  current company, team, Agent, task, and Run records.
- Added repository operations for creating and transitioning Studios, creating
  one current instance, and explicitly replacing an instance by revoking the
  prior generation in the same transaction.
- Extended the existing activity ledger with nullable Studio and instance
  attribution. Studio creation and replacement append activity in the same
  transaction as the state change.
- Added four SQLite integration tests covering atomic evidence, duplicate
  rejection, replacement/revocation, repository restart, and migration of an
  existing activity table.
- Verified `npm run typecheck`, `npm test` (33 tests), `npm run build`, and
  `git diff --check`.
- No HTTP enrollment/heartbeat, credential handling, health UI, or live
  integration is implemented yet. Phase 0 remains in progress.

Next safe slice: add runtime-validated local Controller endpoints for Studio
creation, instance creation/replacement, and heartbeat input, with stable error
responses and no guest credential issuance yet.

### 2026-07-31 — Phase 0, Controller API and health evidence

- Added an application-level `StudioService` behind a `StudioRepositoryPort`;
  HTTP handlers do not own Studio orchestration or SQLite behavior.
- Added strict Zod schemas and local Controller routes for listing/creating
  Studios, creating or explicitly replacing an instance, and reporting a
  heartbeat.
- Error responses retain the compatible `error` string and add stable
  `INVALID_REQUEST`, `INVALID_JSON`, `NOT_FOUND`, `CONFLICT`, or `BAD_REQUEST`
  codes.
- Added durable heartbeat receipts. An identical idempotency-key replay does
  not update state or append activity; conflicting reuse is rejected.
- Added persisted health snapshots and deterministic fresh/stale/offline
  evaluation. Cross-Studio heartbeat attribution is rejected.
- Added a read-only Studios view showing durable Studio state, current instance
  generation, VM lifecycle, component health, queue counts, heartbeat time, and
  host version.
- Added two SQLite heartbeat/isolation tests and five loopback HTTP contract
  tests. HTTP tests bind only a random local port and perform no external calls.
- Verified `npm run typecheck`, `npm test` (40 tests), `npm run build`, and
  `git diff --check`.
- No guest credential, enrollment token, real VM command, Hermes process,
  Docker sandbox, Codex login, or external effect was used.

Next safe slice: add explicit Studio configure/status use cases and a
deterministic offline-observation transition with idempotent activity evidence,
then document and test the compatibility path from the old roster to the three
committed Studio managers.

### 2026-07-31 — Phase 0, lifecycle supervision and compatibility bootstrap

- Added explicit application use cases and a strict local `PATCH` route for
  legal Studio lifecycle transitions.
- Added deterministic offline observation. A timed-out online/degraded instance
  becomes offline with atomic activity evidence; a repeated observation makes
  no second change, and a later heartbeat can recover it.
- Made concurrent/off-repeat observation append evidence only when the guarded
  status update actually changes the instance.
- Added an idempotent startup bootstrap for exactly three committed Studios.
  It reuses Kai for Research, Mira for Content, and Rowan for Video without
  increasing the 16-identity compatibility roster. A conflicting stable key
  fails closed.
- Added durable `sortOrder` to the Studio contract and additive migration after
  full-suite testing exposed nondeterministic same-timestamp ordering. Research,
  Content, and Video now retain their intended order across restarts.
- Documented that these are bootstrap identities, not final Hermes charters or
  proof of live department execution.
- Added three application tests and two HTTP tests for bootstrap replay,
  conflicting identity, legal/illegal transitions, loopback mutation origin,
  offline replay, and recovery.
- Verified `npm run typecheck`, `npm test` (45 tests), `npm run build`, and
  `git diff --check`.
- No real VM, guest credential, Hermes process, Docker sandbox, Codex login, or
  external effect was used.

Phase 0 is still in progress because the current Board planner routes through
legacy Teams and four fixed direct reports per manager. The registry and UI use
Studio vocabulary, but the active planning path does not yet.

Next safe slice: migrate company planning input and durable task ownership from
the fixed Team/direct-report assumption to the three Studio managers and
temporary per-Run worker descriptions, while preserving historical Team/Agent
records for compatibility.

### 2026-07-31 — Phase 0, active Studio planning contract

- Replaced the active Team/direct-report graph contract with
  `CEO -> 1–3 Studios -> 0–4 temporary Run worker descriptions`. The graph no
  longer supplies or accepts permanent specialist Agent IDs.
- Added explicit `workflow`, `subagent`, and `sandbox` temporary-worker kinds.
  A manager may keep work without inventing a worker, and duplicate worker keys
  fail validation.
- Bumped the company graph to version 2. A running version-1 checkpoint fails
  closed with recovery guidance instead of being interpreted under the new
  state schema. Completed legacy plans remain readable as
  `legacy-team-v1`.
- Added an additive nullable `tasks.studio_id` migration. New Studio mission and
  temporary-work-package tasks are Studio-attributed and remain owned by the
  durable Studio Manager; no new Agent row is created for temporary compute.
- Added strict Studio targeting to the directive API and UI. A request cannot
  claim both Studio and legacy Team authority. Legacy Team selection can map to
  the compatible Studio manager without making Team the new planner input.
- Updated Board chat results and task evidence to show Studios and temporary
  execution units while retaining a labeled view for historical Team plans.
- Added acceptance coverage for Studio-only graph input, zero-worker manager
  plans, duplicate temporary descriptions, idempotent three-Studio persistence,
  manager ownership, absence of specialist Agent assignment, incompatible
  checkpoint rejection, directive authority, and HTTP validation.
- Verified `npm run typecheck`, `npm test` (48 tests: 10 core and 38 server),
  `npm run build`, and `git diff --check`.
- No real VM, VMware command, guest credential, Hermes process, Docker
  sandbox, Codex login, paid tool, or external side effect was used.

Phase 0 exit is satisfied: the architecture, core contracts, active planner,
durable task ownership, API/UI vocabulary, and acceptance tests now agree that
Studios and their managers are durable while temporary workers are execution
descriptions.

Next safe slice: begin Phase 1 with a VMware-only infrastructure adapter around
one explicitly configured VM target. Keep command execution behind an injected
runner, add allowlist/argument/idempotency/activity tests, and do not run a real
VM command until the user supplies and approves a disposable test VM.

### 2026-07-31 — Phase 1, single-target VMware Fusion lifecycle path

- Added `VmwareFusionProvider` behind the existing `VmProviderPort`. It accepts
  exactly one `(Studio instance ID, absolute .vmx path)` tuple and rejects every
  other target before invoking its runner.
- Added a direct `NodeProcessRunner` based on `execFile`; no shell, command
  string, path tokenization, or VM discovery command is used.
- Implemented allowlisted start, soft-stop, soft-suspend, and resume argument
  vectors. State observation examines only the configured VM's `.vmx.lck`,
  VMX `checkpoint.vmState`, and in-bundle `.vmss`.
- Added additive `vm_lifecycle_operations` persistence. A request is recorded
  pending before execution, then completed or failed with Studio-attributed
  activity evidence.
- Added cross-restart idempotent replay, conflicting-key rejection, concurrent
  pending rejection, failed-attempt replay protection, provider-receipt
  validation, and an explicit ambiguous pending state if durable completion
  fails after VMware reports success.
- Added strict loopback Controller routes for observation and lifecycle
  actions. Clients cannot submit a provider path, cross-Studio attribution is
  rejected, and lifecycle remains `VM_NOT_CONFIGURED` by default.
- Added all-or-none `VMWARE_FUSION_*` configuration and startup verification
  that the configured Studio, instance, and VMX path match SQLite.
- Added the manual disposable-VM runbook with authority, evidence, stop
  conditions, and cleanup requirements.
- Added fourteen Phase 1 tests covering configuration, adapter command vectors,
  spaces in paths, target isolation, idempotency, restart, concurrency, command
  failure, path escape rejection, HTTP validation, evidence, and disabled mode.
- Verified `npm run typecheck`, `npm test` (62 tests: 10 core and 52 server),
  `npm run build`, and `git diff --check`.
- No real `vmrun`, VM, credential, Hermes process, Docker sandbox, Codex login,
  paid tool, or external side effect was used.

Phase 1 remains in progress. Its safe code and Mock acceptance surface are
implemented, but the exit criterion also requires a user-approved manual smoke
against one disposable VMware Fusion VM.

Next gate: follow `docs/runbooks/vmware-fusion-lifecycle-smoke.md` only after
the user supplies and authorizes the disposable VM. Do not begin Phase 2 before
that evidence exists.

### 2026-07-31 — Phase 1, provider evidence contract hardening

- Added application-level runtime validation for VM provider observations
  before they are written to Studio activity. A mismatched target, unknown
  lifecycle status, or invalid observation timestamp now fails closed without
  appending `vm.lifecycle_observed`.
- Strengthened lifecycle receipt validation beyond target/action identity.
  Provider receipt IDs must be present and bounded, action-specific
  before/after states must form a legal transition, and start/finish timestamps
  must be valid and ordered.
- A semantically invalid receipt is durably recorded as a failed operation.
  Replaying its idempotency key returns the prior failure and never calls the
  provider again, preventing false success evidence and blind external retry.
- Added five test cases covering invalid observation timing, impossible state
  transitions, reversed timing evidence, empty receipt identity, durable
  failure evidence, and replay protection.
- Verified `npm run typecheck`, `npm test` (67 tests: 10 core and 57 server),
  `npm run build`, and `git diff --check`.
- No real `vmrun`, VM, credential, Hermes process, Docker sandbox, Codex login,
  paid tool, or external side effect was used.

Phase 1 remains in progress because provider-contract hardening is not a
substitute for the user-approved disposable-VM lifecycle smoke.

### 2026-07-31 — Phase 1, no-command startup preflight

- Added an infrastructure-only VMware Fusion preflight that checks only the
  exact configured `vmrun` and VMX files. The first must be an executable
  regular file and the second a readable regular file.
- The preflight returns readiness booleans and the Studio instance identity,
  but not either personal host path. It never calls the process runner,
  enumerates a directory, discovers VMs, or appends lifecycle evidence.
- Wired startup to await the preflight before the loopback HTTP server begins
  listening. A fully populated but unusable VMware configuration now fails
  closed at startup instead of exposing lifecycle endpoints that can only fail
  later.
- Added four test cases proving the exact two file checks, zero runner calls,
  and fail-closed behavior for a non-executable `vmrun` or unreadable VMX.
- Verified `npm run typecheck`, `npm test` (71 tests: 10 core and 61 server),
  `npm run build`, and `git diff --check`.
- No real `vmrun`, VM, credential, Hermes process, Docker sandbox, Codex login,
  paid tool, directory scan, or external side effect was used.

Phase 1 remains in progress. The preflight reduces manual-smoke risk but does
not prove lifecycle behavior against the installed VMware Fusion version.

### 2026-07-31 — Phase 1, provider diagnostic path redaction

- Added an explicit `VmProviderError` boundary for diagnostics that an
  infrastructure adapter has sanitized for durable local evidence. Unknown
  provider errors are no longer trusted or persisted verbatim.
- The VMware Fusion adapter replaces its exact configured `vmrun` and VMX paths
  with stable labels before an observation or command failure leaves the
  infrastructure layer.
- The application applies defense-in-depth redaction for the configured VM
  target, persists only trusted or generic diagnostics, and returns stable
  observation/operation failure messages to HTTP clients. Failed idempotent
  replays no longer echo the stored provider diagnostic.
- Added three test cases proving adapter-level path replacement, generic
  observation failures, and that neither lifecycle HTTP responses nor durable
  failure activity exposes an untrusted executable or VMX path.
- Verified `npm run typecheck`, `npm test` (74 tests: 10 core and 64 server),
  `npm run build`, and `git diff --check`.
- No real `vmrun`, VM, credential, Hermes process, Docker sandbox, Codex login,
  paid tool, host-path probe, or external side effect was used.

Phase 1 remains in progress. Path-safe diagnostics make its future manual
evidence safer, but do not replace the disposable-VM lifecycle smoke.

### 2026-07-31 — Phase 1, redacted lifecycle evidence bundle

- Added a provider-independent, read-only lifecycle evidence service and
  Controller endpoint for one exact Studio-instance pair.
- Evidence remains readable when the live VMware provider is disabled and after
  an instance has been replaced and revoked. Exact Studio ownership is enforced,
  so a cross-Studio request fails without exposing another Studio's history.
- Operations and lifecycle activity are returned newest first, bounded to 100
  entries per collection, with explicit truncation flags. Idempotency keys that
  do not satisfy the public API contract are replaced with a stable redaction
  marker.
- The public bundle deliberately excludes provider targets, provider receipt
  identifiers, raw error diagnostics, and activity summaries/details. It
  exposes only the lifecycle facts needed to review a future manual smoke.
- Added application and HTTP coverage for repository restart, instance
  replacement/revocation, provider-disabled reads, cross-Studio isolation,
  bounded output, and unsafe idempotency-key redaction.
- Verified `npm run typecheck`, `npm test` (76 tests: 10 core and 66 server),
  `npm run build`, and `git diff --check`.
- No real `vmrun`, VM, credential, Hermes process, Docker sandbox, Codex login,
  paid tool, provider directory scan, or external side effect was used.

Phase 1 remains in progress. This bundle makes future manual-smoke evidence
safer and recoverable, but it does not replace the user-approved disposable-VM
lifecycle smoke.

### 2026-07-31 — Phase 1, explicit lifecycle action arming

- Separated exact VMware target configuration from write authority. A complete
  target now starts read-only by default, so no start, stop, suspend, or resume
  request can reach the provider merely because paths were configured.
- Added strict `VMWARE_FUSION_ACTIONS_ARMED` parsing. Only the exact value
  `true` arms actions; invalid values fail startup, and arming without all four
  target values is rejected.
- Added an application-level gate before target lookup, durable operation
  creation, activity append, or provider execution. An unarmed action returns
  the stable HTTP response `403 VM_ACTIONS_NOT_ARMED`, while read-only
  observation and historical evidence remain available.
- Updated startup reporting, configuration examples, architecture, and the
  manual smoke runbook. The runbook now defines a short explicit arming window
  after Board approval and requires disarming before target cleanup.
- Added configuration, application, and HTTP contract tests proving read-only
  observation still works while unarmed actions create no operation, append no
  request evidence, and make no Mock provider call.
- Verified `npm run typecheck`, `npm test` (79 tests: 10 core and 69 server),
  `npm run build`, and `git diff --check`.
- No real `vmrun`, VM, credential, Hermes process, Docker sandbox, Codex login,
  paid tool, host write, or external side effect was used.

Phase 1 remains in progress. Explicit arming narrows the future authorized
smoke window but does not replace the user-approved disposable-VM lifecycle
smoke.

### 2026-07-31 — Phase 1, expiring lifecycle action window

- Replaced indefinite action arming with an explicit absolute expiry. When
  `VMWARE_FUSION_ACTIONS_ARMED=true`, configuration now also requires
  `VMWARE_FUSION_ACTIONS_ARMED_UNTIL`.
- Startup rejects a missing, invalid, expired, or longer-than-30-minute action
  window. The accepted deadline is normalized to an ISO-8601 instant.
- The application re-evaluates time before every lifecycle action. Once the
  deadline is reached, it returns the stable HTTP response
  `403 VM_ACTIONS_ARMING_EXPIRED` before target lookup, operation persistence,
  activity append, or provider execution.
- Read-only observation and historical evidence remain available after expiry,
  so automatic disarming does not remove diagnostic access.
- Updated startup reporting, environment examples, architecture, and the
  manual smoke runbook to show the bounded authorization window and cleanup of
  both arming values.
- Added deterministic configuration, application, and HTTP tests for valid
  offset timestamps, normalization, missing deadlines, expired deadlines,
  overlong windows, exact-boundary expiry, stable errors, and zero provider or
  durable-operation side effects.
- Verified `npm run typecheck`, `npm test` (82 tests: 10 core and 72 server),
  `npm run build`, and `git diff --check`.
- No real `vmrun`, VM, credential, Hermes process, Docker sandbox, Codex login,
  paid tool, host write, or external side effect was used.

Phase 1 remains in progress. The expiring window limits future action authority
but does not replace the user-approved disposable-VM lifecycle smoke.

### 2026-07-31 — Phase 1, path-free lifecycle access snapshot

- Added a read-only runtime access service and exact Studio-instance endpoint:
  `GET /api/studios/:studioId/instances/:instanceId/vm/access`.
- The snapshot reports configured and preflight state, action mode
  (`disabled`, `read_only`, `armed`, or `expired`), whether actions are
  currently allowed, the bounded expiry, and observation time.
- It exposes no `vmrun` path, VMX path, provider receipt, credential, or raw
  diagnostic. A cross-Studio instance attribution fails instead of revealing
  another Studio's runtime configuration.
- The endpoint remains available when VMware is disabled and re-evaluates an
  armed deadline at read time, so the operator can capture before/armed/expired
  or cleaned-up states without invoking `vmrun`.
- Kept the distinction between runtime configuration and authority explicit:
  this snapshot is operational evidence for the manual runbook, not a durable
  Board approval and not proof that a lifecycle action executed.
- Updated architecture, README, and the smoke runbook to capture access
  snapshots before arming, during the action window, and after expiry or
  cleanup.
- Added application and HTTP coverage for all four modes, exact-boundary
  expiry, provider-path absence, disabled-provider access, and cross-Studio
  isolation.
- Verified `npm run typecheck`, `npm test` (83 tests: 10 core and 73 server),
  `npm run build`, and `git diff --check`.
- No real `vmrun`, VM, credential, Hermes process, Docker sandbox, Codex login,
  paid tool, host write, or external side effect was used.

Phase 1 remains in progress. The access snapshot makes the future smoke's
runtime authority observable but does not replace explicit Board approval or
the disposable-VM lifecycle smoke.

### 2026-08-01 — Phase 1, read-only smoke evidence checker

- Added a provider-independent `VmLifecycleSmokeCheckService` and exact
  Studio-instance Controller endpoint. The checker reads only the existing
  redacted durable evidence bundle and never receives or invokes a VM provider.
- Bound one smoke session to four predictable idempotency keys:
  `<prefix>-start`, `-suspend`, `-resume`, and `-stop`. The prefix is strictly
  validated and cannot contain a host path or arbitrary command text.
- The automated result requires exactly one successful recorded operation for
  each action, recorded receipts without failures, the exact
  `stopped -> running -> suspended -> running -> stopped` transition chain,
  valid ordered timestamps, non-truncated operation/activity evidence, and
  minimum requested/succeeded/observed activity counts.
- Kept the proof boundary explicit. Every result returns manual requirements
  for Board approval, access snapshots, the retained replay response,
  activity-to-session correlation, proof that another VM was untouched,
  installed versions, final observation, disarming, and cleanup. Therefore
  `automatedChecksPassed: true` is necessary evidence, not Phase 1 completion.
- The endpoint remains readable while VMware is disabled and rejects invalid
  prefixes or cross-Studio attribution. Its response excludes provider paths,
  receipt identifiers, raw diagnostics, and activity details.
- Updated the README, architecture, and manual smoke runbook with the shared
  session-key convention, the checker call, and the remaining manual proof.
- Added application and loopback HTTP coverage for success, replay without a
  duplicate operation, missing/truncated/chronologically invalid evidence,
  insufficient activity, invalid prefixes, cross-Studio isolation,
  provider-disabled access, path absence, and zero extra provider calls.
- Verified `npm run typecheck`, `npm test` (85 tests: 10 core and 75 server),
  `npm run build`, and `git diff --check`.
- No real `vmrun`, VM, credential, Hermes process, Docker sandbox, Codex login,
  paid tool, host write, or external side effect was used.

Phase 1 remains in progress. The checker reduces ambiguity in the future
manual run but cannot replace the user-approved disposable-VM lifecycle smoke.

### 2026-08-01 — Phase 1, indeterminate durable-completion boundary

- Closed the failure gap when a provider returns a valid success receipt or
  throws but SQLite cannot persist the corresponding final operation state.
  The application now returns stable `VM_OPERATION_INDETERMINATE` instead of
  leaking the raw persistence exception.
- Preserved the fail-safe recovery semantics: the operation remains `pending`,
  is not falsely marked failed, receives no fabricated provider receipt, and a
  replay of the same idempotency key cannot invoke the provider again.
- Mapped the indeterminate result to an HTTP `409` conflict with a path-free
  instruction to reconcile durable evidence and actual VM state before any
  retry. Existing provider, executable, VMX, and SQLite diagnostics remain
  outside the public response.
- Updated the README, architecture, and manual smoke runbook with the explicit
  stop condition and the rule against retrying with the same or a substitute
  key before manual state inspection.
- Added application and loopback HTTP fault-injection coverage proving one
  provider execution for both success-finalization and failure-finalization
  faults, zero false rewrites, retained pending/request evidence, stable error
  mapping, path redaction, and duplicate replay protection.
- Verified `npm run typecheck`, `npm test` (88 tests: 10 core and 78 server),
  `npm run build`, and `git diff --check`.
- No real `vmrun`, VM, credential, Hermes process, Docker sandbox, Codex login,
  paid tool, host write, or external side effect was used.

Phase 1 remains in progress. This closes a dangerous failure-reporting gap but
does not replace the user-approved disposable-VM lifecycle smoke.

### 2026-08-01 — Phase 1, configured-directory diagnostic redaction

- Extended VMware adapter diagnostics beyond exact-file replacement. The
  configured `vmrun` and VMX files, their non-root parent directories, and
  in-bundle state-file paths are now replaced with stable scoped labels before
  an adapter error can reach application evidence.
- Kept redaction precise and useful: only paths derived from the two explicitly
  configured files are replaced, longest values are processed first, and a
  filesystem root is never used as a replacement token.
- Added a regression test using VMware application and VM bundle directories
  containing spaces, plus a `.vmss` state path. Both command and observation
  failures retain safe labels while excluding the executable directory, VM
  directory, and state-file path.
- Updated the README, architecture, and manual smoke runbook with the expanded
  path boundary and an explicit stop condition if any configured absolute path
  appears in public or durable evidence.
- Verified `npm run typecheck`, `npm test` (89 tests: 10 core and 79 server),
  `npm run build`, and `git diff --check`.
- No real `vmrun`, VM, credential, Hermes process, Docker sandbox, Codex login,
  paid tool, host write, or external side effect was used.

Phase 1 remains in progress. This hardens future smoke diagnostics but does not
replace the user-approved disposable-VM lifecycle smoke.

### 2026-08-01 — Phase 1, forced-termination indeterminate semantics

- Closed the lifecycle ambiguity when the bounded process runner kills
  `vmrun`. A wall-clock timeout or output-limit overflow is now an explicit
  indeterminate provider outcome rather than an ordinary failed command.
- Preserved the durable no-retry invariant: the application leaves the
  pre-existing operation `pending`, records no false failure or fabricated
  receipt, returns stable `VM_OPERATION_INDETERMINATE`, and rejects a replay of
  the same idempotency key before it can reach the provider again.
- Kept confirmed command failures separate. A normal nonzero exit remains a
  sanitized `failed` outcome, while only forced termination takes the
  reconcile-before-retry path.
- Extended the process result contract with an explicit output-bound signal.
  The Node runner distinguishes `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` from a
  timeout, retains the fixed executable plus literal argument-array boundary,
  and continues to cap captured output.
- Added safe process-boundary tests using only the current local Node binary,
  plus Fusion-adapter and lifecycle-service regressions for timeout,
  output-limit, redaction, pending evidence, and duplicate replay protection.
  Automated tests still inject the VMware process runner and never execute
  `vmrun`.
- Updated the README, architecture, and manual smoke runbook so an operator
  stops immediately, inspects actual VM state, and never substitutes a fresh
  key after either forced-termination condition.
- Verified `npm run typecheck`, `npm test` (96 tests: 10 core and 86 server),
  `npm run build`, and `git diff --check`. The first sandboxed test attempt
  could not bind loopback (`listen EPERM`); the same Mock-only suite passed
  outside that network sandbox.
- No real `vmrun`, VM, credential, Hermes process, Docker sandbox, Codex login,
  paid tool, host write, or external side effect was used.

Phase 1 remains in progress. The forced-termination boundary prevents unsafe
retries but does not replace the user-approved disposable-VM lifecycle smoke.

### 2026-08-01 — Phase 1, post-command verification boundary

- Closed the remaining ambiguity after `vmrun` returns a zero exit. If the
  configured lock/checkpoint observation then throws, cannot be read, or fails
  to reach the expected state within the bounded attempts, the adapter now
  reports an explicit indeterminate outcome instead of a failed command.
- Applied the same rule to any delay or receipt-clock error after command
  success. Once the external command has returned success, Northstar cannot
  truthfully claim the VM action failed merely because local verification could
  not finish.
- Preserved the existing durable recovery behavior: the lifecycle operation
  remains `pending`, no false failure activity or provider receipt is recorded,
  HTTP returns stable `VM_OPERATION_INDETERMINATE`, and a replay of the same key
  cannot call the provider again.
- Kept pre-command and confirmed nonzero-exit failures separate. Observation
  failure before invoking `vmrun` still issues no command, while a sanitized
  ordinary command failure remains durably `failed` and non-retryable.
- Added Fusion-adapter regressions for a path-bearing checkpoint read failure
  after command success and for a successful command whose observed state does
  not converge. Both prove one command call, sanitized diagnostics, and the
  indeterminate provider classification. Existing application/API tests prove
  retained pending evidence, stable public errors, and duplicate replay
  protection for every indeterminate provider outcome.
- Updated the README, architecture, and manual smoke runbook to make a zero
  process exit insufficient proof until the configured VM state converges.
- Verified `npm run typecheck`, `npm test` (99 tests: 10 core and 89 server),
  `npm run build`, and `git diff --check`.
- No real `vmrun`, VM, credential, Hermes process, Docker sandbox, Codex login,
  paid tool, host write, or external side effect was used.

Phase 1 remains in progress. Post-command verification is now fail-safe, but
only the user-approved disposable-VM lifecycle smoke can satisfy the remaining
exit gate.

### 2026-08-01 — Phase 1, fail-closed filesystem observation

- Fixed the default Node filesystem adapter so only `ENOENT` means that a VM
  lock or checkpoint path is absent. Permission errors, symlink loops,
  malformed path components, and other access failures now propagate instead
  of silently becoming `false` and an incorrect stopped/suspended state.
- Preserved the command boundary on both sides. A non-missing lookup error
  during the initial observation fails before any runner call; the same error
  after a successful command becomes an indeterminate provider result because
  the external VM state may already have changed.
- Kept diagnostics path-safe. The real Node error is bounded and replaces the
  configured VMX/bundle path with scoped labels before leaving the adapter.
  Application/API handling continues to retain pending evidence and prohibit
  duplicate execution for every indeterminate outcome.
- Added two adapter regressions using a temporary readable VMX and a
  self-referential `.vmx.lck` symlink to produce a real operating-system
  `ELOOP`. The pre-command case proves zero runner calls; the post-command case
  uses an injected fake runner, proves exactly one call, and returns
  `indeterminate`. A genuinely missing lock remains a normal stopped
  observation.
- Updated the README, architecture, and manual smoke runbook with the strict
  absence/error distinction and the rule to disarm before repairing VM bundle
  files.
- Verified `npm run typecheck`, `npm test` (101 tests: 10 core and 91 server),
  `npm run build`, and `git diff --check`.
- No real `vmrun`, VM, credential, Hermes process, Docker sandbox, Codex login,
  paid tool, or external side effect was used. Tests created and removed only
  disposable files under the operating-system temporary directory.

Phase 1 remains in progress. Filesystem observation now fails closed, but the
user-approved disposable-VM lifecycle smoke remains the sole exit gate.

### 2026-08-01 — Phase 1, process-signal indeterminate semantics

- Extended the bounded process result contract to retain the operating-system
  termination signal reported by Node `execFile`. A signal is no longer lost
  and collapsed into the same exit-127 shape as an ordinary spawn/command
  failure.
- Classified an independent signal termination as externally indeterminate,
  alongside timeout and output-limit termination. `SIGTERM`, `SIGKILL`, or a
  similar interruption may arrive after `vmrun` has already changed VM state,
  so Northstar must retain pending evidence and reconcile before retry.
- Kept classification precedence explicit: a known timeout remains a timeout
  even though Node may also report its kill signal; an output-limit overflow
  remains output-limited; a standalone signal is separately identified. A
  normal nonzero exit with no forced-termination marker remains a sanitized
  failed operation.
- Added a safe process-boundary regression in which only a child Node process
  sends itself `SIGTERM`, plus a fake-runner VMware regression proving that a
  signalled `vmrun` result produces the indeterminate provider outcome. The
  existing application/API tests continue to prove pending evidence, stable
  HTTP conflict, and duplicate replay protection.
- Updated the README, architecture, and manual smoke runbook so signal
  termination is an explicit stop-and-inspect condition.
- Verified `npm run typecheck`, `npm test` (103 tests: 10 core and 93 server),
  `npm run build`, and `git diff --check`.
- No real `vmrun`, VM, credential, Hermes process, Docker sandbox, Codex login,
  paid tool, or external side effect was used. The only signalled process was a
  disposable child running the current local Node executable.

Phase 1 remains in progress. Signal interruption can no longer create false
failure evidence, but the user-approved disposable-VM lifecycle smoke remains
the sole exit gate.

### 2026-08-01 — Phase 1, configured-file replacement boundary

- Changed the default filesystem readiness check from `stat` to `lstat`, so the
  final configured `vmrun` and VMX path components must be direct regular files
  and cannot silently redirect Northstar through a symbolic link.
- Repeated the no-command readiness check immediately before every new
  lifecycle action. A `vmrun` or VMX file removed, made inaccessible, or
  replaced after startup now stops the request before the process runner; an
  earlier startup preflight is no longer treated as permanent authority.
- Revalidated the VMX final path for every read-only observation, including the
  running-state path that otherwise only reads `.vmx.lck`. VMX reads perform a
  second direct-file check before reading content.
- Kept state observation fail-closed without following links. A direct
  `.vmx.lck` or in-bundle `.vmss` symbolic link is an error even when its target
  exists, while only a genuinely absent path (`ENOENT`) remains normal absence.
- Added ten safe test cases using only disposable temporary files and an
  injected fake runner. They cover configured `vmrun`/VMX links at startup,
  both paths being replaced after a successful preflight, read-only VMX
  replacement, running-lock and checkpoint-state links, zero runner calls, and
  path-redacted diagnostics.
- Verified `npm run typecheck`, `npm test` (113 tests: 10 core and 103 server),
  `npm run build`, and `git diff --check`. The first sandboxed full-test attempt
  could not bind loopback (`listen EPERM`); the same Mock-only suite passed
  outside that network sandbox.
- No real `vmrun`, VM, credential, Hermes process, Docker sandbox, Codex login,
  paid tool, host lifecycle change, or external side effect was used. Tests
  created and removed only disposable files under the operating-system
  temporary directory.

Phase 1 remains in progress. The fresh checks narrow configured-file
replacement risk but cannot eliminate a race by a privileged local host process
between the final check and `execFile`; the physical host remains a trusted
boundary. The user-approved disposable-VM lifecycle smoke is still the sole
exit gate.

### 2026-08-01 — Phase 1, rejected process-runner boundary

- Closed an ambiguity when `ProcessRunner.run()` rejects instead of returning a
  structured process result. Once execution crosses that boundary, Northstar
  cannot prove that the child process was never spawned or that the VM remained
  unchanged.
- The Fusion adapter now converts a runner rejection into an explicitly
  `indeterminate` provider outcome and sanitizes the diagnostic before it leaves
  infrastructure. The application therefore retains the already-persisted
  operation as pending, records no false failure, and applies the existing
  reconcile-before-retry rule.
- Kept ordinary confirmed nonzero exits as failed operations. Timeout,
  output-limit termination, operating-system signals, rejected runner
  boundaries, and post-command verification failures remain the distinct
  ambiguous cases.
- Added a fake-runner regression proving exactly one attempted runner call, no
  fabricated VM state transition, configured-path redaction, and the
  indeterminate classification. Existing application/API recovery tests cover
  pending evidence, stable HTTP conflict, and duplicate replay protection for
  an indeterminate provider outcome.
- Verified `npm run typecheck`, `npm test` (114 tests: 10 core and 104 server),
  `npm run build`, and `git diff --check`.
- No real `vmrun`, VM, credential, Hermes process, Docker sandbox, Codex login,
  paid tool, host lifecycle change, or external side effect was used.

Phase 1 remains in progress. A rejected runner can no longer create false
failure evidence, but the user-approved disposable-VM lifecycle smoke remains
the sole exit gate.

### 2026-08-01 — Phase 1, per-instance pending lifecycle exclusivity

- Closed a concurrency gap where two different idempotency keys could create
  simultaneous pending lifecycle operations for the same Studio instance and
  both reach the VM provider. Same-key replay protection alone was not a VM
  action lock.
- Added an atomic repository check inside `BEGIN IMMEDIATE` and a partial unique
  SQLite index on pending lifecycle operations per Studio instance. Completed
  or failed history remains append-only while exactly one pending operation
  owns the instance-level execution right.
- Mapped a different key or action behind an existing pending operation to the
  stable `409 VM_OPERATION_IN_PROGRESS` response before any provider call or
  second request activity event. This also enforces the existing rule that an
  indeterminate operation cannot be bypassed with a substitute key.
- Preserved recovery across controller restart: a durable pending operation
  continues to exclude new lifecycle work after reopening SQLite. A same-key
  replay still reports the retained pending operation without executing it.
- Added a fail-closed additive-migration check. If a legacy database already
  contains multiple pending lifecycle rows for one instance, Northstar closes
  the database and rejects startup with reconciliation guidance rather than
  deleting or guessing which ambiguous record is valid.
- Added three new application/persistence tests and extended the loopback HTTP
  indeterminate test. Coverage proves different-key concurrency exclusion,
  restart persistence, zero alternate provider calls, one durable request,
  stable public errors, and preservation of duplicate legacy rows on failed
  migration.
- Verified `npm run typecheck`, `npm test` (117 tests: 10 core and 107 server),
  `npm run build`, and `git diff --check`.
- No real `vmrun`, VM, credential, Hermes process, Docker sandbox, Codex login,
  paid tool, host lifecycle change, or external side effect was used.

Phase 1 remains in progress. Pending lifecycle ownership is now durable and
cannot be bypassed with another key, but resolving an indeterminate operation
remains a later recovery capability. The user-approved disposable-VM lifecycle
smoke is still the sole Phase 1 exit gate.

### 2026-08-01 — Phase 1, pending lifecycle Studio-identity fence

- Closed the identity-mutation escape hatch behind per-instance lifecycle
  exclusivity. A pending VM action previously prevented another action for the
  same instance, but `replaceCurrent: true` could revoke that instance and
  create a new generation, while a Studio transition could retire the owning
  Studio before the ambiguous action was reconciled.
- Added a durable `STUDIO_VM_OPERATION_IN_PROGRESS` conflict. Instance
  creation/replacement now checks all pending lifecycle work for its Studio,
  and retirement checks the same ledger, while holding `BEGIN IMMEDIATE`.
  Rejection occurs before instance revocation, generation insertion, Studio
  status change, or activity append.
- Revalidated the Studio-instance/provider tuple inside the lifecycle
  insertion transaction. A concurrent retirement or replacement that wins the
  SQLite write lock therefore makes the new lifecycle request fail before its
  pending record or provider call; a lifecycle insertion that wins first makes
  the identity mutation fail instead.
- Preserved ordinary recovery: succeeded and failed history does not hold the
  identity fence. After an operator truthfully terminalizes the pending record,
  replacement or retirement can proceed through its existing legal transition.
- Added persistence, restart, and loopback HTTP regressions proving both
  identity mutations fail closed, responses contain no provider path, rejected
  transactions leave Studio/instance/activity state unchanged, the fence
  survives repository restart, and terminal failure releases it.
- Verified `npm run typecheck`, `npm test` (120 tests: 10 core and 110 server),
  `npm run build`, and `git diff --check`.
- No real `vmrun`, VM, credential, Hermes process, Docker sandbox, Codex login,
  paid tool, host lifecycle change, or external side effect was used.

Phase 1 remains in progress. Durable identity can no longer bypass pending VM
ownership, but resolving an indeterminate operation remains a later recovery
capability. The user-approved disposable-VM lifecycle smoke is still the sole
Phase 1 exit gate.

### 2026-08-01 — Phase 1, lifecycle access durable-target eligibility

- Closed an operator-evidence gap after safe identity changes. The path-free
  access snapshot previously described only process-start configuration, so a
  configured instance could still appear `armed` after it was revoked or its
  Studio was retired even though action execution would reject that identity.
- Added `targetEligibility` with explicit `not_configured`, `eligible`,
  `instance_revoked`, and `studio_retired` states. The access service re-reads
  durable Studio and instance state on every request and forces revoked or
  retired configured targets to `actionMode: disabled` and
  `actionsAllowed: false`.
- Kept configuration facts distinct from authority. An ineligible target still
  reports that this process was configured and preflighted for that exact
  tuple, while a replacement generation reports `not_configured`; neither can
  silently inherit the old target's action window.
- Preserved the existing cross-Studio fail-closed response order and path-free
  contract. Eligibility exposes only durable lifecycle state, never the VMX,
  `vmrun`, receipt, credential, or diagnostic.
- Added application and loopback HTTP regressions for eligible/read-only/armed/
  expired snapshots, replacement drift, retirement drift, a non-configured
  replacement generation, zero provider calls, and provider-path absence.
- Verified `npm run typecheck`, `npm test` (122 tests: 10 core and 112 server),
  `npm run build`, and `git diff --check`.
- No real `vmrun`, VM, credential, Hermes process, Docker sandbox, Codex login,
  paid tool, host lifecycle change, or external side effect was used.

Phase 1 remains in progress. Access evidence now reflects durable identity
eligibility, but the user-approved disposable-VM lifecycle smoke remains the
sole Phase 1 exit gate.
