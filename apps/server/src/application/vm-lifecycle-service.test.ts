import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  VmProviderError,
  type VmLifecycleRequest,
  type VmObservation,
  type VmOperationReceipt,
  type VmProviderPort,
  type VmTarget
} from "./vm-provider-port.js";
import {
  VmLifecycleAccessService,
  VmLifecycleEvidenceService,
  VmLifecycleService,
  VmLifecycleServiceError,
  VmLifecycleSmokeCheckService,
  type VmLifecycleEvidenceBundle,
  type VmLifecycleOperationRecord,
  type VmLifecycleRepositoryPort
} from "./vm-lifecycle-service.js";
import { OrganizationRepository } from "../infrastructure/database.js";
import { MockVmProvider } from "../infrastructure/mock-vm-provider.js";

const target: VmTarget = {
  studioInstanceId: "instance-research-1",
  providerInstanceId: "/VMs/Research Studio/Research.vmx"
};
const armedOptions = {
  actionsArmed: true,
  actionsArmedUntil: "2099-01-01T00:00:00.000Z"
} as const;

function repository(databasePath = ":memory:") {
  const result = new OrganizationRepository({
    databasePath,
    maxConcurrency: 2,
    usageSource: "unknown"
  });
  result.createStudio({
    id: "studio-research",
    key: "github-research-test",
    name: "GitHub Research",
    purpose: "Exercise the VM lifecycle boundary.",
    managerAgentId: "agent-kai"
  });
  result.createStudioInstance({
    id: target.studioInstanceId,
    studioId: "studio-research",
    vmProviderInstanceId: target.providerInstanceId
  });
  return result;
}

function mockProvider(status: "stopped" | "running" | "suspended" = "stopped") {
  return new MockVmProvider({
    targets: [{ providerInstanceId: target.providerInstanceId, status }],
    now: () => "2026-07-31T13:00:00.000Z"
  });
}

function smokeEvidence(
  sessionPrefix = "manual-smoke-20260731T130000Z"
): VmLifecycleEvidenceBundle {
  const operations: VmLifecycleEvidenceBundle["operations"] = [
    {
      operationId: "operation-start",
      idempotencyKey: `${sessionPrefix}-start`,
      action: "start",
      status: "succeeded",
      statusBefore: "stopped",
      statusAfter: "running",
      receiptRecorded: true,
      failureRecorded: false,
      startedAt: "2026-07-31T13:00:00.000Z",
      finishedAt: "2026-07-31T13:00:01.000Z"
    },
    {
      operationId: "operation-suspend",
      idempotencyKey: `${sessionPrefix}-suspend`,
      action: "suspend",
      status: "succeeded",
      statusBefore: "running",
      statusAfter: "suspended",
      receiptRecorded: true,
      failureRecorded: false,
      startedAt: "2026-07-31T13:00:02.000Z",
      finishedAt: "2026-07-31T13:00:03.000Z"
    },
    {
      operationId: "operation-resume",
      idempotencyKey: `${sessionPrefix}-resume`,
      action: "resume",
      status: "succeeded",
      statusBefore: "suspended",
      statusAfter: "running",
      receiptRecorded: true,
      failureRecorded: false,
      startedAt: "2026-07-31T13:00:04.000Z",
      finishedAt: "2026-07-31T13:00:05.000Z"
    },
    {
      operationId: "operation-stop",
      idempotencyKey: `${sessionPrefix}-stop`,
      action: "stop",
      status: "succeeded",
      statusBefore: "running",
      statusAfter: "stopped",
      receiptRecorded: true,
      failureRecorded: false,
      startedAt: "2026-07-31T13:00:06.000Z",
      finishedAt: "2026-07-31T13:00:07.000Z"
    }
  ];
  return {
    studioId: "studio-research",
    studioInstanceId: target.studioInstanceId,
    ordering: "newest_first",
    operationsTruncated: false,
    activityTruncated: false,
    operations: [...operations].reverse(),
    activity: [
      ...Array.from({ length: 4 }, (_, index) => ({
        eventId: `requested-${index}`,
        type: "vm.lifecycle_requested",
        createdAt: `2026-07-31T13:00:0${index}.000Z`
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        eventId: `succeeded-${index}`,
        type: "vm.lifecycle_succeeded",
        createdAt: `2026-07-31T13:00:0${index + 1}.000Z`
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        eventId: `observed-${index}`,
        type: "vm.lifecycle_observed",
        createdAt: `2026-07-31T13:00:0${index}.500Z`
      }))
    ]
  };
}

