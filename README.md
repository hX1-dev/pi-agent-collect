# Northstar House — Private AI Organization

> **Active branch: Personal VMware Foundation.** This worktree serves Henry's
> local system first: one host-side Northstar Controller, one persistent Hermes
> manager per Studio VM, disposable task sandboxes inside the VM, and brokered
> Codex access. A legacy 16-identity roster remains readable for historical
> compatibility, but the active planner no longer uses its fixed specialists.
> See the
> [personal VMware execution plan](docs/personal-vmware-foundation-plan.md),
> [verified implementation status](docs/personal-vmware-implementation-status.md),
> and the reusable
> [master implementation prompt](docs/prompts/personal-vmware-master-implementation-prompt.md).

Northstar is a local-first control plane for a private AI studio. The Board
works through one CEO surface; three durable Studios and their accountable
managers sit behind it. Northstar owns organization state and authority,
LangGraph.js coordinates a company task, Hermes is the replaceable manager
runtime, and Codex will be a brokered engineering tool rather than an employee
identity.

## What works now

- LangChain's official Agent Chat UI as the Board's primary local interface
- A thin `messages` graph that maps one chat message to one durable Northstar directive
- An optional Board, Work, Organization, Approvals, and Activity evidence console backed by local SQLite
- A preserved legacy 16-person directory that is no longer planning authority
- Automatic board-directive planning through
  `CEO -> 1–3 Studio Managers -> 0–4 temporary Run workers`
- Embedded LangGraph.js with a separate SQLite checkpoint database and an
  explicit graph-version compatibility gate
- Runtime validation that rejects unknown/retired Studios, mismatched managers,
  duplicate temporary-worker keys, and more than three Studios or four
  temporary workers per Studio
- A durable orchestration record and Studio-attributed task tree; every new
  task remains owned by its accountable Studio Manager
- One active Run per task and Agent, plus one writable Run per workspace
- Deterministic Mock runtime by default: no model API, Hermes process, Codex usage, or external action
- A guarded Hermes Runs API adapter with a DeepSeek-backed local pilot; approval waits stop instead of auto-approving
- Phase 0 Studio contracts with durable Studio identity, replaceable instance
  generations, idempotent heartbeat evidence, additive SQLite persistence, and
  a read-only Studio health view
- Runtime-validated local Controller endpoints for Studio creation, explicit
  instance replacement, heartbeat reporting, and operational snapshots; guest
  credentials and real VMware control are not enabled
- An opt-in VMware Fusion lifecycle adapter for one exact Studio instance. It
  uses direct `vmrun` argument vectors, persists request/success/failure
  evidence, survives idempotent replay across restart, and performs a
  no-command startup preflight for the configured `vmrun` and VMX files. Both
  final paths must be direct regular files rather than symbolic links, and the
  provider repeats the same readiness check immediately before every new
  lifecycle action so a startup result cannot authorize a later replacement.
  Provider failures redact the configured files, their non-root parent
  directories, and in-bundle state-file paths before durable evidence; HTTP
  clients receive stable errors. A process-runner boundary that rejects without
  returning a result, a `vmrun` timeout, output-limit termination, or
  operating-system signal is treated as indeterminate because the external
  action may already have happened. The same applies when `vmrun` returns
  success but the configured
  lock/checkpoint state cannot be read or does not converge. In each case the
  operation stays pending, the same key cannot execute again, and an alternate
  key cannot start another lifecycle action for that Studio instance. While
  any operation for a Studio remains pending, Northstar also rejects instance
  creation/replacement and Studio retirement in the same SQLite write
  transaction, so changing durable identity cannot bypass or orphan the
  unresolved action. This
  fail-safe rule also applies if the provider finishes but SQLite cannot durably
  record either its success or its failure. Lifecycle remains disabled until
  all four local target variables are configured; a configured target remains
  read-only unless a
  separate action-arming variable is explicitly set to `true` with a future
  deadline of at most 30 minutes. Lock and checkpoint lookups treat only
  `ENOENT` as absence; permission, symlink-loop, direct state-path symlinks, and
  other filesystem faults fail closed instead of being misread as a stopped VM
- A provider-independent, read-only lifecycle evidence endpoint remains
  available after VMware is disabled or an instance is replaced. It returns a
  bounded operation/event summary without provider paths, receipt IDs, or raw
  error/activity details
- A path-free lifecycle access endpoint reports whether one exact Studio
  instance is disabled, read-only, armed, or expired, plus preflight readiness
  and the bounded deadline. It also reports whether the durable target is
  eligible, revoked, retired, or not configured; revoked/retired targets are
  forced to disabled even if the process originally started with an armed
  configuration. This is an operational configuration snapshot, not a Board
  approval or proof that an action ran
