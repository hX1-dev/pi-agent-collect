import assert from "node:assert/strict";
import test from "node:test";
import { OrganizationRepository } from "../infrastructure/database.js";
import {
  PERSONAL_STUDIO_BLUEPRINTS,
  StudioService
} from "./studio-service.js";

function createFixture(options?: {
  heartbeatStaleAfterMs?: number;
  heartbeatOfflineAfterMs?: number;
}) {
  const repository = new OrganizationRepository({
    databasePath: ":memory:",
    maxConcurrency: 2,
    usageSource: "chatgpt",
    ...(options?.heartbeatStaleAfterMs
      ? { heartbeatStaleAfterMs: options.heartbeatStaleAfterMs }
      : {}),
    ...(options?.heartbeatOfflineAfterMs
      ? { heartbeatOfflineAfterMs: options.heartbeatOfflineAfterMs }
      : {})
  });
  return { repository, service: new StudioService(repository) };
}

test("bootstraps exactly three committed Studios without adding fake employees", () => {
  const { repository, service } = createFixture();
  const beforeAgents = repository.getDashboard().agents.length;

  const first = service.bootstrapPersonalStudios();
  const activityCount = repository.getDashboard().activity.length;
  const replay = service.bootstrapPersonalStudios();

  assert.equal(first.length, 3);
  assert.equal(replay.length, 3);
  assert.deepEqual(
    first.map(({ studio }) => ({
      id: studio.id,
      key: studio.key,
      managerAgentId: studio.managerAgentId,
      status: studio.status
    })),
    PERSONAL_STUDIO_BLUEPRINTS.map((studio) => ({
      id: studio.id,
      key: studio.key,
      managerAgentId: studio.managerAgentId,
      status: "ready"
    }))
  );
  assert.equal(repository.getDashboard().agents.length, beforeAgents);
  assert.equal(repository.getDashboard().activity.length, activityCount);
  repository.close();
});

test("fails closed when a stable Studio key has conflicting identity", () => {
  const { repository, service } = createFixture();
  repository.createStudio({
    id: "wrong-studio-id",
    key: "github-research",
    name: "GitHub Research & Experience",
    purpose: "Conflicting migration fixture.",
    managerAgentId: "agent-kai"
  });

  assert.throws(
    () => service.bootstrapPersonalStudios(),
    /bootstrap conflict/
  );
  assert.equal(repository.listStudios().length, 1);
  repository.close();
});

test("observes offline once and accepts a later recovery heartbeat", () => {
  const { repository, service } = createFixture({
    heartbeatStaleAfterMs: 30_000,
    heartbeatOfflineAfterMs: 90_000
  });
  service.createStudio({
    id: "studio-test",
    key: "test-studio",
    name: "Test Studio",
    purpose: "Exercise deterministic offline observation.",
    managerAgentId: "agent-kai"
  });
  service.createInstance({
    id: "instance-test-1",
    studioId: "studio-test"
  });
  const baseReport = {
    idempotencyKey: "heartbeat-1",
    reportedAt: "2026-07-31T12:00:00.000Z",
    vmLifecycle: "running" as const,
    components: {
      vm: "healthy" as const,
      northstarHost: "healthy" as const,
      hermes: "healthy" as const,
      sandbox: "healthy" as const
    },
    disk: { usedBytes: null, capacityBytes: null },
    queue: { activeJobs: 0, waitingJobs: 0 },
    hostVersion: "0.1.0"
  };
  service.recordHeartbeat({
    studioId: "studio-test",
    instanceId: "instance-test-1",
    report: baseReport
  });

  const first = service.observeOffline("2026-07-31T12:01:30.000Z");
  const activityCount = repository.getDashboard().activity.length;
  const replay = service.observeOffline("2026-07-31T12:01:30.000Z");

  assert.equal(first.length, 1);
  assert.equal(first[0]?.health.overall, "unavailable");
  assert.deepEqual(replay, []);
  assert.equal(repository.getStudioInstance("instance-test-1").status, "offline");
  assert.equal(repository.getDashboard().activity.length, activityCount);

  const recovery = service.recordHeartbeat({
    studioId: "studio-test",
    instanceId: "instance-test-1",
    report: {
      ...baseReport,
      idempotencyKey: "heartbeat-2",
      reportedAt: "2026-07-31T12:01:31.000Z"
    }
  });
  assert.equal(recovery.instance.status, "online");
  repository.close();
});