test("checks only redacted durable smoke evidence and preserves manual proof requirements", () => {
  const sessionPrefix = "manual-smoke-20260731T130000Z";
  const validEvidence = smokeEvidence(sessionPrefix);
  let reads = 0;
  const checker = new VmLifecycleSmokeCheckService({
    read(studioId, studioInstanceId) {
      reads += 1;
      assert.equal(studioId, "studio-research");
      assert.equal(studioInstanceId, target.studioInstanceId);
      return validEvidence;
    }
  });

  const valid = checker.check(
    "studio-research",
    target.studioInstanceId,
    sessionPrefix
  );
  assert.equal(reads, 1);
  assert.equal(valid.automatedChecksPassed, true);
  assert.ok(Object.values(valid.checks).every(Boolean));
  assert.deepEqual(valid.failureCodes, []);
  assert.deepEqual(
    valid.operations.map((operation) => operation.action),
    ["start", "suspend", "resume", "stop"]
  );
  assert.ok(valid.operations.every((operation) => operation.passed));
  assert.deepEqual(valid.activityCounts, {
    requested: 4,
    succeeded: 4,
    failed: 0,
    observed: 5
  });
  assert.deepEqual(
    valid.manualRequirements.map((requirement) => requirement.code),
    [
      "BOARD_APPROVAL",
      "ACCESS_SNAPSHOTS",
      "REPLAY_RESPONSE",
      "MATCH_ACTIVITY_TO_SESSION",
      "OTHER_VM_UNTOUCHED",
      "VERSIONS_AND_CLEANUP"
    ]
  );

  const check = (evidence: VmLifecycleEvidenceBundle) => (
    new VmLifecycleSmokeCheckService({ read: () => evidence }).check(
      "studio-research",
      target.studioInstanceId,
      sessionPrefix
    )
  );
  const truncated = check({
    ...validEvidence,
    operationsTruncated: true
  });
  assert.equal(truncated.automatedChecksPassed, false);
  assert.ok(truncated.failureCodes.includes("EVIDENCE_TRUNCATED"));

  const incomplete = check({
    ...validEvidence,
    operations: validEvidence.operations.filter(
      (operation) => operation.action !== "resume"
    )
  });
  assert.equal(incomplete.checks.sessionOperationsComplete, false);
  assert.ok(incomplete.failureCodes.includes("SESSION_OPERATIONS_INCOMPLETE"));
  assert.ok(incomplete.failureCodes.includes("SESSION_TRANSITION_INVALID"));

  const nonChronological = check({
    ...validEvidence,
    operations: validEvidence.operations.map((operation) => (
      operation.action === "start"
        ? { ...operation, finishedAt: "2026-07-31T13:00:02.500Z" }
        : operation
    ))
  });
  assert.equal(nonChronological.checks.legalTransitions, true);
  assert.equal(nonChronological.checks.chronological, false);
  assert.deepEqual(
    nonChronological.failureCodes,
    ["SESSION_TIMELINE_INVALID"]
  );

  const missingActivity = check({
    ...validEvidence,
    activity: []
  });
  assert.equal(missingActivity.checks.activityMinimumsPresent, false);
  assert.ok(missingActivity.failureCodes.includes("ACTIVITY_MINIMUMS_MISSING"));

  assert.throws(
    () => checker.check(
      "studio-research",
      target.studioInstanceId,
      "/private/path"
    ),
    /sessionPrefix/
  );
  assert.equal(reads, 1);
});

test("records observation and one idempotent lifecycle result as Studio evidence", async () => {
  const store = repository();
  const provider = mockProvider();
  const service = new VmLifecycleService(
    store,
    provider,
    armedOptions
  );

  assert.equal(
    (await service.observe("studio-research", target.studioInstanceId)).status,
    "stopped"
  );
  const request = {
    studioId: "studio-research",
    studioInstanceId: target.studioInstanceId,
    idempotencyKey: "start-research-1",
    action: "start" as const
  };
  const first = await service.execute(request);
  const replay = await service.execute(request);

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.receipt, first.receipt);
  assert.equal(provider.history().length, 1);
  const activity = store.getDashboard().activity;
  assert.equal(
    activity.filter((event) => event.type === "vm.lifecycle_observed").length,
    1
  );
  assert.equal(
    activity.filter((event) => event.type === "vm.lifecycle_requested").length,
    1
  );
  assert.equal(
    activity.filter((event) => event.type === "vm.lifecycle_succeeded").length,
    1
  );
  assert.ok(activity
    .filter((event) => event.type.startsWith("vm.lifecycle_"))
    .every((event) => (
      event.studioId === "studio-research"
      && event.studioInstanceId === target.studioInstanceId
    )));
  store.close();
});

