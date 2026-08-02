import assert from "node:assert/strict";
import test from "node:test";
import {
  assertStudioInstanceTransition,
  assertStudioTransition,
  canTransitionStudio,
  canTransitionStudioInstance,
  evaluateHeartbeatFreshness,
  isJobLeaseExpired,
  type JobLease
} from "./studio.js";

test("allows a configured Studio to become active through explicit transitions", () => {
  assert.equal(canTransitionStudio("draft", "ready"), true);
  assert.equal(canTransitionStudio("ready", "active"), true);
});

test("keeps a retired Studio terminal", () => {
  assert.equal(canTransitionStudio("retired", "ready"), false);
  assert.throws(
    () => assertStudioTransition("retired", "active"),
    /Invalid Studio transition/
  );
});

test("allows an enrolled instance to recover without changing Studio identity", () => {
  assert.equal(canTransitionStudioInstance("pending_enrollment", "online"), true);
  assert.equal(canTransitionStudioInstance("pending_enrollment", "degraded"), true);
  assert.equal(canTransitionStudioInstance("online", "offline"), true);
  assert.equal(canTransitionStudioInstance("offline", "online"), true);
});

test("prevents a revoked instance from becoming active again", () => {
  assert.equal(canTransitionStudioInstance("revoked", "online"), false);
  assert.throws(
    () => assertStudioInstanceTransition("revoked", "online"),
    /Invalid Studio instance transition/
  );
});

test("evaluates heartbeat freshness against an injected observation time", () => {
  const base = {
    staleAfterMs: 30_000,
    offlineAfterMs: 90_000,
    observedAt: "2026-07-31T12:02:00.000Z"
  };

  assert.equal(evaluateHeartbeatFreshness({ ...base, lastHeartbeatAt: null }), "unknown");
  assert.equal(
    evaluateHeartbeatFreshness({ ...base, lastHeartbeatAt: "2026-07-31T12:01:45.000Z" }),
    "fresh"
  );
  assert.equal(
    evaluateHeartbeatFreshness({ ...base, lastHeartbeatAt: "2026-07-31T12:01:20.000Z" }),
    "stale"
  );
  assert.equal(
    evaluateHeartbeatFreshness({ ...base, lastHeartbeatAt: "2026-07-31T12:00:30.000Z" }),
    "offline"
  );
});

test("rejects invalid heartbeat thresholds and timestamps", () => {
  assert.throws(
    () => evaluateHeartbeatFreshness({
      lastHeartbeatAt: "2026-07-31T12:00:00.000Z",
      observedAt: "2026-07-31T12:01:00.000Z",
      staleAfterMs: 60_000,
      offlineAfterMs: 30_000
    }),
    /offlineAfterMs/
  );
  assert.throws(
    () => evaluateHeartbeatFreshness({
      lastHeartbeatAt: "not-a-date",
      observedAt: "2026-07-31T12:01:00.000Z",
      staleAfterMs: 30_000,
      offlineAfterMs: 90_000
    }),
    /lastHeartbeatAt/
  );
});

test("treats only active leases as expirable", () => {
  const lease: JobLease = {
    id: "lease-1",
    studioId: "studio-research",
    instanceId: "instance-research-1",
    taskId: "task-1",
    runId: "run-1",
    status: "active",
    issuedAt: "2026-07-31T12:00:00.000Z",
    renewedAt: "2026-07-31T12:00:00.000Z",
    expiresAt: "2026-07-31T12:01:00.000Z",
    releasedAt: null
  };

  assert.equal(isJobLeaseExpired(lease, "2026-07-31T12:00:59.999Z"), false);
  assert.equal(isJobLeaseExpired(lease, "2026-07-31T12:01:00.000Z"), true);
  assert.equal(isJobLeaseExpired({ ...lease, status: "released" }, "2026-07-31T12:02:00.000Z"), false);
});
