import assert from "node:assert/strict";
import test from "node:test";
import type { VmTarget } from "../application/vm-provider-port.js";
import { MockVmProvider } from "./mock-vm-provider.js";

const target: VmTarget = {
  studioInstanceId: "instance-research-1",
  providerInstanceId: "mock-research-vm"
};

function provider(status: "stopped" | "running" | "suspended" = "stopped") {
  return new MockVmProvider({
    targets: [{ providerInstanceId: target.providerInstanceId, status }],
    now: () => "2026-07-31T12:00:00.000Z"
  });
}

test("observes only an explicitly configured VM target", async () => {
  const vmProvider = provider("running");
  assert.deepEqual(await vmProvider.observe(target), {
    target,
    status: "running",
    observedAt: "2026-07-31T12:00:00.000Z"
  });

  await assert.rejects(
    vmProvider.observe({ ...target, providerInstanceId: "unknown-vm" }),
    /not configured/
  );
});

test("returns one durable-shaped receipt for an idempotent lifecycle request", async () => {
  const vmProvider = provider();
  const request = {
    idempotencyKey: "start-research-1",
    target,
    action: "start" as const
  };

  const first = await vmProvider.execute(request);
  const replay = await vmProvider.execute(request);

  assert.deepEqual(replay, first);
  assert.equal(first.statusBefore, "stopped");
  assert.equal(first.statusAfter, "running");
  assert.equal(vmProvider.history().length, 1);
  assert.equal((await vmProvider.observe(target)).status, "running");
});

test("rejects idempotency-key reuse for a different VM operation", async () => {
  const vmProvider = provider();
  await vmProvider.execute({
    idempotencyKey: "operation-1",
    target,
    action: "start"
  });

  await assert.rejects(
    vmProvider.execute({
      idempotencyKey: "operation-1",
      target,
      action: "stop"
    }),
    /reused for a different request/
  );
});

test("rejects lifecycle actions that are invalid for the observed state", async () => {
  const vmProvider = provider("stopped");
  await assert.rejects(
    vmProvider.execute({
      idempotencyKey: "suspend-stopped-vm",
      target,
      action: "suspend"
    }),
    /Invalid VM lifecycle action/
  );
  assert.equal(vmProvider.history().length, 0);
});
