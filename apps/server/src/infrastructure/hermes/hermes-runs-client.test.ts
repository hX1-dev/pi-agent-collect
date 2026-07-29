import assert from "node:assert/strict";
import test from "node:test";
import {
  HermesRunApprovalRequiredError,
  HermesRunsClient,
  type HermesFetch
} from "./hermes-runs-client.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("uses the unprefixed Runs API for a dedicated Hermes profile gateway", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [
    json({ run_id: "run-1", status: "started" }, 202),
    json({
      object: "hermes.run",
      run_id: "run-1",
      status: "completed",
      session_id: "session-1",
      output: "done",
      usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 }
    })
  ];
  const fetch: HermesFetch = async (url, init) => {
    calls.push({ url: String(url), ...(init ? { init } : {}) });
    const response = responses.shift();
    if (!response) throw new Error("Unexpected request");
    return response;
  };
  const client = new HermesRunsClient({
    baseUrl: "http://127.0.0.1:8701",
    apiKey: "test-secret-0001",
    profile: "ceo",
    fetch,
    sleep: async () => {}
  });

  const result = await client.run({
    input: "Plan the directive",
    instructions: "Return JSON",
    sessionId: "session-1",
    sessionKey: "northstar:agent:ceo",
    idempotencyKey: "orchestration:ceo-route"
  });

  assert.equal(result.output, "done");
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    "/v1/runs",
    "/v1/runs/run-1"
  ]);
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get("authorization"), "Bearer test-secret-0001");
  assert.equal(headers.get("x-hermes-session-key"), "northstar:agent:ceo");
});

test("adds a profile path only when multiplex routing is explicitly enabled", async () => {
  let requestedPath = "";
  const client = new HermesRunsClient({
    baseUrl: "http://127.0.0.1:8642",
    apiKey: "test-secret-0002",
    profile: "social-manager",
    profilePathPrefix: true,
    fetch: async (url) => {
      requestedPath = new URL(String(url)).pathname;
      return json({ run_id: "run-2", status: "started" }, 202);
    }
  });
  await client.start({
    input: "Plan",
    instructions: "Return JSON",
    sessionId: "session-2",
    sessionKey: "northstar:agent:mira",
    idempotencyKey: "route:mira"
  });
  assert.equal(requestedPath, "/p/social-manager/v1/runs");
});

test("stops and surfaces Hermes approval waits instead of auto-approving", async () => {
  const paths: string[] = [];
  const responses = [
    json({ run_id: "run-approval", status: "started" }, 202),
    json({
      object: "hermes.run",
      run_id: "run-approval",
      status: "waiting_for_approval",
      session_id: "session-3",
      output: null,
      usage: null
    }),
    json({ run_id: "run-approval", status: "stopping" })
  ];
  const client = new HermesRunsClient({
    baseUrl: "http://127.0.0.1:8701",
    apiKey: "test-secret-0003",
    profile: "ceo",
    fetch: async (url) => {
      paths.push(new URL(String(url)).pathname);
      const response = responses.shift();
      if (!response) throw new Error("Unexpected request");
      return response;
    },
    sleep: async () => {}
  });

  await assert.rejects(client.run({
    input: "Use a tool",
    instructions: "Never auto-approve",
    sessionId: "session-3",
    sessionKey: "northstar:agent:ceo",
    idempotencyKey: "approval:test"
  }), (error) => {
    assert.ok(error instanceof HermesRunApprovalRequiredError);
    assert.equal(error.stopRequested, true);
    return true;
  });
  assert.deepEqual(paths, [
    "/v1/runs",
    "/v1/runs/run-approval",
    "/v1/runs/run-approval/stop"
  ]);
});
