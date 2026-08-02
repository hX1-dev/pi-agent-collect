import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { StudioVmOperationInProgressError } from "../application/studio-service.js";
import { OrganizationRepository } from "./database.js";

test("seeds a board-ready organization and creates directives", () => {
  const repository = new OrganizationRepository({
    databasePath: ":memory:",
    maxConcurrency: 2,
    usageSource: "chatgpt"
  });
  const dashboard = repository.getDashboard();
  assert.equal(dashboard.company.name, "Northstar House");
  assert.equal(dashboard.teams.length, 3);
  assert.equal(dashboard.agents.length, 16);
  assert.equal(dashboard.agents.some((agent) => agent.title === "Chief of Staff"), true);
  const chief = dashboard.agents.find((agent) => agent.id === "agent-avery");
  assert.ok(chief);
  const managers = dashboard.agents.filter((agent) => agent.managerAgentId === chief.id);
  assert.equal(managers.length, 3);
  for (const manager of managers) {
    assert.equal(dashboard.agents.filter((agent) => agent.managerAgentId === manager.id).length, 4);
  }
  assert.equal(dashboard.agents.every((agent) => agent.executionProvider === "hermes"), true);
  assert.equal(dashboard.agents.every((agent) => Boolean(agent.runtimeProfile)), true);

  repository.createStudio({
    id: "studio-content",
    key: "content-marketing",
    name: "Content & Marketing",
    purpose: "Turn evidence into grounded content.",
    managerAgentId: "agent-mira"
  });
  const directive = repository.createDirective({
    title: "Prepare a launch brief",
    brief: "Draft the smallest useful launch plan.",
    teamId: "team-social"
  });
  assert.equal(directive.ownerAgentId, "agent-mira");
  assert.equal(directive.studioId, "studio-content");
  assert.equal(directive.status, "planned");
  assert.equal(directive.reviewerAgentId, null);
  repository.close();
});

test("targets a Studio manager without treating a legacy Team as authority", () => {
  const repository = new OrganizationRepository({
    databasePath: ":memory:",
    maxConcurrency: 2,
    usageSource: "chatgpt"
  });
  repository.createStudio({
    id: "studio-research",
    key: "github-research",
    name: "GitHub Research & Experience",
    purpose: "Verify repositories.",
    managerAgentId: "agent-kai"
  });

  const directive = repository.createDirective({
    title: "Verify a repository",
    brief: "Return evidence without using a live sandbox.",
    studioId: "studio-research"
  });
  assert.equal(directive.studioId, "studio-research");
  assert.equal(directive.teamId, null);
  assert.equal(directive.ownerAgentId, "agent-kai");
  assert.equal(
    repository.getDashboard().activity.some((event) => (
      event.type === "board.directive" && event.studioId === "studio-research"
    )),
    true
  );
  assert.throws(
    () => repository.createDirective({
      title: "Ambiguous target",
      brief: "Must fail closed.",
      studioId: "studio-research",
      teamId: "team-product"
    }),
    /cannot target both/
  );
  repository.close();
});

test("prevents duplicate active work and closes the reviewer loop", () => {
  const repository = new OrganizationRepository({
    databasePath: ":memory:",
    maxConcurrency: 2,
    usageSource: "chatgpt"
  });
  const directive = repository.createDirective({
    title: "Prepare a risk review",
    brief: "Produce a reviewable internal brief.",
    teamId: "team-product",
    risk: "yellow"
  });
  assert.equal(directive.reviewerAgentId, "agent-quinn");

  const run = repository.createRun(directive.id, "mock");
  assert.throws(() => repository.createRun(directive.id, "mock"), /active run/);
  repository.markRunStarted(run.id, "mock-thread");
  repository.completeRun(run.id, {
    summary: "Evidence is ready for review.",
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0
  });
  assert.equal(repository.getTask(directive.id).status, "review");
  assert.equal(repository.reviewTask(directive.id, "accepted").status, "done");
  repository.close();
});

test("returns an owner to rest after a board approval decision", () => {
  const repository = new OrganizationRepository({
    databasePath: ":memory:",
    maxConcurrency: 2,
    usageSource: "chatgpt"
  });
  repository.decideApproval("approval-founder-note", "rejected");
  assert.equal(repository.getTask("task-founder-note").status, "cancelled");
  assert.equal(repository.getAgent("agent-theo").status, "sleeping");
  assert.equal(repository.getAgent("agent-theo").currentTaskId, null);
  repository.close();
});

