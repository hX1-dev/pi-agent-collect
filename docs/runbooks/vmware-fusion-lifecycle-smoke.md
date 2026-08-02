# VMware Fusion lifecycle smoke

This is the manual Phase 1 gate. It is not an automated test and must not be
run against a personal, production, or irreplaceable VM.

## Authority and prerequisites

Proceed only after the Board/user explicitly approves this smoke and supplies:

- one disposable VMware Fusion VM;
- its absolute `.vmx` path;
- the absolute `vmrun` executable path;
- permission to start, soft-suspend, resume, and soft-stop that VM;
- confirmation that no important work is running in the VM.

Do not use snapshots, delete files, run guest commands, or operate another VM
as part of this smoke.

## Prepare the durable target

1. Start Northstar with all `VMWARE_FUSION_*` variables unset.
2. Confirm the intended Studio exists.
3. Create one current Studio instance through
   `POST /api/studios/:studioId/instances` and set
   `vmProviderInstanceId` to the exact absolute `.vmx` path.
4. Stop Northstar cleanly.
5. Set the four target values locally and keep the separate action flag
   explicitly false, without committing `.env`:

```dotenv
VMWARE_FUSION_VMRUN_PATH=/absolute/path/to/vmrun
VMWARE_FUSION_STUDIO_ID=studio-github-research
VMWARE_FUSION_INSTANCE_ID=replace-with-the-created-instance-id
VMWARE_FUSION_VMX_PATH=/absolute/path/to/Disposable.vmwarevm/Disposable.vmx
VMWARE_FUSION_ACTIONS_ARMED=false
```

Northstar must fail startup if the Studio/instance/path tuple does not match its
durable record. With the variables unset, lifecycle endpoints must return
`VM_NOT_CONFIGURED`. With the four target values configured and the arming
value unset or `false`, read-only observation is available but every lifecycle
action must return `403 VM_ACTIONS_NOT_ARMED` before writing an operation or
calling `vmrun`.

Capture the path-free runtime state through:

```text
GET /api/studios/:studioId/instances/:instanceId/vm/access
```

Before approval it must report `actionMode: "read_only"`,
`actionsAllowed: false`, `preflight: "ready"`, and
`targetEligibility: "eligible"`. This response describes runtime
configuration; it is not the Board approval itself. If it reports
`instance_revoked` or `studio_retired`, stop: the startup configuration no
longer names an eligible durable identity even if its files still exist.

When all four variables are set, Northstar performs a no-command preflight
before listening. It must fail startup if the configured `vmrun` path is not an
executable regular file or the configured VMX path is not a readable regular
file. Both final path components must be direct files rather than symbolic
links. This check touches only those two exact paths and must not produce a
`vmrun` process or lifecycle activity record. Northstar repeats the same
no-command check immediately before every new action and rechecks the VMX path
for every observation. If a configured file changes after startup, the request
must fail before a `vmrun` process is created.

## Execute the bounded smoke

After explicit approval:

1. choose one safe, unique session prefix of at most 96 characters, for
   example `manual-smoke-20260801T130000Z`;
2. stop Northstar;
3. set `VMWARE_FUSION_ACTIONS_ARMED=true`;
4. set `VMWARE_FUSION_ACTIONS_ARMED_UNTIL` to an ISO-8601 timestamp no more
   than 30 minutes in the future;
5. restart Northstar and confirm its startup log reports the same bounded
   action deadline;
6. call the access endpoint and confirm `actionMode: "armed"` and
   `actionsAllowed: true`, with `targetEligibility: "eligible"`;
7. call only the configured instance.

Northstar must reject a missing, invalid, expired, or longer-than-30-minute
deadline at startup. If the deadline expires while Northstar is running,
subsequent action requests must return
`403 VM_ACTIONS_ARMING_EXPIRED` without writing an operation or calling
`vmrun`. Read-only observation and evidence remain available.

The bounded request sequence is:

1. `GET /api/studios/:studioId/instances/:instanceId/vm`
2. `POST .../vm/actions` with `<sessionPrefix>-start` and `start`
3. repeat the exact same request and confirm `replayed: true`
4. use `<sessionPrefix>-suspend`, `<sessionPrefix>-resume`, and
   `<sessionPrefix>-stop` for the remaining actions
5. observe state between each action

The action body contains no path:

```json
{
  "idempotencyKey": "manual-smoke-20260801T130000Z-start",
  "action": "start"
}
```

Northstar infers `running` only from the configured VM's `.vmx.lck` path and
infers `suspended` only from that VMX file's in-bundle
`checkpoint.vmState`. This avoids enumerating other VMs. The smoke must verify
those assumptions against the installed VMware Fusion version.

## Required evidence

Record all of the following without exposing personal paths in screenshots:

