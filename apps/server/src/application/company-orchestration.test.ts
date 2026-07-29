import assert from "node:assert/strict";
import test from "node:test";
import type { CompanyPlan } from "@private-ai-org/core";
import { MemorySaver } from "@langchain/langgraph";
import { OrganizationRepository } from "../infrastructure/database.js";
import { MockAgentRuntime } from "../infrastructure/hermes/mock-agent-runtime.js";
import type {
  AgentRuntimePort,
  AgentRuntimeRequest,
  AgentRuntimeResult
} from "./orchestration/agent-runtime-port.js";
import {
  companyPlanFromGraphState,
  createCompanyGraph,
  type CompanyGraphInput
} from "./orchestration/company-graph.js";
import { CompanyOrchestrator } from "./orchestration/company-orchestrator.js";

class ControlledRuntime implements AgentRuntimePort {
  readonly requests: AgentRuntimeRequest[] = [];

  constructor(private readonly respond: (request: AgentRuntimeRequest) => unknown) {}

  async execute(request: AgentRuntimeRequest): Promise<AgentRuntimeResult> {
    this.requests.push(request);
    return {
      executionId: `mock-${this.requests.length}`,
      output: JSON.stringify(this.respond(request)),
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      }
    };
  }
}

function companyInput(teamCount: number, workersPerTeam: number): CompanyGraphInput {
  const teams = Array.from({ length: teamCount }, (_, teamIndex) => {
    const number = teamIndex + 1;
    return {
      id: `team-${number}`,
      name: `Department ${number}`,
      purpose: `Own department ${number} work.`,
      leadAgentId: `manager-${number}`,
      sortOrder: number
    };
  });

  const agents: CompanyGraphInput["agents"] = [
    {
      id: "ceo",
      teamId: null,
      managerAgentId: null,
      name: "Avery",
      title: "Chief Executive Officer",
      role: "Route board directives through the company.",
      responsibilities: ["Company routing"],
      runtimeProfile: "ceo"
    }
  ];

  for (const team of teams) {
    agents.push({
      id: team.leadAgentId,
      teamId: team.id,
      managerAgentId: "ceo",
      name: `Manager ${team.sortOrder}`,
      title: `${team.name} Manager`,
      role: `Manage ${team.name}.`,
      responsibilities: ["Plan department work"],
      runtimeProfile: team.leadAgentId
    });

    for (let workerIndex = 1; workerIndex <= workersPerTeam; workerIndex += 1) {
      agents.push({
        id: `worker-${team.sortOrder}-${workerIndex}`,
        teamId: team.id,
        managerAgentId: team.leadAgentId,
        name: `Worker ${team.sortOrder}.${workerIndex}`,
        title: `Specialist ${workerIndex}`,
        role: `Deliver specialist work for ${team.name}.`,
        responsibilities: ["Complete assigned deliverables"],
        runtimeProfile: `worker-${team.sortOrder}-${workerIndex}`
      });
    }
  }

  return {
    orchestrationId: `orchestration-${teamCount}-${workersPerTeam}`,
    rootTaskId: `root-task-${teamCount}-${workersPerTeam}`,
    title: "Prepare a company launch plan",
    brief: "Have the relevant departments produce accountable deliverables.",
    risk: "green",
    preferredTeamId: null,
    teams,
    agents
  };
}

function routeAllTeams(input: CompanyGraphInput) {
  return {
    departments: input.teams.map((team) => ({
      teamId: team.id,
      managerAgentId: team.leadAgentId,
      missionTitle: `Plan ${team.name}`,
      missionBrief: `Break the ${team.name} mission into owned deliverables.`
    }))
  };
}

function assignmentsForManager(input: CompanyGraphInput, managerAgentId: string) {
  return input.agents
    .filter((agent) => agent.managerAgentId === managerAgentId)
    .map((worker) => ({
      agentId: worker.id,
      title: `Deliver ${worker.title}`,
      brief: `Complete the specialist deliverable owned by ${worker.name}.`,
      acceptanceCriteria: [`Evidence from ${worker.id} is attached.`]
    }));
}