test("replays a successful lifecycle receipt after repository restart", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "northstar-vm-lifecycle-"));
  const databasePath = path.join(directory, "organization.sqlite");
  try {
    const firstStore = repository(databasePath);
    const firstProvider = mockProvider();
    const firstService = new VmLifecycleService(
      firstStore,
      firstProvider,
      armedOptions
    );
    const request = {
      studioId: "studio-research",
      studioInstanceId: target.studioInstanceId,
      idempotencyKey: "restart-stable-start",
      action: "start" as const
    };
    const first = await firstService.execute(request);
    firstStore.close();

    const reopened = new OrganizationRepository({
      databasePath,
      maxConcurrency: 2,
      usageSource: "unknown"
    });
    const unusedProvider = mockProvider();
    const replay = await new VmLifecycleService(
      reopened,
      unusedProvider,
      armedOptions
    ).execute(request);

    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.receipt, first.receipt);
    assert.equal(unusedProvider.history().length, 0);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps a pending lifecycle operation exclusive after repository restart", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "northstar-vm-pending-"));
  const databasePath = path.join(directory, "organization.sqlite");
  try {
    const firstStore = repository(databasePath);
    firstStore.beginVmLifecycleOperation({
      studioId: "studio-research",
      target,
      idempotencyKey: "pending-before-restart",
      action: "start"
    });
    firstStore.close();

    const reopened = new OrganizationRepository({
      databasePath,
      maxConcurrency: 2,
      usageSource: "unknown"
    });
    const unusedProvider = mockProvider();
    const lifecycle = new VmLifecycleService(
      reopened,
      unusedProvider,
      armedOptions
    );

    await assert.rejects(
      lifecycle.execute({
        studioId: "studio-research",
        studioInstanceId: target.studioInstanceId,
        idempotencyKey: "alternate-after-restart",
        action: "start"
      }),
      (error) => (
        error instanceof VmLifecycleServiceError
        && error.code === "VM_OPERATION_IN_PROGRESS"
        && error.message === "Another VM lifecycle operation is already pending for this Studio instance"
      )
    );
    assert.equal(unusedProvider.history().length, 0);
    const evidence = new VmLifecycleEvidenceService(reopened).read(
      "studio-research",
      target.studioInstanceId
    );
    assert.deepEqual(evidence.operations.map((operation) => ({
      idempotencyKey: operation.idempotencyKey,
      status: operation.status
    })), [{
      idempotencyKey: "pending-before-restart",
      status: "pending"
    }]);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("exports redacted lifecycle evidence after restart and instance replacement", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "northstar-vm-evidence-"));
  const databasePath = path.join(directory, "organization.sqlite");
  try {
    const firstStore = repository(databasePath);
    const lifecycle = new VmLifecycleService(
      firstStore,
      mockProvider(),
      armedOptions
    );
    await lifecycle.observe("studio-research", target.studioInstanceId);
    await lifecycle.execute({
      studioId: "studio-research",
      studioInstanceId: target.studioInstanceId,
      idempotencyKey: "evidence-start-1",
      action: "start"
    });
    firstStore.createStudioInstance({
      id: "instance-research-2",
      studioId: "studio-research",
      vmProviderInstanceId: "/VMs/Replacement/Replacement.vmx",
      replaceCurrent: true
    });
    assert.equal(
      firstStore.getStudioInstance(target.studioInstanceId).status,
      "revoked"
    );

    const firstEvidence = new VmLifecycleEvidenceService(firstStore).read(
      "studio-research",
      target.studioInstanceId
    );
    assert.equal(firstEvidence.operations.length, 1);
    assert.equal(firstEvidence.operations[0]?.idempotencyKey, "evidence-start-1");
    assert.equal(firstEvidence.operations[0]?.receiptRecorded, true);
    assert.equal(firstEvidence.operations[0]?.failureRecorded, false);
    assert.deepEqual(
      new Set(firstEvidence.activity.map((event) => event.type)),
      new Set([
        "vm.lifecycle_observed",
        "vm.lifecycle_requested",
        "vm.lifecycle_succeeded"
      ])
    );
    const serialized = JSON.stringify(firstEvidence);
    assert.ok(!serialized.includes(target.providerInstanceId));
    assert.ok(!serialized.includes("providerInstanceId"));
    assert.ok(!serialized.includes("providerReceiptId"));
    assert.ok(!serialized.includes("errorMessage"));
    assert.ok(!serialized.includes("\"detail\""));
    firstStore.close();

    const reopened = new OrganizationRepository({
      databasePath,
      maxConcurrency: 2,
      usageSource: "unknown"
    });
    const reopenedEvidence = new VmLifecycleEvidenceService(reopened).read(
      "studio-research",
      target.studioInstanceId
    );
    assert.deepEqual(reopenedEvidence, firstEvidence);
    assert.throws(
      () => new VmLifecycleEvidenceService(reopened).read(
        "studio-other",
        target.studioInstanceId
      ),
      /does not belong/
    );
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("bounds evidence bundles and redacts non-API idempotency keys", () => {
  const operations: VmLifecycleOperationRecord[] = Array.from(
    { length: 101 },
    (_, index) => ({
      id: `operation-${index}`,
      studioId: "studio-research",
      studioInstanceId: target.studioInstanceId,
      providerInstanceId: target.providerInstanceId,
      idempotencyKey: index === 0 ? "/private/path/in-key" : `safe-key-${index}`,
      action: "start",
      status: "succeeded",
      providerReceiptId: `private-receipt-${index}`,
      statusBefore: "stopped",
      statusAfter: "running",
      errorMessage: null,
      startedAt: "2026-07-31T13:00:00.000Z",
      finishedAt: "2026-07-31T13:00:01.000Z"
    })
  );
  const activity = Array.from({ length: 101 }, (_, index) => ({
    id: `event-${index}`,
    companyId: "company-northstar",
    studioId: "studio-research",
    studioInstanceId: target.studioInstanceId,
    taskId: null,
    runId: null,
    agentId: "agent-kai",
    type: "vm.lifecycle_succeeded",
    summary: "Safe summary",
    detail: `/private/detail/${index}`,
    createdAt: "2026-07-31T13:00:01.000Z"
  }));
  const evidence = new VmLifecycleEvidenceService({
    readVmLifecycleEvidence(studioId, studioInstanceId, limit) {
      assert.equal(studioId, "studio-research");
      assert.equal(studioInstanceId, target.studioInstanceId);
      assert.equal(limit, 101);
      return { operations, activity };
    }
  }).read("studio-research", target.studioInstanceId);

  assert.equal(evidence.operations.length, 100);
  assert.equal(evidence.activity.length, 100);
  assert.equal(evidence.operationsTruncated, true);
  assert.equal(evidence.activityTruncated, true);
  assert.equal(
    evidence.operations[0]?.idempotencyKey,
    "[redacted-idempotency-key]"
  );
  const serialized = JSON.stringify(evidence);
  assert.ok(!serialized.includes(target.providerInstanceId));
  assert.ok(!serialized.includes("private-receipt"));
  assert.ok(!serialized.includes("/private/detail"));
});

test("keeps a configured lifecycle target read-only until actions are armed", async () => {
  const store = repository();
  const provider = mockProvider();
  const service = new VmLifecycleService(store, provider);

  assert.equal(
    (await service.observe("studio-research", target.studioInstanceId)).status,
    "stopped"
  );
  await assert.rejects(
    service.execute({
      studioId: "studio-research",
      studioInstanceId: target.studioInstanceId,
      idempotencyKey: "must-not-run",
      action: "start"
    }),
    (error) => (
      error instanceof VmLifecycleServiceError
      && error.code === "VM_ACTIONS_NOT_ARMED"
      && error.message === "VM lifecycle actions are not armed"
    )
  );
  assert.equal(provider.history().length, 0);
  assert.deepEqual(
    new VmLifecycleEvidenceService(store).read(
      "studio-research",
      target.studioInstanceId
    ).operations,
    []
  );
  assert.equal(
    store.getDashboard().activity.filter(
      (event) => event.type === "vm.lifecycle_requested"
    ).length,
    0
  );
  store.close();
});

test("expires an armed lifecycle window before persistence or provider execution", async () => {
  const store = repository();
  const provider = mockProvider();
  const service = new VmLifecycleService(store, provider, {
    actionsArmed: true,
    actionsArmedUntil: "2026-07-31T13:05:00.000Z",
    now: () => "2026-07-31T13:05:00.000Z"
  });

  assert.equal(
    (await service.observe("studio-research", target.studioInstanceId)).status,
    "stopped"
  );
  await assert.rejects(
    service.execute({
      studioId: "studio-research",
      studioInstanceId: target.studioInstanceId,
      idempotencyKey: "expired-window",
      action: "start"
    }),
    (error) => (
      error instanceof VmLifecycleServiceError
      && error.code === "VM_ACTIONS_ARMING_EXPIRED"
      && error.message === "VM lifecycle action authorization has expired"
    )
  );
  assert.equal(provider.history().length, 0);
  assert.equal(
    new VmLifecycleEvidenceService(store).read(
      "studio-research",
      target.studioInstanceId
    ).operations.length,
    0
  );
  assert.equal(
    store.getDashboard().activity.filter(
      (event) => event.type === "vm.lifecycle_requested"
    ).length,
    0
  );
  store.close();
});

test("reports path-free disabled, read-only, armed, and expired access snapshots", () => {
  const store = repository();
  const base = {
    studioId: "studio-research",
    studioInstanceId: target.studioInstanceId,
    preflightCheckedAt: "2026-07-31T13:00:00.000Z"
  };
  const disabled = new VmLifecycleAccessService(
    store,
    null,
    () => "2026-07-31T13:01:00.000Z"
  ).read("studio-research", target.studioInstanceId);
  assert.equal(disabled.actionMode, "disabled");
  assert.equal(disabled.configured, false);
  assert.equal(disabled.targetEligibility, "not_configured");

  const readOnly = new VmLifecycleAccessService(
    store,
    {
      ...base,
      actionsArmed: false,
      actionsArmedUntil: null
    },
    () => "2026-07-31T13:01:00.000Z"
  ).read("studio-research", target.studioInstanceId);
  assert.equal(readOnly.actionMode, "read_only");
  assert.equal(readOnly.actionsAllowed, false);
  assert.equal(readOnly.targetEligibility, "eligible");

  const armed = new VmLifecycleAccessService(
    store,
    {
      ...base,
      actionsArmed: true,
      actionsArmedUntil: "2026-07-31T13:05:00.000Z"
    },
    () => "2026-07-31T13:04:59.999Z"
  ).read("studio-research", target.studioInstanceId);
  assert.equal(armed.actionMode, "armed");
  assert.equal(armed.actionsAllowed, true);
  assert.equal(armed.targetEligibility, "eligible");

  const expired = new VmLifecycleAccessService(
    store,
    {
      ...base,
      actionsArmed: true,
      actionsArmedUntil: "2026-07-31T13:05:00.000Z"
    },
    () => "2026-07-31T13:05:00.000Z"
  ).read("studio-research", target.studioInstanceId);
  assert.equal(expired.actionMode, "expired");
  assert.equal(expired.actionsAllowed, false);
  assert.equal(expired.targetEligibility, "eligible");
  const serialized = JSON.stringify([disabled, readOnly, armed, expired]);
  assert.ok(!serialized.includes(target.providerInstanceId));

  assert.throws(
    () => new VmLifecycleAccessService(store, null).read(
      "studio-other",
      target.studioInstanceId
    ),
    /does not belong/
  );
  store.close();
});

test("disables configured access when durable Studio identity is no longer eligible", () => {
  const store = repository();
  const access = new VmLifecycleAccessService(
    store,
    {
      studioId: "studio-research",
      studioInstanceId: target.studioInstanceId,
      preflightCheckedAt: "2026-07-31T13:00:00.000Z",
      actionsArmed: true,
      actionsArmedUntil: "2026-07-31T13:05:00.000Z"
    },
    () => "2026-07-31T13:01:00.000Z"
  );

  store.createStudioInstance({
    id: "instance-research-replacement",
    studioId: "studio-research",
    vmProviderInstanceId: "/VMs/Replacement/Replacement.vmx",
    replaceCurrent: true
  });
  const revoked = access.read("studio-research", target.studioInstanceId);
  assert.equal(revoked.targetEligibility, "instance_revoked");
  assert.equal(revoked.actionMode, "disabled");
  assert.equal(revoked.actionsAllowed, false);
  assert.equal(revoked.configured, true);

  store.transitionStudio("studio-research", "retired");
  const retired = access.read("studio-research", target.studioInstanceId);
  assert.equal(retired.targetEligibility, "studio_retired");
  assert.equal(retired.actionMode, "disabled");
  assert.equal(retired.actionsAllowed, false);
  assert.equal(JSON.stringify([revoked, retired]).includes(target.providerInstanceId), false);
  store.close();
});

test("persists provider failure and never blindly retries the same key", async () => {
  const store = repository();
  let executions = 0;
  const provider: VmProviderPort = {
    async observe(): Promise<VmObservation> {
      return {
        target,
        status: "stopped",
        observedAt: "2026-07-31T13:00:00.000Z"
      };
    },
    async execute(): Promise<VmOperationReceipt> {
      executions += 1;
      throw new Error(
        `vmrun failed for ${target.providerInstanceId}: permission denied`
      );
    }
  };
  const service = new VmLifecycleService(
    store,
    provider,
    armedOptions
  );
  const request = {
    studioId: "studio-research",
    studioInstanceId: target.studioInstanceId,
    idempotencyKey: "failed-start",
    action: "start" as const
  };

  await assert.rejects(service.execute(request), (error) => (
    error instanceof VmLifecycleServiceError
    && error.code === "VM_OPERATION_FAILED"
    && error.message === "VM lifecycle operation failed; inspect durable Studio evidence"
    && !error.message.includes(target.providerInstanceId)
  ));
  await assert.rejects(service.execute(request), (error) => (
    error instanceof VmLifecycleServiceError
    && error.code === "VM_OPERATION_FAILED"
    && error.message === "VM lifecycle operation failed; inspect durable Studio evidence"
    && !error.message.includes(target.providerInstanceId)
  ));
  assert.equal(executions, 1);
  const failureActivity = store.getDashboard().activity.filter(
    (event) => event.type === "vm.lifecycle_failed"
  );
  assert.equal(failureActivity.length, 1);
  assert.ok(
    failureActivity[0]?.detail?.includes(
      "VM provider failed without a trusted diagnostic"
    )
  );
  assert.ok(!JSON.stringify(failureActivity).includes(target.providerInstanceId));
  store.close();
});

test("keeps an indeterminate provider result pending and never retries it", async () => {
  const store = repository();
  let executions = 0;
  const provider: VmProviderPort = {
    async observe(): Promise<VmObservation> {
      return {
        target,
        status: "stopped",
        observedAt: "2026-08-01T13:00:00.000Z"
      };
    },
    async execute(): Promise<VmOperationReceipt> {
      executions += 1;
      throw new VmProviderError(
        `vmrun timed out for ${target.providerInstanceId}`,
        "indeterminate"
      );
    }
  };
  const service = new VmLifecycleService(store, provider, armedOptions);
  const request = {
    studioId: "studio-research",
    studioInstanceId: target.studioInstanceId,
    idempotencyKey: "indeterminate-start",
    action: "start" as const
  };

  await assert.rejects(service.execute(request), (error) => (
    error instanceof VmLifecycleServiceError
    && error.code === "VM_OPERATION_INDETERMINATE"
    && error.message === "VM lifecycle result is indeterminate; do not retry until durable Studio evidence and VM state are reconciled"
    && !error.message.includes(target.providerInstanceId)
  ));
  assert.equal(executions, 1);

  const evidence = new VmLifecycleEvidenceService(store).read(
    "studio-research",
    target.studioInstanceId
  );
  assert.deepEqual(evidence.operations.map((operation) => ({
    idempotencyKey: operation.idempotencyKey,
    status: operation.status,
    receiptRecorded: operation.receiptRecorded,
    failureRecorded: operation.failureRecorded,
    finishedAt: operation.finishedAt
  })), [{
    idempotencyKey: request.idempotencyKey,
    status: "pending",
    receiptRecorded: false,
    failureRecorded: false,
    finishedAt: null
  }]);
  assert.deepEqual(
    evidence.activity.map((event) => event.type),
    ["vm.lifecycle_requested"]
  );

  await assert.rejects(service.execute(request), (error) => (
    error instanceof VmLifecycleServiceError
    && error.code === "VM_OPERATION_IN_PROGRESS"
  ));
  assert.equal(executions, 1);
  store.close();
});

test("leaves provider success indeterminate when durable completion fails and never retries it", async () => {
  const store = repository();
  const provider = mockProvider();
  let completionAttempts = 0;
  let failureWrites = 0;
  const failingCompletionRepository: VmLifecycleRepositoryPort = {
    getVmTarget: store.getVmTarget.bind(store),
    beginVmLifecycleOperation: store.beginVmLifecycleOperation.bind(store),
    completeVmLifecycleOperation() {
      completionAttempts += 1;
      throw new Error(
        `simulated SQLite failure containing ${target.providerInstanceId}`
      );
    },
    failVmLifecycleOperation(operationId, errorMessage) {
      failureWrites += 1;
      return store.failVmLifecycleOperation(operationId, errorMessage);
    },
    recordVmObservation: store.recordVmObservation.bind(store),
    readVmLifecycleEvidence: store.readVmLifecycleEvidence.bind(store)
  };
  const service = new VmLifecycleService(
    failingCompletionRepository,
    provider,
    armedOptions
  );
  const request = {
    studioId: "studio-research",
    studioInstanceId: target.studioInstanceId,
    idempotencyKey: "completion-write-failed",
    action: "start" as const
  };

  await assert.rejects(service.execute(request), (error) => (
    error instanceof VmLifecycleServiceError
    && error.code === "VM_OPERATION_INDETERMINATE"
    && error.message === "VM lifecycle result is indeterminate; do not retry until durable Studio evidence and VM state are reconciled"
    && !error.message.includes(target.providerInstanceId)
    && !error.message.includes("SQLite")
  ));
  assert.equal(provider.history().length, 1);
  assert.equal(completionAttempts, 1);
  assert.equal(failureWrites, 0);
  const evidence = new VmLifecycleEvidenceService(store).read(
    "studio-research",
    target.studioInstanceId
  );
  assert.deepEqual(evidence.operations.map((operation) => ({
    idempotencyKey: operation.idempotencyKey,
    status: operation.status,
    receiptRecorded: operation.receiptRecorded,
    failureRecorded: operation.failureRecorded,
    finishedAt: operation.finishedAt
  })), [{
    idempotencyKey: request.idempotencyKey,
    status: "pending",
    receiptRecorded: false,
    failureRecorded: false,
    finishedAt: null
  }]);
  assert.deepEqual(
    evidence.activity.map((event) => event.type),
    ["vm.lifecycle_requested"]
  );

  await assert.rejects(service.execute(request), (error) => (
    error instanceof VmLifecycleServiceError
    && error.code === "VM_OPERATION_IN_PROGRESS"
  ));
  assert.equal(provider.history().length, 1);
  assert.equal(completionAttempts, 1);
  assert.equal(failureWrites, 0);
  store.close();
});

test("leaves provider failure indeterminate when durable failure recording also fails", async () => {
  const store = repository();
  let executions = 0;
  let failureAttempts = 0;
  const provider: VmProviderPort = {
    async observe(): Promise<VmObservation> {
      return {
        target,
        status: "stopped",
        observedAt: "2026-08-01T13:00:00.000Z"
      };
    },
    async execute(): Promise<VmOperationReceipt> {
      executions += 1;
      throw new Error(`ambiguous vmrun failure for ${target.providerInstanceId}`);
    }
  };
  const failingFailureRepository: VmLifecycleRepositoryPort = {
    getVmTarget: store.getVmTarget.bind(store),
    beginVmLifecycleOperation: store.beginVmLifecycleOperation.bind(store),
    completeVmLifecycleOperation: store.completeVmLifecycleOperation.bind(store),
    failVmLifecycleOperation() {
      failureAttempts += 1;
      throw new Error(
        `simulated SQLite failure containing ${target.providerInstanceId}`
      );
    },
    recordVmObservation: store.recordVmObservation.bind(store),
    readVmLifecycleEvidence: store.readVmLifecycleEvidence.bind(store)
  };
  const service = new VmLifecycleService(
    failingFailureRepository,
    provider,
    armedOptions
  );
  const request = {
    studioId: "studio-research",
    studioInstanceId: target.studioInstanceId,
    idempotencyKey: "failure-write-failed",
    action: "start" as const
  };

  await assert.rejects(service.execute(request), (error) => (
    error instanceof VmLifecycleServiceError
    && error.code === "VM_OPERATION_INDETERMINATE"
    && error.message === "VM lifecycle result is indeterminate; do not retry until durable Studio evidence and VM state are reconciled"
    && !error.message.includes(target.providerInstanceId)
    && !error.message.includes("SQLite")
  ));
  assert.equal(executions, 1);
  assert.equal(failureAttempts, 1);
  const evidence = new VmLifecycleEvidenceService(store).read(
    "studio-research",
    target.studioInstanceId
  );
  assert.deepEqual(evidence.operations.map((operation) => ({
    status: operation.status,
    receiptRecorded: operation.receiptRecorded,
    failureRecorded: operation.failureRecorded,
    finishedAt: operation.finishedAt
  })), [{
    status: "pending",
    receiptRecorded: false,
    failureRecorded: false,
    finishedAt: null
  }]);
  assert.deepEqual(
    evidence.activity.map((event) => event.type),
    ["vm.lifecycle_requested"]
  );

  await assert.rejects(service.execute(request), (error) => (
    error instanceof VmLifecycleServiceError
    && error.code === "VM_OPERATION_IN_PROGRESS"
  ));
  assert.equal(executions, 1);
  assert.equal(failureAttempts, 1);
  store.close();
});

test("a concurrent duplicate sees pending state instead of executing twice", async () => {
  const store = repository();
  let executions = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider: VmProviderPort = {
    async observe(): Promise<VmObservation> {
      return {
        target,
        status: "stopped",
        observedAt: "2026-07-31T13:00:00.000Z"
      };
    },
    async execute(request: VmLifecycleRequest): Promise<VmOperationReceipt> {
      executions += 1;
      await gate;
      return {
        id: "slow-provider-receipt",
        idempotencyKey: request.idempotencyKey,
        target: request.target,
        action: request.action,
        statusBefore: "stopped",
        statusAfter: "running",
        startedAt: "2026-07-31T13:00:00.000Z",
        finishedAt: "2026-07-31T13:00:01.000Z"
      };
    }
  };
  const service = new VmLifecycleService(
    store,
    provider,
    armedOptions
  );
  const request = {
    studioId: "studio-research",
    studioInstanceId: target.studioInstanceId,
    idempotencyKey: "concurrent-start",
    action: "start" as const
  };

  const first = service.execute(request);
  await assert.rejects(service.execute(request), (error) => (
    error instanceof VmLifecycleServiceError
    && error.code === "VM_OPERATION_IN_PROGRESS"
  ));
  release?.();
  await first;
  assert.equal(executions, 1);
  store.close();
});

test("different lifecycle keys cannot execute concurrently for one Studio instance", async () => {
  const store = repository();
  let executions = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider: VmProviderPort = {
    async observe(): Promise<VmObservation> {
      return {
        target,
        status: "stopped",
        observedAt: "2026-08-01T14:00:00.000Z"
      };
    },
    async execute(request: VmLifecycleRequest): Promise<VmOperationReceipt> {
      executions += 1;
      await gate;
      return {
        id: "exclusive-provider-receipt",
        idempotencyKey: request.idempotencyKey,
        target: request.target,
        action: request.action,
        statusBefore: "stopped",
        statusAfter: "running",
        startedAt: "2026-08-01T14:00:00.000Z",
        finishedAt: "2026-08-01T14:00:01.000Z"
      };
    }
  };
  const lifecycle = new VmLifecycleService(store, provider, armedOptions);
  const first = lifecycle.execute({
    studioId: "studio-research",
    studioInstanceId: target.studioInstanceId,
    idempotencyKey: "exclusive-first-start",
    action: "start"
  });

  await assert.rejects(
    lifecycle.execute({
      studioId: "studio-research",
      studioInstanceId: target.studioInstanceId,
      idempotencyKey: "exclusive-second-start",
      action: "start"
    }),
    (error) => (
      error instanceof VmLifecycleServiceError
      && error.code === "VM_OPERATION_IN_PROGRESS"
      && error.message === "Another VM lifecycle operation is already pending for this Studio instance"
    )
  );
  assert.equal(executions, 1);
  release?.();
  await first;

  const evidence = new VmLifecycleEvidenceService(store).read(
    "studio-research",
    target.studioInstanceId
  );
  assert.deepEqual(evidence.operations.map((operation) => (
    operation.idempotencyKey
  )), ["exclusive-first-start"]);
  assert.deepEqual(
    evidence.activity.map((event) => event.type),
    ["vm.lifecycle_succeeded", "vm.lifecycle_requested"]
  );
  store.close();
});

test("rejects invalid provider observations before they enter Studio evidence", async () => {
  const store = repository();
  const provider: VmProviderPort = {
    async observe(): Promise<VmObservation> {
      return {
        target,
        status: "stopped",
        observedAt: "not-a-timestamp"
      };
    },
    async execute(): Promise<VmOperationReceipt> {
      throw new Error("Execution is not used in this test");
    }
  };

  await assert.rejects(
    new VmLifecycleService(store, provider).observe(
      "studio-research",
      target.studioInstanceId
    ),
    (error) => (
      error instanceof VmLifecycleServiceError
      && error.code === "VM_PROVIDER_CONTRACT_VIOLATION"
    )
  );
  assert.equal(
    store.getDashboard().activity.filter(
      (event) => event.type === "vm.lifecycle_observed"
    ).length,
    0
  );
  store.close();
});

test("returns a stable observation failure without exposing the configured VM path", async () => {
  const store = repository();
  const provider: VmProviderPort = {
    async observe(): Promise<VmObservation> {
      throw new Error(`ENOENT while reading ${target.providerInstanceId}`);
    },
    async execute(): Promise<VmOperationReceipt> {
      throw new Error("Execution is not used in this test");
    }
  };

  await assert.rejects(
    new VmLifecycleService(store, provider).observe(
      "studio-research",
      target.studioInstanceId
    ),
    (error) => (
      error instanceof VmLifecycleServiceError
      && error.code === "VM_OPERATION_FAILED"
      && error.message === "VM lifecycle observation failed"
      && !error.message.includes(target.providerInstanceId)
    )
  );
  assert.ok(
    !JSON.stringify(store.getDashboard().activity).includes(
      target.providerInstanceId
    )
  );
  store.close();
});

test("fails closed on semantically invalid provider receipts and never retries them", async (t) => {
  const cases: Array<{
    name: string;
    override: Partial<VmOperationReceipt>;
  }> = [
    {
      name: "impossible state transition",
      override: { statusAfter: "stopped" }
    },
    {
      name: "reversed timing evidence",
      override: {
        startedAt: "2026-07-31T13:00:02.000Z",
        finishedAt: "2026-07-31T13:00:01.000Z"
      }
    },
    {
      name: "empty receipt identifier",
      override: { id: " " }
    }
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const store = repository();
      let executions = 0;
      const provider: VmProviderPort = {
        async observe(): Promise<VmObservation> {
          return {
            target,
            status: "stopped",
            observedAt: "2026-07-31T13:00:00.000Z"
          };
        },
        async execute(request: VmLifecycleRequest): Promise<VmOperationReceipt> {
          executions += 1;
          return {
            id: "provider-receipt",
            idempotencyKey: request.idempotencyKey,
            target: request.target,
            action: request.action,
            statusBefore: "stopped",
            statusAfter: "running",
            startedAt: "2026-07-31T13:00:00.000Z",
            finishedAt: "2026-07-31T13:00:01.000Z",
            ...testCase.override
          };
        }
      };
      const service = new VmLifecycleService(
        store,
        provider,
        armedOptions
      );
      const request = {
        studioId: "studio-research",
        studioInstanceId: target.studioInstanceId,
        idempotencyKey: `invalid-receipt-${testCase.name.replaceAll(" ", "-")}`,
        action: "start" as const
      };

      await assert.rejects(service.execute(request), (error) => (
        error instanceof VmLifecycleServiceError
        && error.code === "VM_PROVIDER_CONTRACT_VIOLATION"
      ));
      await assert.rejects(service.execute(request), (error) => (
        error instanceof VmLifecycleServiceError
        && error.code === "VM_OPERATION_FAILED"
      ));
      assert.equal(executions, 1);
      assert.equal(
        store.getDashboard().activity.filter(
          (event) => event.type === "vm.lifecycle_failed"
        ).length,
        1
      );
      assert.equal(
        store.getDashboard().activity.filter(
          (event) => event.type === "vm.lifecycle_succeeded"
        ).length,
        0
      );
      store.close();
    });
  }
});
