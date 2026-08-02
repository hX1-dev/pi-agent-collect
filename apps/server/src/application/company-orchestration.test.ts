import assert from "node:assert/strict";
import test from "node:test";
import type { StudioCompanyPlan } from "@private-ai-org/core";
import { MemorySaver } from "@langchain/langgraph";
import { OrganizationRepository } from "../infrastructure/database.js";
import { MockAgentRuntime } from "../infrastructure/hermes/mock-agent-runtime.js";
import type {
  AgentRuntimePort,
  AgentRuntimeRequest,
  AgentRuntimeResult
} from "./orchestration/agent-runtime-port.js";
import {
  createCompanyGraph,
  studioPlanFromGraphState,
  type CompanyGraphInput
} from "./orchestration/company-graph.js";
import { CompanyOrchestrator } from "./orchestration/company-orchestrator.js";
import { StudioService } from "./studio-service.js";

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

function companyInput(studioCount: number): CompanyGraphInput {
  const studios = Array.from({ length: studioCount }, (_, studioIndex) => {
    const number = studioIndex + 1;
    return {
      id: `studio-${number}`,
      key: `studio-${number}`,
      name: `Studio ${number}`,
      purpose: `Own Studio ${number} work.`,
      managerAgentId: `manager-${number}`,
      sortOrder: number,
      status: "active" as const
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
    },
    ...studios.map((studio) => ({
      id: studio.managerAgentId,
      teamId: null,
      managerAgentId: "ceo",
      name: `Manager ${studio.sortOrder}`,
      title: `${studio.name} Manager`,
      role: `Manage ${studio.name}.`,
      responsibilities: ["Own Studio outcomes"],
      runtimeProfile: studio.managerAgentId
    }))
  ];

  return {
    orchestrationId: `orchestration-${studioCount}`,
    rootTaskId: `root-task-${studioCount}`,
    title: "Prepare a company launch plan",
    brief: "Have the relevant Studios produce accountable deliverables.",
    risk: "green",
    ceoAgentId: "ceo",
    preferredStudioId: null,
    studios,
    agents
  };
}

function routeAllStudios(input: CompanyGraphInput) {
  return {
    studios: input.studios.map((studio) => ({
      studioId: studio.id,
      managerAgentId: studio.managerAgentId,
      missionTitle: `Plan ${studio.name}`,
      missionBrief: `Break the ${studio.name} mission into evidence-backed work.`
    }))
  };
}

function temporaryWorkerForManager(managerAgentId: string) {
  return {
    temporaryWorkers: [{
      key: `worker-${managerAgentId}`,
      kind: "workflow",
      role: "Temporary delivery workflow",
      title: `Deliver work for ${managerAgentId}`,
      brief: "Complete the smallest useful work package under manager accountability.",
      acceptanceCriteria: ["Evidence is attached."]
    }]
  };
}

test("builds a Studio plan without permanent specialist Agent identities", async () => {
  const input = companyInput(3);
  const runtime = new ControlledRuntime((request) => {
    if (request.mode === "route") return routeAllStudios(input);
    return temporaryWorkerForManager(request.agent.id);
  });
  const graph = createCompanyGraph(runtime, new MemorySaver());

  const state = await graph.invoke(input, {
    configurable: { thread_id: input.orchestrationId }
  });
  const plan: StudioCompanyPlan = {
    planningModel: "studio-v1",
    orchestrationId: state.orchestrationId,
    rootTaskId: state.rootTaskId,
    studios: studioPlanFromGraphState(state),
    summary: state.summary
  };

  assert.equal(plan.studios.length, 3);
  assert.equal(plan.summary, "3 Studio manager(s) described 3 temporary Run worker(s).");
  assert.deepEqual(plan.studios.map((studio) => studio.studioId), [
    "studio-1",
    "studio-2",
    "studio-3"
  ]);
  assert.equal(input.agents.length, 4);
  for (const studio of plan.studios) {
    assert.equal(studio.temporaryWorkers.length, 1);
    assert.equal(studio.temporaryWorkers[0]?.kind, "workflow");
    assert.ok(!("agentId" in (studio.temporaryWorkers[0] ?? {})));
  }
  assert.equal(runtime.requests.filter((request) => request.mode === "route").length, 1);
  assert.equal(runtime.requests.filter((request) => request.mode === "plan").length, 3);
});

test("rejects a planner input with more than the three committed Studios", async () => {
  const input = companyInput(4);
  const runtime = new ControlledRuntime(() => routeAllStudios(input));
  const graph = createCompanyGraph(runtime, new MemorySaver());

  await assert.rejects(graph.invoke(input, {
    configurable: { thread_id: input.orchestrationId }
  }));
  assert.equal(runtime.requests.length, 0);
});

test("allows a Studio manager to keep work without inventing a temporary worker", async () => {
  const input = companyInput(1);
  const runtime = new ControlledRuntime((request) => (
    request.mode === "route" ? routeAllStudios(input) : { temporaryWorkers: [] }
  ));
  const graph = createCompanyGraph(runtime, new MemorySaver());

  const state = await graph.invoke(input, {
    configurable: { thread_id: input.orchestrationId }
  });
  assert.equal(studioPlanFromGraphState(state)[0]?.temporaryWorkers.length, 0);
  assert.equal(state.summary, "1 Studio manager(s) described 0 temporary Run worker(s).");
});

test("rejects duplicate temporary worker descriptions from one manager", async () => {
  const input = companyInput(1);
  const duplicate = temporaryWorkerForManager("manager-1").temporaryWorkers[0];
  const runtime = new ControlledRuntime((request) => (
    request.mode === "route"
      ? routeAllStudios(input)
      : { temporaryWorkers: [duplicate, duplicate] }
  ));
  const graph = createCompanyGraph(runtime, new MemorySaver());

  await assert.rejects(
    graph.invoke(input, {
      configurable: { thread_id: input.orchestrationId }
    }),
    /same temporary worker twice/
  );
});

test("persists an idempotent CEO plus three Studio-manager plan", async () => {
  const repository = new OrganizationRepository({
    databasePath: ":memory:",
    maxConcurrency: 2,
    usageSource: "unknown"
  });
  new StudioService(repository).bootstrapPersonalStudios();
  const rootTask = repository.createDirective({
    title: "Prepare a company-wide operating plan",
    brief: "Ask all Studios for the smallest accountable contribution."
  });
  const initialTaskCount = repository.getDashboard().tasks.length;
  const orchestrator = new CompanyOrchestrator(
    repository,
    new MockAgentRuntime(),
    new MemorySaver()
  );

  const orchestration = await orchestrator.orchestrate(rootTask.id);
  assert.equal(orchestration.status, "completed");
  assert.equal(orchestration.plan?.planningModel, "studio-v1");
  assert.equal(
    orchestration.plan?.planningModel === "studio-v1"
      ? orchestration.plan.studios.length
      : 0,
    3
  );
  assert.equal(repository.getDashboard().tasks.length, initialTaskCount + 6);
  assert.throws(
    () => repository.createRun(rootTask.id, "mock"),
    /cannot run until its child tasks are finished/
  );

  const plannedTasks = repository.getDashboard().tasks.filter(
    (task) => task.parentTaskId === rootTask.id
      || repository.getDashboard().tasks.some(
        (parent) => parent.id === task.parentTaskId && parent.parentTaskId === rootTask.id
      )
  );
  assert.equal(plannedTasks.length, 6);
  assert.ok(plannedTasks.every((task) => task.studioId !== null));
  assert.ok(plannedTasks.every((task) => (
    ["agent-kai", "agent-mira", "agent-rowan"].includes(task.ownerAgentId ?? "")
  )));
  assert.ok(plannedTasks.every((task) => ![
    "agent-iris",
    "agent-theo",
    "agent-nova",
    "agent-june"
  ].includes(task.ownerAgentId ?? "")));

  const temporaryTask = plannedTasks.find((task) => (
    plannedTasks.some((parent) => parent.id === task.parentTaskId)
  ));
  assert.ok(temporaryTask);
  assert.match(temporaryTask.brief, /Temporary worker:/);
  assert.equal(repository.createRun(temporaryTask.id, "mock").status, "queued");

  const repeated = await orchestrator.orchestrate(rootTask.id);
  assert.equal(repeated.id, orchestration.id);
  assert.equal(repository.getDashboard().tasks.length, initialTaskCount + 6);
  repository.close();
});

test("fails closed instead of resuming an incompatible legacy graph checkpoint", async () => {
  const repository = new OrganizationRepository({
    databasePath: ":memory:",
    maxConcurrency: 2,
    usageSource: "unknown"
  });
  const rootTask = repository.createDirective({
    title: "Legacy in-flight directive",
    brief: "This checkpoint predates the Studio planning contract."
  });
  const legacy = repository.createOrchestration(
    rootTask.id,
    "northstar-company",
    "1"
  );
  const orchestrator = new CompanyOrchestrator(
    repository,
    new MockAgentRuntime(),
    new MemorySaver()
  );

  await assert.rejects(
    orchestrator.orchestrate(rootTask.id),
    /Cannot resume northstar-company@1/
  );
  const failed = repository.getOrchestrationForTask(rootTask.id);
  assert.equal(failed?.id, legacy.id);
  assert.equal(failed?.status, "failed");
  assert.match(failed?.summary ?? "", /new board directive/);
  repository.close();
});
