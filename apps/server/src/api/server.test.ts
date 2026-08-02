import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { StudioService } from "../application/studio-service.js";
import {
  VmLifecycleAccessService,
  VmLifecycleEvidenceService,
  VmLifecycleService,
  VmLifecycleSmokeCheckService,
  type VmLifecycleRepositoryPort
} from "../application/vm-lifecycle-service.js";
import type { VmProviderPort } from "../application/vm-provider-port.js";
import { createApiServer } from "./server.js";
import { OrganizationRepository } from "../infrastructure/database.js";
import { MockVmProvider } from "../infrastructure/mock-vm-provider.js";

interface ApiFixture {
  baseUrl: string;
  repository: OrganizationRepository;
  vmProvider: MockVmProvider | null;
}

const vmTarget = {
  studioInstanceId: "instance-vm-lifecycle-1",
  providerInstanceId: "/VMs/Test Studio/Test.vmx"
};

async function withApi(
  run: (fixture: ApiFixture) => Promise<void>,
  options: {
    enableVmLifecycle?: boolean;
    vmProvider?: VmProviderPort;
    actionsArmed?: boolean;
    actionsArmedUntil?: string;
    vmwareStudioId?: string;
    accessObservedAt?: string;
    failVmLifecycleCompletion?: boolean;
  } = {}
): Promise<void> {
  const repository = new OrganizationRepository({
    databasePath: ":memory:",
    maxConcurrency: 2,
    usageSource: "chatgpt"
  });
  const provider = options.vmProvider ?? (
    options.enableVmLifecycle
      ? new MockVmProvider({
        targets: [{
          providerInstanceId: vmTarget.providerInstanceId,
          status: "stopped"
        }]
      })
      : null
  );
  const vmProvider = provider instanceof MockVmProvider ? provider : null;
  const vmLifecycleEvidence = new VmLifecycleEvidenceService(repository);
  const vmLifecycleRepository: VmLifecycleRepositoryPort = options.failVmLifecycleCompletion
    ? {
      getVmTarget: repository.getVmTarget.bind(repository),
      beginVmLifecycleOperation: repository.beginVmLifecycleOperation.bind(repository),
      completeVmLifecycleOperation() {
        throw new Error(
          `simulated SQLite completion failure containing ${vmTarget.providerInstanceId}`
        );
      },
      failVmLifecycleOperation: repository.failVmLifecycleOperation.bind(repository),
      recordVmObservation: repository.recordVmObservation.bind(repository),
      readVmLifecycleEvidence: repository.readVmLifecycleEvidence.bind(repository)
    }
    : repository;
  const server = createApiServer(
    repository,
    { dispatch: () => { throw new Error("Dispatch is not used in this test"); } },
    { orchestrate: async () => ({}) },
    { handleDirective: async () => { throw new Error("Board chat is not used in this test"); } },
    new StudioService(repository),
    provider
      ? new VmLifecycleService(
        vmLifecycleRepository,
        provider,
        {
          actionsArmed: options.actionsArmed ?? false,
          actionsArmedUntil: options.actionsArmed
            ? options.actionsArmedUntil ?? "2099-01-01T00:00:00.000Z"
            : null
        }
      )
      : null,
    vmLifecycleEvidence,
    new VmLifecycleAccessService(
      repository,
      provider
        ? {
          studioId: options.vmwareStudioId ?? "studio-vm-lifecycle-fixture",
          studioInstanceId: vmTarget.studioInstanceId,
          preflightCheckedAt: "2026-07-31T13:00:00.000Z",
          actionsArmed: options.actionsArmed ?? false,
          actionsArmedUntil: options.actionsArmed
            ? options.actionsArmedUntil ?? "2099-01-01T00:00:00.000Z"
            : null
        }
        : null,
      () => options.accessObservedAt ?? "2026-07-31T13:00:00.000Z"
    ),
    new VmLifecycleSmokeCheckService(vmLifecycleEvidence)
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  try {
    await run({
      baseUrl: `http://127.0.0.1:${address.port}`,
      repository,
      vmProvider
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    repository.close();
  }
}

async function post(baseUrl: string, pathname: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl
    },
    body: JSON.stringify(body)
  });
}

test("creates and lists a runtime-validated Studio", async () => {
  await withApi(async ({ baseUrl }) => {
    const response = await post(baseUrl, "/api/studios", {
      id: "studio-research",
      key: "github-research",
      name: "GitHub Research & Experience",
      purpose: "Verify repositories and return evidence.",
      managerAgentId: "agent-mira"
    });
    assert.equal(response.status, 201);
    const created = await response.json() as {
      studio: { id: string; status: string };
      instances: unknown[];
      health: { overall: string };
    };
    assert.equal(created.studio.id, "studio-research");
    assert.equal(created.studio.status, "draft");
    assert.deepEqual(created.instances, []);
    assert.equal(created.health.overall, "unknown");

    const listResponse = await fetch(`${baseUrl}/api/studios`);
    assert.equal(listResponse.status, 200);
    const studios = await listResponse.json() as Array<{ studio: { id: string } }>;
    assert.equal(studios.length, 1);
    assert.equal(studios[0]?.studio.id, "studio-research");
  });
});