- A provider-independent smoke-check endpoint can verify the durable portion
  of one named lifecycle session: exactly one start/suspend/resume/stop
  operation, the required state chain, ordered timestamps, complete bounded
  evidence, and minimum activity counts. It only reads redacted SQLite
  evidence and returns the still-required manual proofs; a passing result does
  not complete the Phase 1 gate
- An idempotent startup compatibility bootstrap creates the three committed
  Studios without adding fake employees: Kai temporarily owns Research, Mira
  owns Content, and Rowan temporarily owns Video until versioned Phase 4
  manager charters replace the legacy runtime profiles

The current graph finishes Studio planning. A temporary worker in the plan is
only a bounded execution description, never a permanent Agent. Its
Studio-attributed work-package task is owned by the manager and can be started
through the controlled Run Broker. Actual subagent/sandbox creation, automatic
evidence collection, manager synthesis, reviewer Runs, and Board interrupts are
later phase gates.

### GitHub Signal Studio (V0 operating contract)

The Social Studio now has a project-based operating contract for a two-day
GitHub discovery and proof cycle: discovery, a narrow isolated verification,
independent review, and an editor-ready evidence pack. It intentionally does
not treat a README as proof, run arbitrary repositories on the host, inject
personal credentials into cloned code, or publish automatically. See
[GitHub Signal Studio](docs/github-social-studio.md) and the machine-readable
[studio contract](config/studios/github-social-studio.yaml).

## Run it

Requirements: Node.js 22.13 or newer, npm, and pnpm for the unmodified official chat UI.

The current workspace already has the pinned Agent Chat UI snapshot installed under `.upstream/agent-chat-ui`. Start the full local chat path with:

```bash
npm install
cp .env.example .env
npm run dev:chat
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). It connects to the local LangGraph Agent Server on `127.0.0.1:2024`, which sends Board turns to the Northstar API on `127.0.0.1:4318`. All three services bind only to loopback.

Send Avery a directive in the chat. In Mock mode Avery routes it to the selected
Studios, and each manager describes the smallest useful temporary execution
unit without creating a new employee identity. A repeated delivery of the same
chat message reuses its original root task and orchestration rather than
duplicating work. A message containing “全公司”“三个工作室” or equivalent
company-wide language can use all three Studios.

For a fresh checkout, clone [langchain-ai/agent-chat-ui](https://github.com/langchain-ai/agent-chat-ui) at commit `1cbd509d387b1e9602a80f05e638058b7543d7cc` into `.upstream/agent-chat-ui`, run `pnpm install --frozen-lockfile` there, and create its `.env` with:

```dotenv
NEXT_PUBLIC_API_URL=http://127.0.0.1:2024
NEXT_PUBLIC_ASSISTANT_ID=board
NEXT_PUBLIC_AUTH_SCHEME=
```

The prior evidence console remains available with `npm run dev` at [http://127.0.0.1:5173](http://127.0.0.1:5173), but it is no longer the primary interaction model.

### DeepSeek live pilot

The pinned Hermes runtime uses DeepSeek's native provider. The pilot keeps the provider key out of the repository and starts only the four profiles needed by the current planning graph: Avery plus the three managers. Specialist gateways remain off until specialist execution is requested.

On macOS, store the provider key interactively in Keychain (the command prompts without echoing it):

```bash
security add-generic-password -U \
  -a northstar-hermes-pilot \
  -s com.northstar.deepseek \
  -w
```

Install the pinned Hermes dependencies once, then run the single-CEO contract smoke:

```bash
uv sync --project .upstream/hermes-agent --extra messaging --locked
npm run hermes:smoke
```

After the smoke passes, stop any Mock chat process already using ports `3000`, `2024`, or `4318`, then start the live planning company:

```bash
npm run dev:live
```

`dev:live` starts four loopback-only Hermes gateways on ports `8701`, `8710`, `8720`, and `8730`, generates separate in-memory gateway tokens, and injects only those local tokens into Northstar. The DeepSeek key is supplied only to Hermes processes. On Linux, provide `DEEPSEEK_API_KEY` through the service secret environment instead of macOS Keychain.

## Execution modes

Mock is the only default and the only mode used by automated tests:

```dotenv
HERMES_EXECUTION_MODE=mock
```

The live Hermes seam uses one dedicated profile gateway with its normal, unprefixed `/v1/runs` API. `npm run hermes:smoke` is the explicit real-provider contract check; automated tests remain Mock-only. A complete deployment maps profiles to independent loopback endpoints:

```dotenv
HERMES_EXECUTION_MODE=live
HERMES_PROFILE_ENDPOINTS_JSON={"ceo":{"baseUrl":"http://127.0.0.1:8701","apiKey":"replace-with-a-strong-secret"}}
```

Do not commit a real `.env`. Each profile should ultimately use a secret reference rather than a key stored in organization SQLite. The optional multiplex endpoint is present for contract testing, but the pinned Hermes commit does not yet prove that `/p/<profile>/v1/runs` works; dedicated ports are the live baseline.

## Where Codex fits

Codex is not a credential or permanent employee runtime. A Studio Manager may
later request a scoped coding capability through:

```text
Hermes engineering profile
  -> Northstar capability/Broker
  -> broker-owned codex mcp-server or codex exec --json
  -> isolated Codex thread and worktree
