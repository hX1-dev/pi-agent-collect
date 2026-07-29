import assert from "node:assert/strict";
import test from "node:test";
import type { Agent } from "@private-ai-org/core";
import { AgentRuntimeGate } from "./agent-runtime-gate.js";
import type {
  AgentRuntimePort,
  AgentRuntimeRequest,
  AgentRuntimeResult
} from "./orchestration/agent-runtime-port.js";

const agent: Agent = {
  id: "agent-test",
  companyId: "company-northstar",
  teamId: "team-product",
  managerAgentId: "agent-kai",
  name: "Test",
  title: "Test Specialist",
  initials: "TE",
  accent: "#000000",
  role: "Verify runtime locking.",
  responsibilities: ["Testing"],
  status: "sleeping",
  executionProvider: "hermes",
  runtimeProfile: "test-specialist",
  sandbox: "read-only",
  workspacePath: null,
  currentTaskId: null,
  lastActiveAt: null
};

function request(id: string): AgentRuntimeRequest {
  return {
    idempotencyKey: id,
    orchestrationId: "orchestration-test",
    rootTaskId: "task-test",
    agent,
    mode: "execute",
    brief: "Test the gate",
    instructions: "Return safely",
    context: {}
  };
}

function result(id: string): AgentRuntimeResult {
  return {
    executionId: id,
    output: "done",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  };
}

test("serializes concurrent executions for the same durable Agent", async () => {
  let calls = 0;
  let releaseFirst: (() => void) | undefined;
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const runtime: AgentRuntimePort = {
    async execute(input) {
      calls += 1;
      if (calls === 1) await firstBlocked;
      return result(input.idempotencyKey);
    }
  };
  const gate = new AgentRuntimeGate(runtime, 4, "/tmp/northstar-gate-test");

  const first = gate.execute(request("first"));
  const second = gate.execute(request("second"));
  await Promise.resolve();
  assert.equal(calls, 1);

  releaseFirst?.();
  const completed = await Promise.all([first, second]);
  assert.deepEqual(completed.map((item) => item.executionId), ["first", "second"]);
  assert.equal(calls, 2);
});