test("rejects unknown Studio fields before persistence", async () => {
  await withApi(async ({ baseUrl, repository }) => {
    const response = await post(baseUrl, "/api/studios", {
      key: "github-research",
      name: "Research",
      purpose: "Verify repositories.",
      managerAgentId: "agent-mira",
      unexpectedAuthority: "host-admin"
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Request validation failed",
      code: "INVALID_REQUEST"
    });
    assert.equal(repository.listStudios().length, 0);
  });
});

test("creates a Studio-targeted directive and rejects ambiguous authority", async () => {
  await withApi(async ({ baseUrl, repository }) => {
    repository.createStudio({
      id: "studio-research",
      key: "github-research",
      name: "GitHub Research & Experience",
      purpose: "Verify repositories.",
      managerAgentId: "agent-kai"
    });

    const createdResponse = await post(baseUrl, "/api/directives", {
      title: "Verify a repository",
      brief: "Return attributable evidence.",
      studioId: "studio-research"
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as {
      studioId: string | null;
      teamId: string | null;
      ownerAgentId: string | null;
    };
    assert.equal(created.studioId, "studio-research");
    assert.equal(created.teamId, null);
    assert.equal(created.ownerAgentId, "agent-kai");

    const ambiguous = await post(baseUrl, "/api/directives", {
      title: "Ambiguous target",
      brief: "Must fail before persistence.",
      studioId: "studio-research",
      teamId: "team-product"
    });
    assert.equal(ambiguous.status, 400);
    assert.equal(
      (await ambiguous.json() as { code: string }).code,
      "INVALID_REQUEST"
    );
  });
});

test("observes and executes one configured VM lifecycle action with durable replay", async () => {
  await withApi(async ({ baseUrl, repository, vmProvider }) => {
    assert.ok(vmProvider);
    repository.createStudio({
      id: "studio-vm-lifecycle",
      key: "vm-lifecycle-test",
      name: "VM Lifecycle Test",
      purpose: "Exercise a configured target without a real VM.",
      managerAgentId: "agent-kai"
    });
    repository.createStudioInstance({
      id: vmTarget.studioInstanceId,
      studioId: "studio-vm-lifecycle",
      vmProviderInstanceId: vmTarget.providerInstanceId
    });
    const basePath = [
      "/api/studios/studio-vm-lifecycle/instances/",
      vmTarget.studioInstanceId,
      "/vm"
    ].join("");

    const observation = await fetch(`${baseUrl}${basePath}`);
    assert.equal(observation.status, 200);
    assert.equal(
      (await observation.json() as { status: string }).status,
      "stopped"
    );
    const access = await fetch(`${baseUrl}${basePath}/access`);
    assert.equal(access.status, 200);
    assert.deepEqual(await access.json(), {
      studioId: "studio-vm-lifecycle",
      studioInstanceId: vmTarget.studioInstanceId,
      provider: "vmware-fusion",
      configured: true,
      preflight: "ready",
      preflightCheckedAt: "2026-07-31T13:00:00.000Z",
      targetEligibility: "eligible",
      actionMode: "armed",
      actionsAllowed: true,
      actionsArmedUntil: "2099-01-01T00:00:00.000Z",
      observedAt: "2026-07-31T13:00:00.000Z"
    });

    const injectedTarget = await post(baseUrl, `${basePath}/actions`, {
      idempotencyKey: "attempt-target-injection",
      action: "start",
      providerInstanceId: "/VMs/Other/Other.vmx"
    });
    assert.equal(injectedTarget.status, 400);
    assert.equal(
      (await injectedTarget.json() as { code: string }).code,
      "INVALID_REQUEST"
    );
    assert.equal(vmProvider.history().length, 0);

    const request = {
      idempotencyKey: "http-start-1",
      action: "start"
    };
    const first = await post(baseUrl, `${basePath}/actions`, request);
    assert.equal(first.status, 200);
    assert.equal(
      (await first.json() as { replayed: boolean }).replayed,
      false
    );
    const replay = await post(baseUrl, `${basePath}/actions`, request);
    assert.equal(replay.status, 200);
    assert.equal(
      (await replay.json() as { replayed: boolean }).replayed,
      true
    );
    assert.equal(vmProvider.history().length, 1);

    const evidenceResponse = await fetch(`${baseUrl}${basePath}/evidence`);
    assert.equal(evidenceResponse.status, 200);
    const evidence = await evidenceResponse.json() as {
      studioId: string;
      studioInstanceId: string;
      operations: Array<{
        operationId: string;
        idempotencyKey: string;
        action: string;
        status: string;
        statusBefore: string | null;
        statusAfter: string | null;
        receiptRecorded: boolean;
        failureRecorded: boolean;
        startedAt: string;
        finishedAt: string | null;
      }>;
      activity: Array<{ type: string }>;
    };
    assert.equal(evidence.studioId, "studio-vm-lifecycle");
    assert.equal(evidence.studioInstanceId, vmTarget.studioInstanceId);
    assert.deepEqual(evidence.operations, [{
      operationId: evidence.operations[0]?.operationId,
      idempotencyKey: "http-start-1",
      action: "start",
      status: "succeeded",
      statusBefore: "stopped",
      statusAfter: "running",
      receiptRecorded: true,
      failureRecorded: false,
      startedAt: evidence.operations[0]?.startedAt,
      finishedAt: evidence.operations[0]?.finishedAt
    }]);
    assert.ok(evidence.activity.some(
      (event) => event.type === "vm.lifecycle_succeeded"
    ));
    const serializedEvidence = JSON.stringify(evidence);
    assert.ok(!serializedEvidence.includes(vmTarget.providerInstanceId));
    assert.ok(!serializedEvidence.includes("providerReceiptId"));
    assert.ok(!serializedEvidence.includes("errorMessage"));
    assert.ok(!serializedEvidence.includes("\"detail\""));

    const conflicting = await post(baseUrl, `${basePath}/actions`, {
      ...request,
      action: "stop"
    });
    assert.equal(conflicting.status, 409);
    assert.equal((await conflicting.json() as { code: string }).code, "CONFLICT");

    const crossStudio = await post(
      baseUrl,
      `/api/studios/studio-other/instances/${vmTarget.studioInstanceId}/vm/actions`,
      { idempotencyKey: "cross-studio-start", action: "start" }
    );
    assert.equal(crossStudio.status, 404);
    const crossStudioEvidence = await fetch(
      `${baseUrl}/api/studios/studio-other/instances/${vmTarget.studioInstanceId}/vm/evidence`
    );
    assert.equal(crossStudioEvidence.status, 404);
    const crossStudioAccess = await fetch(
      `${baseUrl}/api/studios/studio-other/instances/${vmTarget.studioInstanceId}/vm/access`
    );
    assert.equal(crossStudioAccess.status, 404);
    assert.equal(vmProvider.history().length, 1);
  }, {
    enableVmLifecycle: true,
    actionsArmed: true,
    vmwareStudioId: "studio-vm-lifecycle"
  });
});

test("verifies the durable portion of a bounded VM lifecycle smoke without controlling a real VM", async () => {
  await withApi(async ({ baseUrl, repository, vmProvider }) => {
    assert.ok(vmProvider);
    repository.createStudio({
      id: "studio-vm-smoke-check",
      key: "vm-smoke-check",
      name: "VM Smoke Check",
      purpose: "Verify persisted lifecycle evidence without invoking a provider.",
      managerAgentId: "agent-kai"
    });
    repository.createStudioInstance({
      id: vmTarget.studioInstanceId,
      studioId: "studio-vm-smoke-check",
      vmProviderInstanceId: vmTarget.providerInstanceId
    });
    const basePath = [
      "/api/studios/studio-vm-smoke-check/instances/",
      vmTarget.studioInstanceId,
      "/vm"
    ].join("");
    const sessionPrefix = "manual-smoke-20260731T130000Z";
    const sequence = ["start", "suspend", "resume", "stop"] as const;

    assert.equal((await fetch(`${baseUrl}${basePath}`)).status, 200);
    for (const action of sequence) {
      const request = {
        idempotencyKey: `${sessionPrefix}-${action}`,
        action
      };
      const response = await post(baseUrl, `${basePath}/actions`, request);
      assert.equal(response.status, 200);
      assert.equal(
        (await response.json() as { replayed: boolean }).replayed,
        false
      );
      if (action === "start") {
        const replay = await post(baseUrl, `${basePath}/actions`, request);
        assert.equal(replay.status, 200);
        assert.equal(
          (await replay.json() as { replayed: boolean }).replayed,
          true
        );
      }
      assert.equal((await fetch(`${baseUrl}${basePath}`)).status, 200);
    }
    assert.equal(vmProvider.history().length, 4);

    const response = await fetch(
      `${baseUrl}${basePath}/smoke-check?sessionPrefix=${sessionPrefix}`
    );
    assert.equal(response.status, 200);
    const result = await response.json() as {
      automatedChecksPassed: boolean;
      checks: Record<string, boolean>;
      operations: Array<{
        action: string;
        occurrenceCount: number;
        passed: boolean;
      }>;
      activityCounts: {
        requested: number;
        succeeded: number;
        failed: number;
        observed: number;
      };
      failureCodes: string[];
      manualRequirements: Array<{ code: string }>;
    };
    assert.equal(result.automatedChecksPassed, true);
    assert.deepEqual(result.checks, {
      evidenceComplete: true,
      sessionOperationsComplete: true,
      legalTransitions: true,
      chronological: true,
      activityMinimumsPresent: true
    });
    assert.deepEqual(
      result.operations.map((operation) => operation.action),
      sequence
    );
    assert.ok(result.operations.every(
      (operation) => operation.occurrenceCount === 1 && operation.passed
    ));
    assert.deepEqual(result.activityCounts, {
      requested: 4,
      succeeded: 4,
      failed: 0,
      observed: 5
    });
    assert.deepEqual(result.failureCodes, []);
    const manualRequirementCodes = new Set(
      result.manualRequirements.map((requirement) => requirement.code)
    );
    assert.ok(manualRequirementCodes.has("BOARD_APPROVAL"));
    assert.ok(manualRequirementCodes.has("REPLAY_RESPONSE"));
    assert.ok(manualRequirementCodes.has("OTHER_VM_UNTOUCHED"));
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(vmTarget.providerInstanceId));
    assert.ok(!serialized.includes("providerReceiptId"));
    assert.ok(!serialized.includes("errorMessage"));
    assert.ok(!serialized.includes("\"detail\""));

    const invalidPrefix = await fetch(
      `${baseUrl}${basePath}/smoke-check?sessionPrefix=${encodeURIComponent("/private/path")}`
    );
    assert.equal(invalidPrefix.status, 400);
    assert.equal(
      (await invalidPrefix.json() as { code: string }).code,
      "INVALID_REQUEST"
    );
    const crossStudio = await fetch(
      `${baseUrl}/api/studios/studio-other/instances/${vmTarget.studioInstanceId}/vm/smoke-check?sessionPrefix=${sessionPrefix}`
    );
    assert.equal(crossStudio.status, 404);
    assert.equal(vmProvider.history().length, 4);
  }, {
    enableVmLifecycle: true,
    actionsArmed: true,
    vmwareStudioId: "studio-vm-smoke-check"
  });
});

test("returns a stable indeterminate result when VMware succeeds but durable completion fails", async () => {
  await withApi(async ({ baseUrl, repository, vmProvider }) => {
    assert.ok(vmProvider);
    repository.createStudio({
      id: "studio-vm-indeterminate",
      key: "vm-indeterminate",
      name: "VM Indeterminate Completion",
      purpose: "Prove a provider success cannot be blindly retried after a durable write failure.",
      managerAgentId: "agent-kai"
    });
    repository.createStudioInstance({
      id: vmTarget.studioInstanceId,
      studioId: "studio-vm-indeterminate",
      vmProviderInstanceId: vmTarget.providerInstanceId
    });
    const basePath = [
      "/api/studios/studio-vm-indeterminate/instances/",
      vmTarget.studioInstanceId,
      "/vm"
    ].join("");
    const request = {
      idempotencyKey: "http-indeterminate-start",
      action: "start"
    };

    const first = await post(baseUrl, `${basePath}/actions`, request);
    assert.equal(first.status, 409);
    const firstBody = await first.json();
    assert.deepEqual(firstBody, {
      error: "VM lifecycle result is indeterminate; do not retry until durable Studio evidence and VM state are reconciled",
      code: "VM_OPERATION_INDETERMINATE"
    });
    assert.equal(vmProvider.history().length, 1);

    const evidenceResponse = await fetch(`${baseUrl}${basePath}/evidence`);
    assert.equal(evidenceResponse.status, 200);
    const evidence = await evidenceResponse.json() as {
      operations: Array<{
        idempotencyKey: string;
        status: string;
        receiptRecorded: boolean;
        failureRecorded: boolean;
        finishedAt: string | null;
      }>;
      activity: Array<{ type: string }>;
    };
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

    const replay = await post(baseUrl, `${basePath}/actions`, request);
    assert.equal(replay.status, 409);
    assert.equal(
      (await replay.json() as { code: string }).code,
      "VM_OPERATION_IN_PROGRESS"
    );
    assert.equal(vmProvider.history().length, 1);

    const substituteKey = await post(baseUrl, `${basePath}/actions`, {
      idempotencyKey: "http-indeterminate-substitute-stop",
      action: "stop"
    });
    assert.equal(substituteKey.status, 409);
    assert.deepEqual(await substituteKey.json(), {
      error: "Another VM lifecycle operation is already pending for this Studio instance",
      code: "VM_OPERATION_IN_PROGRESS"
    });
    assert.equal(vmProvider.history().length, 1);

    const serialized = JSON.stringify([firstBody, evidence]);
    assert.ok(!serialized.includes(vmTarget.providerInstanceId));
    assert.ok(!serialized.includes("SQLite"));
  }, {
    enableVmLifecycle: true,
    actionsArmed: true,
    vmwareStudioId: "studio-vm-indeterminate",
    failVmLifecycleCompletion: true
  });
});

test("keeps a configured VM target read-only until actions are armed", async () => {
  await withApi(async ({ baseUrl, repository, vmProvider }) => {
    assert.ok(vmProvider);
    repository.createStudio({
      id: "studio-vm-read-only",
      key: "vm-read-only",
      name: "Read-only VMware Target",
      purpose: "Observe the configured target without authorizing actions.",
      managerAgentId: "agent-kai"
    });
    repository.createStudioInstance({
      id: vmTarget.studioInstanceId,
      studioId: "studio-vm-read-only",
      vmProviderInstanceId: vmTarget.providerInstanceId
    });
    const basePath = [
      "/api/studios/studio-vm-read-only/instances/",
      vmTarget.studioInstanceId,
      "/vm"
    ].join("");

    const observation = await fetch(`${baseUrl}${basePath}`);
    assert.equal(observation.status, 200);
    assert.equal(
      (await observation.json() as { status: string }).status,
      "stopped"
    );
    const access = await fetch(`${baseUrl}${basePath}/access`);
    assert.equal(access.status, 200);
    assert.deepEqual(
      await access.json(),
      {
        studioId: "studio-vm-read-only",
        studioInstanceId: vmTarget.studioInstanceId,
        provider: "vmware-fusion",
        configured: true,
        preflight: "ready",
        preflightCheckedAt: "2026-07-31T13:00:00.000Z",
        targetEligibility: "eligible",
        actionMode: "read_only",
        actionsAllowed: false,
        actionsArmedUntil: null,
        observedAt: "2026-07-31T13:00:00.000Z"
      }
    );

    const action = await post(baseUrl, `${basePath}/actions`, {
      idempotencyKey: "must-not-run",
      action: "start"
    });
    assert.equal(action.status, 403);
    assert.deepEqual(await action.json(), {
      error: "VM lifecycle actions are not armed",
      code: "VM_ACTIONS_NOT_ARMED"
    });
    assert.equal(vmProvider.history().length, 0);

    const evidence = await fetch(`${baseUrl}${basePath}/evidence`);
    assert.equal(evidence.status, 200);
    assert.deepEqual(
      (await evidence.json() as { operations: unknown[] }).operations,
      []
    );
    assert.equal(
      repository.getDashboard().activity.filter(
        (event) => event.type === "vm.lifecycle_requested"
      ).length,
      0
    );
  }, {
    enableVmLifecycle: true,
    vmwareStudioId: "studio-vm-read-only"
  });
});

test("rejects VM actions after the configured arming window expires", async () => {
  await withApi(async ({ baseUrl, repository, vmProvider }) => {
    assert.ok(vmProvider);
    repository.createStudio({
      id: "studio-vm-expired",
      key: "vm-expired",
      name: "Expired VMware Window",
      purpose: "Fail closed when the bounded action window has ended.",
      managerAgentId: "agent-kai"
    });
    repository.createStudioInstance({
      id: vmTarget.studioInstanceId,
      studioId: "studio-vm-expired",
      vmProviderInstanceId: vmTarget.providerInstanceId
    });
    const basePath = [
      "/api/studios/studio-vm-expired/instances/",
      vmTarget.studioInstanceId,
      "/vm"
    ].join("");

    const action = await post(baseUrl, `${basePath}/actions`, {
      idempotencyKey: "expired-http-window",
      action: "start"
    });
    assert.equal(action.status, 403);
    assert.deepEqual(await action.json(), {
      error: "VM lifecycle action authorization has expired",
      code: "VM_ACTIONS_ARMING_EXPIRED"
    });
    assert.equal(vmProvider.history().length, 0);
    assert.equal(
      repository.getDashboard().activity.filter(
        (event) => event.type === "vm.lifecycle_requested"
      ).length,
      0
    );
    const access = await fetch(`${baseUrl}${basePath}/access`);
    assert.equal(access.status, 200);
    assert.deepEqual(
      await access.json(),
      {
        studioId: "studio-vm-expired",
        studioInstanceId: vmTarget.studioInstanceId,
        provider: "vmware-fusion",
        configured: true,
        preflight: "ready",
        preflightCheckedAt: "2026-07-31T13:00:00.000Z",
        targetEligibility: "eligible",
        actionMode: "expired",
        actionsAllowed: false,
        actionsArmedUntil: "2020-01-01T00:00:00.000Z",
        observedAt: "2026-07-31T13:00:00.000Z"
      }
    );
  }, {
    enableVmLifecycle: true,
    actionsArmed: true,
    actionsArmedUntil: "2020-01-01T00:00:00.000Z",
    vmwareStudioId: "studio-vm-expired"
  });
});

test("disables configured lifecycle access after replacement or Studio retirement", async () => {
  await withApi(async ({ baseUrl, repository, vmProvider }) => {
    assert.ok(vmProvider);
    repository.createStudio({
      id: "studio-vm-drift",
      key: "vm-drift",
      name: "VM Drift",
      purpose: "Show durable identity drift without exposing provider configuration.",
      managerAgentId: "agent-kai"
    });
    repository.createStudioInstance({
      id: vmTarget.studioInstanceId,
      studioId: "studio-vm-drift",
      vmProviderInstanceId: vmTarget.providerInstanceId
    });
    repository.createStudioInstance({
      id: "instance-vm-drift-replacement",
      studioId: "studio-vm-drift",
      vmProviderInstanceId: "/VMs/Replacement/Replacement.vmx",
      replaceCurrent: true
    });
    const configuredPath = [
      "/api/studios/studio-vm-drift/instances/",
      vmTarget.studioInstanceId,
      "/vm/access"
    ].join("");
    const revokedResponse = await fetch(`${baseUrl}${configuredPath}`);
    assert.equal(revokedResponse.status, 200);
    const revoked = await revokedResponse.json() as {
      configured: boolean;
      targetEligibility: string;
      actionMode: string;
      actionsAllowed: boolean;
    };
    assert.deepEqual(revoked, {
      studioId: "studio-vm-drift",
      studioInstanceId: vmTarget.studioInstanceId,
      provider: "vmware-fusion",
      configured: true,
      preflight: "ready",
      preflightCheckedAt: "2026-07-31T13:00:00.000Z",
      targetEligibility: "instance_revoked",
      actionMode: "disabled",
      actionsAllowed: false,
      actionsArmedUntil: "2099-01-01T00:00:00.000Z",
      observedAt: "2026-07-31T13:00:00.000Z"
    });

    const replacementResponse = await fetch(
      `${baseUrl}/api/studios/studio-vm-drift/instances/instance-vm-drift-replacement/vm/access`
    );
    assert.equal(replacementResponse.status, 200);
    assert.equal(
      (await replacementResponse.json() as { targetEligibility: string }).targetEligibility,
      "not_configured"
    );

    repository.transitionStudio("studio-vm-drift", "retired");
    const retiredResponse = await fetch(`${baseUrl}${configuredPath}`);
    assert.equal(retiredResponse.status, 200);
    const retired = await retiredResponse.json() as {
      targetEligibility: string;
      actionMode: string;
      actionsAllowed: boolean;
    };
    assert.equal(retired.targetEligibility, "studio_retired");
    assert.equal(retired.actionMode, "disabled");
    assert.equal(retired.actionsAllowed, false);
    assert.equal(vmProvider.history().length, 0);
    assert.ok(!JSON.stringify([revoked, retired]).includes(vmTarget.providerInstanceId));
  }, {
    enableVmLifecycle: true,
    actionsArmed: true,
    vmwareStudioId: "studio-vm-drift"
  });
});

test("keeps VM lifecycle endpoints disabled until a real provider is configured", async () => {
  await withApi(async ({ baseUrl, repository }) => {
    repository.createStudio({
      id: "studio-offline-evidence",
      key: "offline-evidence",
      name: "Offline Evidence",
      purpose: "Keep evidence readable while VMware is disabled.",
      managerAgentId: "agent-kai"
    });
    repository.createStudioInstance({
      id: "instance-offline-evidence",
      studioId: "studio-offline-evidence",
      vmProviderInstanceId: "/VMs/Offline/Offline.vmx"
    });
    const response = await fetch(
      `${baseUrl}/api/studios/studio-any/instances/instance-any/vm`
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "VMware lifecycle is not configured",
      code: "VM_NOT_CONFIGURED"
    });

    const evidence = await fetch(
      `${baseUrl}/api/studios/studio-offline-evidence/instances/instance-offline-evidence/vm/evidence`
    );
    assert.equal(evidence.status, 200);
    assert.deepEqual(await evidence.json(), {
      studioId: "studio-offline-evidence",
      studioInstanceId: "instance-offline-evidence",
      ordering: "newest_first",
      operationsTruncated: false,
      activityTruncated: false,
      operations: [],
      activity: []
    });
    const access = await fetch(
      `${baseUrl}/api/studios/studio-offline-evidence/instances/instance-offline-evidence/vm/access`
    );
    assert.equal(access.status, 200);
    assert.deepEqual(await access.json(), {
      studioId: "studio-offline-evidence",
      studioInstanceId: "instance-offline-evidence",
      provider: null,
      configured: false,
      preflight: "not_configured",
      preflightCheckedAt: null,
      targetEligibility: "not_configured",
      actionMode: "disabled",
      actionsAllowed: false,
      actionsArmedUntil: null,
      observedAt: "2026-07-31T13:00:00.000Z"
    });
    const smokeCheck = await fetch(
      `${baseUrl}/api/studios/studio-offline-evidence/instances/instance-offline-evidence/vm/smoke-check?sessionPrefix=offline-session`
    );
    assert.equal(smokeCheck.status, 200);
    const smokeResult = await smokeCheck.json() as {
      automatedChecksPassed: boolean;
      failureCodes: string[];
      manualRequirements: unknown[];
    };
    assert.equal(smokeResult.automatedChecksPassed, false);
    assert.deepEqual(smokeResult.failureCodes, [
      "SESSION_OPERATIONS_INCOMPLETE",
      "SESSION_TRANSITION_INVALID",
      "SESSION_TIMELINE_INVALID",
      "ACTIVITY_MINIMUMS_MISSING"
    ]);
    assert.equal(smokeResult.manualRequirements.length, 6);
  });
});

