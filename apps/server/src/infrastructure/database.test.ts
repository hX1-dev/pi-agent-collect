import assert from "node:assert/strict";
import test from "node:test";
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

  const directive = repository.createDirective({
    title: "Prepare a launch brief",
    brief: "Draft the smallest useful launch plan.",
    teamId: "team-social"
  });
  assert.equal(directive.ownerAgentId, "agent-mira");
  assert.equal(directive.status, "planned");
  assert.equal(directive.reviewerAgentId, null);
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