test("builds a CompanyPlan from at most three managers with four direct workers each", async () => {
  const input = companyInput(3, 4);
  const runtime = new ControlledRuntime((request) => {
    if (request.mode === "route") return routeAllTeams(input);
    return { workerAssignments: assignmentsForManager(input, request.agent.id) };
  });
  const graph = createCompanyGraph(runtime, new MemorySaver());

  const state = await graph.invoke(input, {
    configurable: { thread_id: input.orchestrationId }
  });
  const plan: CompanyPlan = {
    orchestrationId: state.orchestrationId,
    rootTaskId: state.rootTaskId,
    departments: companyPlanFromGraphState(state),
    summary: state.summary
  };

  assert.equal(plan.orchestrationId, input.orchestrationId);
  assert.equal(plan.rootTaskId, input.rootTaskId);
  assert.equal(plan.departments.length, 3);
  assert.equal(plan.summary, "3 manager(s) assigned 12 specialist deliverable(s).");
  assert.deepEqual(plan.departments.map((department) => department.teamId), [
    "team-1",
    "team-2",
    "team-3"
  ]);
  for (const department of plan.departments) {
    assert.equal(department.workerAssignments.length, 4);
    for (const assignment of department.workerAssignments) {
      const worker = input.agents.find((agent) => agent.id === assignment.agentId);
      assert.ok(worker);
      assert.equal(worker.teamId, department.teamId);
      assert.equal(worker.managerAgentId, department.managerAgentId);
    }
  }
  assert.equal(runtime.requests.filter((request) => request.mode === "route").length, 1);
  assert.equal(runtime.requests.filter((request) => request.mode === "plan").length, 3);
});

test("rejects a CEO response that routes more than three departments", async () => {
  const input = companyInput(4, 1);
  const runtime = new ControlledRuntime(() => routeAllTeams(input));
  const graph = createCompanyGraph(runtime, new MemorySaver());

  await assert.rejects(graph.invoke(input, {
    configurable: { thread_id: input.orchestrationId }
  }));
  assert.equal(runtime.requests.length, 1);
  assert.equal(runtime.requests[0]?.mode, "route");
});

test("rejects a manager response that assigns more than four workers", async () => {
  const input = companyInput(1, 5);
  const runtime = new ControlledRuntime((request) => {
    if (request.mode === "route") return routeAllTeams(input);
    return { workerAssignments: assignmentsForManager(input, request.agent.id) };
  });
  const graph = createCompanyGraph(runtime, new MemorySaver());

  await assert.rejects(graph.invoke(input, {
    configurable: { thread_id: input.orchestrationId }
  }));
  assert.equal(runtime.requests.filter((request) => request.mode === "plan").length, 1);
});

test("rejects a worker who is not a direct report of the routed manager", async () => {
  const input = companyInput(2, 1);
  const runtime = new ControlledRuntime((request) => {
    if (request.mode === "route") {
      return { departments: routeAllTeams(input).departments.slice(0, 1) };
    }
    return {
      workerAssignments: [{
        agentId: "worker-2-1",
        title: "Borrow another department's worker",
        brief: "Attempt an invalid cross-department assignment.",
        acceptanceCriteria: ["The assignment is rejected."]
      }]
    };
  });
  const graph = createCompanyGraph(runtime, new MemorySaver());

  await assert.rejects(
    graph.invoke(input, {
      configurable: { thread_id: input.orchestrationId }
    }),
    /worker-2-1 is not a direct report of manager-1/
  );
});

test("persists an idempotent 1 CEO + 3 managers + 12 workers company plan", async () => {
  const repository = new OrganizationRepository({
    databasePath: ":memory:",
    maxConcurrency: 2,
    usageSource: "unknown"
  });
  const rootTask = repository.createDirective({
    title: "Prepare a company-wide operating plan",
    brief: "Ask all departments for the smallest accountable contribution."
  });
  const initialTaskCount = repository.getDashboard().tasks.length;
  const orchestrator = new CompanyOrchestrator(repository, new MockAgentRuntime(), new MemorySaver());

  const orchestration = await orchestrator.orchestrate(rootTask.id);
  assert.equal(orchestration.status, "completed");
  assert.equal(orchestration.plan?.departments.length, 3);
  assert.equal(orchestration.plan?.departments.reduce(
    (count, department) => count + department.workerAssignments.length,
    0
  ), 12);
  assert.equal(repository.getDashboard().tasks.length, initialTaskCount + 15);
  assert.throws(
    () => repository.createRun(rootTask.id, "mock"),
    /cannot run until its child tasks are finished/
  );
  const workerTask = repository.getDashboard().tasks.find((task) => (
    task.parentTaskId !== null
    && repository.getDashboard().tasks.some((parent) => parent.id === task.parentTaskId && parent.parentTaskId === rootTask.id)
  ));
  assert.ok(workerTask);
  assert.equal(repository.createRun(workerTask.id, "mock").status, "queued");

  const repeated = await orchestrator.orchestrate(rootTask.id);
  assert.equal(repeated.id, orchestration.id);
  assert.equal(repository.getDashboard().tasks.length, initialTaskCount + 15);
  repository.close();
});