test("persists a Studio and its activity evidence atomically", () => {
  const repository = new OrganizationRepository({
    databasePath: ":memory:",
    maxConcurrency: 2,
    usageSource: "chatgpt"
  });

  const studio = repository.createStudio({
    id: "studio-research",
    key: "github-research",
    name: "GitHub Research & Experience",
    purpose: "Verify interesting repositories and return attributable evidence.",
    managerAgentId: "agent-mira"
  });

  assert.equal(studio.status, "draft");
  assert.deepEqual(repository.listStudios(), [studio]);
  const activity = repository.getDashboard().activity.find((event) => event.type === "studio.created");
  assert.ok(activity);
  assert.equal(activity.studioId, studio.id);
  assert.equal(activity.studioInstanceId, null);

  const eventCount = repository.getDashboard().activity.length;
  assert.throws(
    () => repository.createStudio({
      id: "studio-duplicate",
      key: "github-research",
      name: "Duplicate Research",
      purpose: "This insert must roll back with its activity.",
      managerAgentId: "agent-mira"
    }),
    /UNIQUE/
  );
  assert.equal(repository.getDashboard().activity.length, eventCount);
  repository.close();
});

test("requires explicit replacement and revokes the prior Studio instance", () => {
  const repository = new OrganizationRepository({
    databasePath: ":memory:",
    maxConcurrency: 2,
    usageSource: "chatgpt"
  });
  repository.createStudio({
    id: "studio-research",
    key: "github-research",
    name: "GitHub Research & Experience",
    purpose: "Verify repositories.",
    managerAgentId: "agent-mira"
  });
  const first = repository.createStudioInstance({
    id: "instance-research-1",
    studioId: "studio-research",
    vmProviderInstanceId: "vm-research"
  });

  assert.equal(first.generation, 1);
  assert.throws(
    () => repository.createStudioInstance({
      id: "instance-research-conflict",
      studioId: "studio-research"
    }),
    /already has a current instance/
  );

  const replacement = repository.createStudioInstance({
    id: "instance-research-2",
    studioId: "studio-research",
    vmProviderInstanceId: "vm-research-replacement",
    replaceCurrent: true
  });
  const instances = repository.listStudioInstances("studio-research");

  assert.equal(replacement.generation, 2);
  assert.equal(instances.length, 2);
  assert.equal(instances[0]?.status, "revoked");
  assert.ok(instances[0]?.revokedAt);
  assert.equal(instances[1]?.status, "pending_enrollment");
  assert.equal(
    repository.getDashboard().activity.some((event) => (
      event.type === "studio.instance_revoked"
      && event.studioInstanceId === first.id
    )),
    true
  );
  repository.close();
});