```

`codex login` uses ChatGPT OAuth, but that login is not a credential to
distribute to Studio VMs or temporary workers. Hermes must never receive
`auth.json`, an OAuth token, or permission to invoke Codex directly. The Codex
Broker integration is designed but is not wired into this milestone.

## Configuration

| Variable | Default | Meaning |
| --- | ---: | --- |
| `HERMES_EXECUTION_MODE` | `mock` | `mock` or explicitly enabled `live` employee runtime |
| `HERMES_PROFILE_ENDPOINTS_JSON` | `{}` | Dedicated `runtimeProfile -> {baseUrl, apiKey}` Runs API endpoints |
| `HERMES_MULTIPLEX_BASE_URL` | unset | Optional, currently unverified profile-prefixed gateway |
| `HERMES_MULTIPLEX_API_KEY` | unset | Key paired with the optional multiplex endpoint |
| `HERMES_POLL_INTERVAL_MS` | `500` | Runs API polling interval |
| `VMWARE_FUSION_VMRUN_PATH` | unset | Absolute `vmrun` executable; lifecycle stays disabled when unset |
| `VMWARE_FUSION_STUDIO_ID` | unset | The one durable Studio allowed by the Phase 1 adapter |
| `VMWARE_FUSION_INSTANCE_ID` | unset | The one current Studio instance allowed by the adapter |
| `VMWARE_FUSION_VMX_PATH` | unset | Exact absolute `.vmx` path already recorded on that instance |
| `VMWARE_FUSION_ACTIONS_ARMED` | `false` | Must be exactly `true` during an explicitly approved lifecycle-action window; requires a bounded deadline |
| `VMWARE_FUSION_ACTIONS_ARMED_UNTIL` | unset | ISO-8601 expiry required while armed; must be future and no more than 30 minutes after startup |
| `AI_ORG_PORT` | `4318` | Northstar loopback API port |
| `AI_ORG_DATA_DIR` | `.data` | Organization and LangGraph SQLite directory |
| `AI_ORG_MAX_CONCURRENCY` | `2` | Maximum simultaneous employee Runs |
| `AI_ORG_EXECUTION_TIMEOUT_MS` | `1800000` | Live Hermes Run timeout before a stop request |

## Verification

```bash
npm run typecheck
npm test
npm run build
```

The tests never start Hermes, a model API, or live Codex execution.
They also never execute `vmrun`; VMware adapter tests use an injected fake
process runner and fake VM files. Process-boundary tests invoke only the
current local Node executable to prove literal arguments, timeout handling,
bounded output, and signal termination.

## Important boundaries

- A permanent Agent is a durable role, reporting line, runtime profile, work history, and later memory—not a model process that burns tokens continuously.
- Northstar SQLite is the organizational source of truth. LangGraph checkpoints are only resumable workflow state; Hermes `run_id` and Codex threads are temporary execution identifiers.
- Agent Chat UI thread IDs are conversation cursors, never employee identities. `board_chat_directives` only provides an idempotent message-to-task mapping; the task and orchestration remain the durable truth.
- Approval records authority but does not execute a side effect. Publishing, messaging, calendar writes, payments, and destructive connectors remain unavailable without a scoped capability gateway.
- The Run queue is still in memory. Interrupted live Runs are not yet reconciled after restart.
- The app is single-user and loopback-only, not a multi-tenant authenticated service.
- VMware lifecycle is disabled by default. Its Phase 1 manual proof must follow
  the [disposable VM smoke runbook](docs/runbooks/vmware-fusion-lifecycle-smoke.md).
- Configuring a VMware target enables preflight and read-only observation only.
  Start/stop/suspend/resume fail closed until the separate actions flag is
  explicitly armed with a bounded future deadline; the application rejects
  actions automatically when that deadline expires.

See [the architecture](docs/architecture.md), the working [studio blueprint](docs/northstar-studio-blueprint.md), and the detailed [Hermes + LangGraph integration and Linux deployment design](docs/integrations/hermes-langgraph.md).