- date, VMware Fusion version, and `vmrun` version;
- Studio ID and Studio instance ID;
- a redacted label for the disposable VM;
- the start and end of the explicitly armed action window;
- access snapshots before arming, while armed, and after expiry or cleanup;
- initial observed state;
- each action and idempotency key;
- `statusBefore`, `statusAfter`, and whether the response was a replay;
- matching `vm.lifecycle_requested`, `vm.lifecycle_succeeded`, and
  `vm.lifecycle_observed` activity entries;
- evidence that another VM remained untouched;
- final observed `stopped` state;
- cleanup outcome.

Adapter diagnostics may contain stable labels such as `[configured-vmx]`,
`[configured-vm-directory]`, `[configured-vmrun]`, or
`[configured-vmrun-directory]`. Treat an absolute configured file, its parent
directory, or an in-bundle state-file path in any API response or durable
evidence as a failed safety check and stop the smoke.

Use the read-only endpoint below to collect the bounded durable operation/event
summary for the configured Studio instance:

```text
GET /api/studios/:studioId/instances/:instanceId/vm/evidence
```

It remains available when VMware lifecycle is disabled and after the instance
is replaced. The response is newest-first, includes truncation flags, and
deliberately omits provider paths, receipt IDs, raw error messages, and activity
detail. Keep the action responses separately because `replayed` is a response
property rather than a second durable operation.

After the final observation, ask the read-only checker to verify the durable
portion associated with the chosen prefix:

```text
GET /api/studios/:studioId/instances/:instanceId/vm/smoke-check?sessionPrefix=manual-smoke-20260801T130000Z
```

`automatedChecksPassed` must be `true` before this evidence is accepted. The
checker performs no provider call and remains usable after the action window
expires or VMware lifecycle is disabled. Its result does **not** complete the
manual smoke: every returned `manualRequirements` item must still be supported
by separately retained evidence. In particular, the checker cannot establish
Board approval, retain the `replayed: true` HTTP response, correlate aggregate
activity counts to the session by itself, prove another VM was untouched, or
record installed versions and cleanup.

If a command returns success but the configured lock/checkpoint evidence does
not converge, stop the smoke. Do not retry with a new key until the actual VM
state is inspected manually, because the previous external result is
ambiguous.

An observation error is not evidence that a lock or checkpoint is absent.
Northstar treats only an operating-system `ENOENT` result as absence; a
permission failure, symlink loop, a direct lock/checkpoint symbolic link,
malformed filesystem state, or other access error must stop the smoke. A
configured executable or VMX path that has become a symbolic link is also a
stop condition. Never repair or remove VM bundle files while the action window
is armed. Disarm first, inspect the disposable VM in VMware Fusion, and retain
the path-free error response and lifecycle evidence.

If Northstar returns `409 VM_OPERATION_INDETERMINATE`, the provider finished or
failed but Northstar cannot prove the final outcome. This includes a SQLite
finalization failure, the process runner rejecting without returning a result,
and a `vmrun` process killed by its 30-second timeout or 64 KiB output bound, or
terminated by an operating-system signal such as `SIGTERM`/`SIGKILL`. It also
includes `vmrun` returning success followed by an unreadable or non-convergent
lock/checkpoint observation. In every case the VM may already have changed
state. Stop the smoke immediately, retain the pending operation and request
activity, and inspect the disposable VM's actual state before any cleanup
action. Do not retry the same key or substitute a new key to repeat the action.
Northstar deliberately leaves the record pending and hides raw provider or
persistence details; it also rejects every alternate lifecycle key for that
Studio instance with `409 VM_OPERATION_IN_PROGRESS`. It also rejects replacing
or creating a Studio instance and retiring the Studio with
`409 STUDIO_VM_OPERATION_IN_PROGRESS`; do not use a new generation or retired
Studio as a substitute execution identity. Automatic reconciliation is a later
phase. If startup reports multiple legacy pending lifecycle records for the
same instance, do not delete either record to make startup pass: retain a
database backup, disarm actions, inspect the disposable VM, and reconcile the
ambiguous evidence manually before changing durable state.

Even without a pending operation, replacing the configured instance or
retiring its Studio makes the old target's access snapshot `disabled` with
`targetEligibility: "instance_revoked"` or `"studio_retired"`. A replacement
generation reports `not_configured`; do not treat it as inheriting the old
process configuration. Stop, disarm, and restart with an explicitly verified
tuple before beginning a different smoke session.

## Cleanup

1. Ensure the disposable VM is stopped.
2. Stop Northstar.
3. Remove `VMWARE_FUSION_ACTIONS_ARMED_UNTIL` and then remove
   `VMWARE_FUSION_ACTIONS_ARMED`, or set the latter to `false`.
4. Remove the four local target values.
5. Restart Northstar and confirm lifecycle returns `VM_NOT_CONFIGURED`.
6. Query the access endpoint for the retained Studio instance and confirm
   `actionMode: "disabled"` and `actionsAllowed: false`.
7. Retain the durable operation and activity records; do not delete evidence to
   make the smoke appear clean.