test("preserves Studio identity across repository restart", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "northstar-studio-"));
  const databasePath = path.join(directory, "organization.sqlite");
  try {
    const firstRepository = new OrganizationRepository({
      databasePath,
      maxConcurrency: 2,
      usageSource: "chatgpt"
    });
    firstRepository.createStudio({
      id: "studio-content",
      key: "content-marketing",
      name: "Content & Marketing",
      purpose: "Turn verified evidence into grounded scripts.",
      managerAgentId: "agent-kai"
    });
    firstRepository.createStudioInstance({
      id: "instance-content-1",
      studioId: "studio-content"
    });
    firstRepository.close();

    const reopenedRepository = new OrganizationRepository({
      databasePath,
      maxConcurrency: 2,
      usageSource: "chatgpt"
    });
    assert.equal(reopenedRepository.getStudio("studio-content").name, "Content & Marketing");
    assert.equal(
      reopenedRepository.getStudioInstance("instance-content-1").studioId,
      "studio-content"
    );
    reopenedRepository.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps a Studio instance current while its VM lifecycle operation is pending", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "northstar-studio-vm-fence-"));
  const databasePath = path.join(directory, "organization.sqlite");
  try {
    const firstRepository = new OrganizationRepository({
      databasePath,
      maxConcurrency: 2,
      usageSource: "unknown"
    });
    firstRepository.createStudio({
      id: "studio-fenced-replacement",
      key: "fenced-replacement",
      name: "Fenced Replacement",
      purpose: "Prove identity replacement cannot bypass unresolved VM work.",
      managerAgentId: "agent-kai"
    });
    const target = {
      studioInstanceId: "instance-fenced-replacement-1",
      providerInstanceId: "/VMs/Fenced Replacement/Fenced.vmx"
    };
    firstRepository.createStudioInstance({
      id: target.studioInstanceId,
      studioId: "studio-fenced-replacement",
      vmProviderInstanceId: target.providerInstanceId
    });
    const { operation } = firstRepository.beginVmLifecycleOperation({
      studioId: "studio-fenced-replacement",
      target,
      idempotencyKey: "fenced-replacement-pending",
      action: "start"
    });
    const activityCount = firstRepository.getDashboard().activity.length;

    assert.throws(
      () => firstRepository.createStudioInstance({
        id: "instance-fenced-replacement-2",
        studioId: "studio-fenced-replacement",
        vmProviderInstanceId: "/VMs/Replacement/Replacement.vmx",
        replaceCurrent: true
      }),
      StudioVmOperationInProgressError
    );
    assert.deepEqual(
      firstRepository.listStudioInstances("studio-fenced-replacement").map((instance) => ({
        id: instance.id,
        status: instance.status,
        generation: instance.generation
      })),
      [{ id: target.studioInstanceId, status: "pending_enrollment", generation: 1 }]
    );
    assert.equal(firstRepository.getDashboard().activity.length, activityCount);
    firstRepository.close();

    const reopenedRepository = new OrganizationRepository({
      databasePath,
      maxConcurrency: 2,
      usageSource: "unknown"
    });
    assert.throws(
      () => reopenedRepository.createStudioInstance({
        id: "instance-fenced-replacement-2",
        studioId: "studio-fenced-replacement",
        replaceCurrent: true
      }),
      StudioVmOperationInProgressError
    );
    reopenedRepository.failVmLifecycleOperation(operation.id, "operator reconciled failure");
    const replacement = reopenedRepository.createStudioInstance({
      id: "instance-fenced-replacement-2",
      studioId: "studio-fenced-replacement",
      vmProviderInstanceId: "/VMs/Replacement/Replacement.vmx",
      replaceCurrent: true
    });
    assert.equal(replacement.generation, 2);
    assert.equal(
      reopenedRepository.getStudioInstance(target.studioInstanceId).status,
      "revoked"
    );
    reopenedRepository.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps a Studio non-retired while any VM lifecycle operation is pending", () => {
  const repository = new OrganizationRepository({
    databasePath: ":memory:",
    maxConcurrency: 2,
    usageSource: "unknown"
  });
  repository.createStudio({
    id: "studio-fenced-retirement",
    key: "fenced-retirement",
    name: "Fenced Retirement",
    purpose: "Prove retirement cannot orphan unresolved VM work.",
    managerAgentId: "agent-kai"
  });
  const target = {
    studioInstanceId: "instance-fenced-retirement-1",
    providerInstanceId: "/VMs/Fenced Retirement/Fenced.vmx"
  };
  repository.createStudioInstance({
    id: target.studioInstanceId,
    studioId: "studio-fenced-retirement",
    vmProviderInstanceId: target.providerInstanceId
  });
  const { operation } = repository.beginVmLifecycleOperation({
    studioId: "studio-fenced-retirement",
    target,
    idempotencyKey: "fenced-retirement-pending",
    action: "start"
  });
  const activityCount = repository.getDashboard().activity.length;

  assert.throws(
    () => repository.transitionStudio("studio-fenced-retirement", "retired"),
    StudioVmOperationInProgressError
  );
  assert.equal(repository.getStudio("studio-fenced-retirement").status, "draft");
  assert.equal(repository.getDashboard().activity.length, activityCount);

  repository.failVmLifecycleOperation(operation.id, "operator reconciled failure");
  assert.equal(
    repository.transitionStudio("studio-fenced-retirement", "retired").status,
    "retired"
  );
  repository.close();
});