test("does not expose untrusted provider paths through lifecycle HTTP errors or evidence", async () => {
  const privateVmrunPath = "/Users/test/private-tools/vmrun";
  let failObservation = true;
  const provider: VmProviderPort = {
    async observe(requestTarget) {
      if (failObservation) {
        throw new Error(`ENOENT while reading ${requestTarget.providerInstanceId}`);
      }
      return {
        target: requestTarget,
        status: "stopped",
        observedAt: "2026-07-31T13:00:00.000Z"
      };
    },
    async execute(request) {
      throw new Error(
        `spawn ${privateVmrunPath} failed for ${request.target.providerInstanceId}`
      );
    }
  };

  await withApi(async ({ baseUrl, repository }) => {
    repository.createStudio({
      id: "studio-vm-redaction",
      key: "vm-redaction-test",
      name: "VM Redaction Test",
      purpose: "Prove host paths do not cross the HTTP boundary.",
      managerAgentId: "agent-kai"
    });
    repository.createStudioInstance({
      id: vmTarget.studioInstanceId,
      studioId: "studio-vm-redaction",
      vmProviderInstanceId: vmTarget.providerInstanceId
    });
    const basePath = [
      "/api/studios/studio-vm-redaction/instances/",
      vmTarget.studioInstanceId,
      "/vm"
    ].join("");

    const observation = await fetch(`${baseUrl}${basePath}`);
    assert.equal(observation.status, 502);
    assert.deepEqual(await observation.json(), {
      error: "VM lifecycle observation failed",
      code: "VM_OPERATION_FAILED"
    });

    failObservation = false;
    const action = await post(baseUrl, `${basePath}/actions`, {
      idempotencyKey: "redacted-provider-failure",
      action: "start"
    });
    assert.equal(action.status, 502);
    assert.deepEqual(await action.json(), {
      error: "VM lifecycle operation failed; inspect durable Studio evidence",
      code: "VM_OPERATION_FAILED"
    });

    const serializedEvidence = JSON.stringify(
      repository.getDashboard().activity.filter(
        (event) => event.type === "vm.lifecycle_failed"
      )
    );
    assert.ok(serializedEvidence.includes(
      "VM provider failed without a trusted diagnostic"
    ));
    assert.ok(!serializedEvidence.includes(vmTarget.providerInstanceId));
    assert.ok(!serializedEvidence.includes(privateVmrunPath));
  }, {
    vmProvider: provider,
    actionsArmed: true,
    vmwareStudioId: "studio-vm-redaction"
  });
});