test("additively upgrades an existing activity ledger for Studio evidence", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "northstar-studio-migration-"));
  const databasePath = path.join(directory, "organization.sqlite");
  try {
    const initialRepository = new OrganizationRepository({
      databasePath,
      maxConcurrency: 2,
      usageSource: "chatgpt"
    });
    initialRepository.close();

    const legacyDatabase = new DatabaseSync(databasePath);
    legacyDatabase.exec(`
      PRAGMA foreign_keys = OFF;
      ALTER TABLE activity_events RENAME TO activity_events_with_studios;
      CREATE TABLE activity_events (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id),
        task_id TEXT REFERENCES tasks(id),
        run_id TEXT REFERENCES runs(id),
        agent_id TEXT REFERENCES agents(id),
        type TEXT NOT NULL,
        summary TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO activity_events (
        id, company_id, task_id, run_id, agent_id, type, summary, detail, created_at
      )
      SELECT
        id, company_id, task_id, run_id, agent_id, type, summary, detail, created_at
      FROM activity_events_with_studios;
      DROP TABLE activity_events_with_studios;
    `);
    legacyDatabase.close();

    const migratedRepository = new OrganizationRepository({
      databasePath,
      maxConcurrency: 2,
      usageSource: "chatgpt"
    });
    assert.equal(
      migratedRepository.getDashboard().activity.every((event) => (
        event.studioId === null && event.studioInstanceId === null
      )),
      true
    );
    const studio = migratedRepository.createStudio({
      id: "studio-video",
      key: "video-production",
      name: "OpenMontage Video Production",
      purpose: "Create editable, attributable production artifacts.",
      managerAgentId: "agent-kai"
    });
    assert.equal(
      migratedRepository.getDashboard().activity.some((event) => event.studioId === studio.id),
      true
    );
    migratedRepository.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fails startup closed instead of discarding duplicate pending VM operations", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "northstar-vm-pending-migration-"));
  const databasePath = path.join(directory, "organization.sqlite");
  try {
    const initialRepository = new OrganizationRepository({
      databasePath,
      maxConcurrency: 2,
      usageSource: "unknown"
    });
    initialRepository.createStudio({
      id: "studio-vm-migration",
      key: "vm-migration",
      name: "VM Migration Fixture",
      purpose: "Preserve ambiguous lifecycle evidence during migration.",
      managerAgentId: "agent-kai"
    });
    const vmTarget = {
      studioInstanceId: "instance-vm-migration",
      providerInstanceId: "/VMs/Migration/Migration.vmx"
    };
    initialRepository.createStudioInstance({
      id: vmTarget.studioInstanceId,
      studioId: "studio-vm-migration",
      vmProviderInstanceId: vmTarget.providerInstanceId
    });
    initialRepository.beginVmLifecycleOperation({
      studioId: "studio-vm-migration",
      target: vmTarget,
      idempotencyKey: "migration-pending-original",
      action: "start"
    });
    initialRepository.close();

    const legacyDatabase = new DatabaseSync(databasePath);
    legacyDatabase.exec(
      "DROP INDEX IF EXISTS idx_pending_vm_lifecycle_instance"
    );
    legacyDatabase.prepare(`
      INSERT INTO vm_lifecycle_operations (
        id, studio_id, studio_instance_id, provider_instance_id,
        idempotency_key, request_hash, action, status, provider_receipt_id,
        status_before, status_after, error_message, started_at, finished_at
      )
      SELECT
        ?, studio_id, studio_instance_id, provider_instance_id,
        ?, request_hash, action, 'pending', NULL,
        NULL, NULL, NULL, started_at, NULL
      FROM vm_lifecycle_operations
      WHERE idempotency_key = ?
    `).run(
      "operation-migration-duplicate",
      "migration-pending-duplicate",
      "migration-pending-original"
    );
    assert.equal(
      (legacyDatabase.prepare(`
        SELECT COUNT(*) AS count
        FROM vm_lifecycle_operations
        WHERE studio_instance_id = ? AND status = 'pending'
      `).get(vmTarget.studioInstanceId) as { count: number }).count,
      2
    );
    legacyDatabase.close();

    assert.throws(
      () => new OrganizationRepository({
        databasePath,
        maxConcurrency: 2,
        usageSource: "unknown"
      }),
      /Multiple pending VM lifecycle operations exist.*reconcile them before startup/
    );

    const preservedDatabase = new DatabaseSync(databasePath);
    assert.equal(
      (preservedDatabase.prepare(`
        SELECT COUNT(*) AS count
        FROM vm_lifecycle_operations
        WHERE studio_instance_id = ? AND status = 'pending'
      `).get(vmTarget.studioInstanceId) as { count: number }).count,
      2
    );
    preservedDatabase.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("records idempotent heartbeats and derives stale and offline health", () => {
  const repository = new OrganizationRepository({
    databasePath: ":memory:",
    maxConcurrency: 2,
    usageSource: "chatgpt",
    heartbeatStaleAfterMs: 30_000,
    heartbeatOfflineAfterMs: 90_000
  });
  repository.createStudio({
    id: "studio-research",
    key: "github-research",
    name: "GitHub Research & Experience",
    purpose: "Verify repositories.",
    managerAgentId: "agent-mira"
  });
  repository.createStudioInstance({
    id: "instance-research-1",
    studioId: "studio-research"
  });
  const report = {
    idempotencyKey: "heartbeat-1",
    reportedAt: "2026-07-31T12:00:00.000Z",
    vmLifecycle: "running" as const,
    components: {
      vm: "healthy" as const,
      northstarHost: "healthy" as const,
      hermes: "healthy" as const,
      sandbox: "healthy" as const
    },
    disk: { usedBytes: 100, capacityBytes: 1_000 },
    queue: { activeJobs: 0, waitingJobs: 1 },
    hostVersion: "0.1.0"
  };

  const first = repository.recordStudioHeartbeat({
    studioId: "studio-research",
    instanceId: "instance-research-1",
    report
  });
  const activityCount = repository.getDashboard().activity.length;
  const replay = repository.recordStudioHeartbeat({
    studioId: "studio-research",
    instanceId: "instance-research-1",
    report
  });

  assert.equal(first.replayed, false);
  assert.equal(first.instance.status, "online");
  assert.equal(replay.replayed, true);
  assert.equal(repository.getDashboard().activity.length, activityCount);
  assert.equal(
    repository.getStudioHealth("studio-research", "2026-07-31T12:00:29.999Z")
      .heartbeatFreshness,
    "fresh"
  );
  assert.equal(
    repository.getStudioHealth("studio-research", "2026-07-31T12:00:30.000Z").overall,
    "degraded"
  );
  assert.equal(
    repository.getStudioHealth("studio-research", "2026-07-31T12:01:30.000Z").overall,
    "unavailable"
  );
  assert.throws(
    () => repository.recordStudioHeartbeat({
      studioId: "studio-research",
      instanceId: "instance-research-1",
      report: { ...report, hostVersion: "changed" }
    }),
    /idempotency key/
  );
  assert.throws(
    () => repository.recordStudioHeartbeat({
      studioId: "studio-research",
      instanceId: "instance-research-1",
      report: { ...report, idempotencyKey: "heartbeat-2" }
    }),
    /must advance/
  );
  repository.close();
});

test("rejects cross-Studio heartbeat attribution", () => {
  const repository = new OrganizationRepository({
    databasePath: ":memory:",
    maxConcurrency: 2,
    usageSource: "chatgpt"
  });
  for (const [id, key] of [
    ["studio-research", "github-research"],
    ["studio-content", "content-marketing"]
  ] as const) {
    repository.createStudio({
      id,
      key,
      name: id,
      purpose: "Test isolation.",
      managerAgentId: "agent-mira"
    });
  }
  repository.createStudioInstance({
    id: "instance-research-1",
    studioId: "studio-research"
  });

  assert.throws(
    () => repository.recordStudioHeartbeat({
      studioId: "studio-content",
      instanceId: "instance-research-1",
      report: {
        idempotencyKey: "cross-studio",
        reportedAt: "2026-07-31T12:00:00.000Z",
        vmLifecycle: "running",
        components: {
          vm: "healthy",
          northstarHost: "healthy",
          hermes: "unknown",
          sandbox: "unknown"
        },
        disk: { usedBytes: null, capacityBytes: null },
        queue: { activeJobs: 0, waitingJobs: 0 },
        hostVersion: null
      }
    }),
    /does not belong/
  );
  assert.equal(repository.getStudioInstance("instance-research-1").lastHeartbeatAt, null);
  repository.close();
});