test("requires an explicit Studio-instance replacement", async () => {
  await withApi(async ({ baseUrl, repository }) => {
    repository.createStudio({
      id: "studio-research",
      key: "github-research",
      name: "Research",
      purpose: "Verify repositories.",
      managerAgentId: "agent-mira"
    });
    const firstResponse = await post(
      baseUrl,
      "/api/studios/studio-research/instances",
      {
        id: "instance-research-1",
        vmProviderInstanceId: "configured-vm"
      }
    );
    assert.equal(firstResponse.status, 201);

    const conflict = await post(
      baseUrl,
      "/api/studios/studio-research/instances",
      { id: "instance-research-conflict" }
    );
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json() as { code: string }).code, "CONFLICT");

    const replacement = await post(
      baseUrl,
      "/api/studios/studio-research/instances",
      { id: "instance-research-2", replaceCurrent: true }
    );
    assert.equal(replacement.status, 201);
    assert.equal(
      (await replacement.json() as { generation: number }).generation,
      2
    );
    assert.equal(repository.getStudioInstance("instance-research-1").status, "revoked");
  });
});

test("rejects Studio identity changes while VM lifecycle evidence is unresolved", async () => {
  await withApi(async ({ baseUrl, repository }) => {
    repository.createStudio({
      id: "studio-pending-identity",
      key: "pending-identity",
      name: "Pending Identity",
      purpose: "Keep unresolved lifecycle evidence attached to its durable identity.",
      managerAgentId: "agent-kai"
    });
    const target = {
      studioInstanceId: "instance-pending-identity-1",
      providerInstanceId: "/VMs/Private Studio/Private.vmx"
    };
    repository.createStudioInstance({
      id: target.studioInstanceId,
      studioId: "studio-pending-identity",
      vmProviderInstanceId: target.providerInstanceId
    });
    repository.beginVmLifecycleOperation({
      studioId: "studio-pending-identity",
      target,
      idempotencyKey: "pending-identity-start",
      action: "start"
    });
    const activityCount = repository.getDashboard().activity.length;

    const replacement = await post(
      baseUrl,
      "/api/studios/studio-pending-identity/instances",
      { id: "instance-pending-identity-2", replaceCurrent: true }
    );
    assert.equal(replacement.status, 409);
    const replacementError = await replacement.json() as { code: string; error: string };
    assert.equal(replacementError.code, "STUDIO_VM_OPERATION_IN_PROGRESS");
    assert.ok(!JSON.stringify(replacementError).includes(target.providerInstanceId));

    const retirement = await fetch(
      `${baseUrl}/api/studios/studio-pending-identity/status`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Origin: baseUrl
        },
        body: JSON.stringify({ status: "retired" })
      }
    );
    assert.equal(retirement.status, 409);
    const retirementError = await retirement.json() as { code: string; error: string };
    assert.equal(retirementError.code, "STUDIO_VM_OPERATION_IN_PROGRESS");
    assert.ok(!JSON.stringify(retirementError).includes(target.providerInstanceId));
    assert.equal(repository.getStudio("studio-pending-identity").status, "draft");
    assert.deepEqual(
      repository.listStudioInstances("studio-pending-identity").map((instance) => instance.id),
      [target.studioInstanceId]
    );
    assert.equal(repository.getDashboard().activity.length, activityCount);
  });
});

test("applies only legal Studio status transitions through a local PATCH", async () => {
  await withApi(async ({ baseUrl, repository }) => {
    repository.createStudio({
      id: "studio-research",
      key: "github-research",
      name: "Research",
      purpose: "Verify repositories.",
      managerAgentId: "agent-mira"
    });
    const ready = await fetch(`${baseUrl}/api/studios/studio-research/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl
      },
      body: JSON.stringify({ status: "ready" })
    });
    assert.equal(ready.status, 200);
    assert.equal(
      (await ready.json() as { studio: { status: string } }).studio.status,
      "ready"
    );

    const illegal = await fetch(`${baseUrl}/api/studios/studio-research/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl
      },
      body: JSON.stringify({ status: "draft" })
    });
    assert.equal(illegal.status, 409);
    assert.equal((await illegal.json() as { code: string }).code, "CONFLICT");

    const forbiddenOrigin = await fetch(`${baseUrl}/api/studios/studio-research/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.com"
      },
      body: JSON.stringify({ status: "active" })
    });
    assert.equal(forbiddenOrigin.status, 400);
    assert.equal(repository.getStudio("studio-research").status, "ready");
  });
});

test("records one heartbeat and safely replays its idempotency key", async () => {
  await withApi(async ({ baseUrl, repository }) => {
    repository.createStudio({
      id: "studio-research",
      key: "github-research",
      name: "Research",
      purpose: "Verify repositories.",
      managerAgentId: "agent-mira"
    });
    repository.createStudioInstance({
      id: "instance-research-1",
      studioId: "studio-research"
    });
    const report = {
      idempotencyKey: "heartbeat-1",
      reportedAt: new Date().toISOString(),
      vmLifecycle: "running",
      components: {
        vm: "healthy",
        northstarHost: "healthy",
        hermes: "degraded",
        sandbox: "healthy"
      },
      disk: { usedBytes: 100, capacityBytes: 1_000 },
      queue: { activeJobs: 0, waitingJobs: 1 },
      hostVersion: "0.1.0"
    };
    const pathname = "/api/studios/studio-research/instances/instance-research-1/heartbeat";

    const firstResponse = await post(baseUrl, pathname, report);
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json() as {
      replayed: boolean;
      instance: { status: string };
      health: { overall: string };
    };
    assert.equal(first.replayed, false);
    assert.equal(first.instance.status, "degraded");
    assert.equal(first.health.overall, "degraded");
    const activityCount = repository.getDashboard().activity.length;

    const replayResponse = await post(baseUrl, pathname, report);
    assert.equal(replayResponse.status, 200);
    assert.equal((await replayResponse.json() as { replayed: boolean }).replayed, true);
    assert.equal(repository.getDashboard().activity.length, activityCount);

    const conflictingReplay = await post(baseUrl, pathname, {
      ...report,
      hostVersion: "different"
    });
    assert.equal(conflictingReplay.status, 409);
    assert.equal((await conflictingReplay.json() as { code: string }).code, "CONFLICT");
  });
});

test("rejects malformed and cross-Studio heartbeats", async () => {
  await withApi(async ({ baseUrl, repository }) => {
    for (const [id, key] of [
      ["studio-research", "github-research"],
      ["studio-content", "content-marketing"]
    ] as const) {
      repository.createStudio({
        id,
        key,
        name: id,
        purpose: "Isolation test.",
        managerAgentId: "agent-mira"
      });
    }
    repository.createStudioInstance({
      id: "instance-research-1",
      studioId: "studio-research"
    });
    const report = {
      idempotencyKey: "heartbeat-1",
      reportedAt: new Date().toISOString(),
      vmLifecycle: "running",
      components: {
        vm: "healthy",
        northstarHost: "healthy",
        hermes: "healthy",
        sandbox: "healthy"
      },
      disk: { usedBytes: 2_000, capacityBytes: 1_000 },
      queue: { activeJobs: -1, waitingJobs: 0 },
      hostVersion: null
    };

    const malformed = await post(
      baseUrl,
      "/api/studios/studio-research/instances/instance-research-1/heartbeat",
      report
    );
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json() as { code: string }).code, "INVALID_REQUEST");

    const crossStudio = await post(
      baseUrl,
      "/api/studios/studio-content/instances/instance-research-1/heartbeat",
      {
        ...report,
        disk: { usedBytes: null, capacityBytes: null },
        queue: { activeJobs: 0, waitingJobs: 0 }
      }
    );
    assert.equal(crossStudio.status, 404);
    assert.equal((await crossStudio.json() as { code: string }).code, "NOT_FOUND");
    assert.equal(repository.getStudioInstance("instance-research-1").lastHeartbeatAt, null);
  });
});

test("observes a timed-out Studio once through the Controller", async () => {
  await withApi(async ({ baseUrl, repository }) => {
    repository.createStudio({
      id: "studio-research",
      key: "github-research",
      name: "Research",
      purpose: "Verify repositories.",
      managerAgentId: "agent-mira"
    });
    repository.createStudioInstance({
      id: "instance-research-1",
      studioId: "studio-research"
    });
    const reportedAt = new Date(Date.now() - 2 * 60_000).toISOString();
    const observedAt = new Date().toISOString();
    const heartbeat = await post(
      baseUrl,
      "/api/studios/studio-research/instances/instance-research-1/heartbeat",
      {
        idempotencyKey: "heartbeat-before-timeout",
        reportedAt,
        vmLifecycle: "running",
        components: {
          vm: "healthy",
          northstarHost: "healthy",
          hermes: "healthy",
          sandbox: "healthy"
        },
        disk: { usedBytes: null, capacityBytes: null },
        queue: { activeJobs: 0, waitingJobs: 0 },
        hostVersion: "0.1.0"
      }
    );
    assert.equal(heartbeat.status, 200);

    const first = await post(baseUrl, "/api/studios/observe-offline", { observedAt });
    assert.equal(first.status, 200);
    assert.equal(
      (await first.json() as { changed: unknown[] }).changed.length,
      1
    );
    const activityCount = repository.getDashboard().activity.length;

    const replay = await post(baseUrl, "/api/studios/observe-offline", { observedAt });
    assert.equal(replay.status, 200);
    assert.deepEqual((await replay.json() as { changed: unknown[] }).changed, []);
    assert.equal(repository.getDashboard().activity.length, activityCount);
    assert.equal(repository.getStudioInstance("instance-research-1").status, "offline");
  });
});
