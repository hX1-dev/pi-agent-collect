import type {
  Agent,
  RiskLevel,
  Studio,
  StudioMissionPlan
} from "@private-ai-org/core";
import {
  END,
  ReducedValue,
  Send,
  START,
  StateGraph,
  StateSchema,
  type BaseCheckpointSaver
} from "@langchain/langgraph";
import { z } from "zod/v4";
import type { AgentRuntimePort } from "./agent-runtime-port.js";

export const COMPANY_GRAPH_NAME = "northstar-company";
export const COMPANY_GRAPH_VERSION = "2";

const graphStudioSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  purpose: z.string(),
  managerAgentId: z.string(),
  sortOrder: z.number(),
  status: z.enum(["draft", "ready", "active", "suspended", "retired"])
});

const graphAgentSchema = z.object({
  id: z.string(),
  teamId: z.string().nullable(),
  managerAgentId: z.string().nullable(),
  name: z.string(),
  title: z.string(),
  role: z.string(),
  responsibilities: z.array(z.string()),
  runtimeProfile: z.string().nullable()
});

const studioRouteSchema = z.object({
  studioId: z.string(),
  managerAgentId: z.string(),
  missionTitle: z.string().min(1).max(180),
  missionBrief: z.string().min(1).max(8_000)
});

const temporaryWorkerSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  kind: z.enum(["workflow", "subagent", "sandbox"]),
  role: z.string().min(1).max(120),
  title: z.string().min(1).max(180),
  brief: z.string().min(1).max(8_000),
  acceptanceCriteria: z.array(z.string().min(1).max(1_000)).min(1).max(8)
});

const studioPlanSchema = studioRouteSchema.extend({
  temporaryWorkers: z.array(temporaryWorkerSchema).max(4)
});

const ceoResponseSchema = z.object({
  studios: z.array(studioRouteSchema).min(1).max(3)
});

const managerResponseSchema = z.object({
  temporaryWorkers: z.array(temporaryWorkerSchema).max(4)
});

const CompanyState = new StateSchema({
  orchestrationId: z.string(),
  rootTaskId: z.string(),
  title: z.string(),
  brief: z.string(),
  risk: z.enum(["green", "yellow", "red"]),
  ceoAgentId: z.string(),
  preferredStudioId: z.string().nullable().default(null),
  studios: z.array(graphStudioSchema).min(1).max(3),
  agents: z.array(graphAgentSchema),
  routes: z.array(studioRouteSchema).default(() => []),
  activeRoute: studioRouteSchema.nullable().default(null),
  studioPlans: new ReducedValue(
    z.array(studioPlanSchema).default(() => []),
    {
      inputSchema: studioPlanSchema,
      reducer: (current, next) => [...current, next]
    }
  ),
  summary: z.string().default("")
});

export interface CompanyGraphInput {
  orchestrationId: string;
  rootTaskId: string;
  title: string;
  brief: string;
  risk: RiskLevel;
  ceoAgentId: string;
  preferredStudioId: string | null;
  studios: Array<Pick<
    Studio,
    "id" | "key" | "name" | "purpose" | "managerAgentId" | "sortOrder" | "status"
  >>;
  agents: Array<Pick<Agent, "id" | "teamId" | "managerAgentId" | "name" | "title" | "role" | "responsibilities" | "runtimeProfile">>;
}

function parseJsonObject(output: string): unknown {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("Agent response did not contain a JSON object");
  }
}

function agentFromState(state: typeof CompanyState.State, agentId: string): Agent {
  const agent = state.agents.find((candidate) => candidate.id === agentId);
  if (!agent) throw new Error(`Agent is not in the organization graph: ${agentId}`);
  return {
    ...agent,
    companyId: "company-northstar",
    initials: agent.name.slice(0, 2).toUpperCase(),
    accent: "#506a64",
    status: "sleeping",
    executionProvider: "hermes",
    sandbox: "read-only",
    workspacePath: null,
    currentTaskId: null,
    lastActiveAt: null
  };
}

function validateRoutes(state: typeof CompanyState.State, routes: z.infer<typeof studioRouteSchema>[]) {
  const seenStudios = new Set<string>();
  for (const route of routes) {
    if (seenStudios.has(route.studioId)) {
      throw new Error(`CEO routed the same Studio twice: ${route.studioId}`);
    }
    seenStudios.add(route.studioId);
    const studio = state.studios.find((candidate) => candidate.id === route.studioId);
    if (!studio || studio.managerAgentId !== route.managerAgentId || studio.status === "retired") {
      throw new Error(`CEO route does not match the durable Studio registry: ${route.studioId}`);
    }
  }
}

function validateTemporaryWorkers(workers: z.infer<typeof temporaryWorkerSchema>[]) {
  const seenKeys = new Set<string>();
  for (const worker of workers) {
    if (seenKeys.has(worker.key)) {
      throw new Error(`Manager described the same temporary worker twice: ${worker.key}`);
    }
    seenKeys.add(worker.key);
  }
}

export function createCompanyGraph(runtime: AgentRuntimePort, checkpointer: BaseCheckpointSaver) {
  const ceoRoute = async (state: typeof CompanyState.State) => {
    const ceo = state.agents.find((agent) => agent.id === state.ceoAgentId);
    if (!ceo) throw new Error("The organization needs one configured CEO profile");
    const result = await runtime.execute({
      idempotencyKey: `${state.orchestrationId}:ceo-route:${ceo.id}`,
      orchestrationId: state.orchestrationId,
      rootTaskId: state.rootTaskId,
      agent: agentFromState(state, ceo.id),
      mode: "route",
      brief: `${state.title}\n\n${state.brief}`,
      instructions: [
        "Route this board directive to one through three Studio managers.",
        "Use only the Studio and manager IDs supplied in context.",
        "Return JSON only: {\"studios\":[{\"studioId\":\"...\",\"managerAgentId\":\"...\",\"missionTitle\":\"...\",\"missionBrief\":\"...\"}]}"
      ].join("\n"),
      context: {
        preferredStudioId: state.preferredStudioId,
        studios: state.studios
      }
    });
    const response = ceoResponseSchema.parse(parseJsonObject(result.output));
    validateRoutes(state, response.studios);
    return { routes: response.studios };
  };

  const fanOutToManagers = (state: typeof CompanyState.State) => state.routes.map((route) => new Send(
    "manager_plan",
    { ...state, activeRoute: route }
  ));

  const managerPlan = async (state: typeof CompanyState.State) => {
    const route = state.activeRoute;
    if (!route) throw new Error("Manager planning requires an active Studio route");
    const manager = agentFromState(state, route.managerAgentId);
    const studio = state.studios.find((candidate) => candidate.id === route.studioId);
    if (!studio) throw new Error(`Studio is not in the organization graph: ${route.studioId}`);
    const result = await runtime.execute({
      idempotencyKey: `${state.orchestrationId}:manager-plan:${manager.id}`,
      orchestrationId: state.orchestrationId,
      rootTaskId: state.rootTaskId,
      agent: manager,
      mode: "plan",
      brief: `${route.missionTitle}\n\n${route.missionBrief}`,
      instructions: [
        "The Studio manager remains the accountable owner.",
        "Describe zero through four temporary Run workers only when decomposition improves the outcome.",
        "A temporary worker is not a durable employee. Choose kind workflow, subagent, or sandbox.",
        "Return JSON only: {\"temporaryWorkers\":[{\"key\":\"...\",\"kind\":\"workflow|subagent|sandbox\",\"role\":\"...\",\"title\":\"...\",\"brief\":\"...\",\"acceptanceCriteria\":[\"...\"]}]}"
      ].join("\n"),
      context: { route, studio }
    });
    const response = managerResponseSchema.parse(parseJsonObject(result.output));
    validateTemporaryWorkers(response.temporaryWorkers);
    return {
      studioPlans: {
        ...route,
        temporaryWorkers: response.temporaryWorkers
      }
    };
  };

  const finalize = (state: typeof CompanyState.State) => {
    if (state.studioPlans.length !== state.routes.length) {
      throw new Error("Not every routed manager produced a Studio plan");
    }
    const workerCount = state.studioPlans.reduce(
      (sum, studio) => sum + studio.temporaryWorkers.length,
      0
    );
    return {
      summary: `${state.studioPlans.length} Studio manager(s) described ${workerCount} temporary Run worker(s).`
    };
  };

  return new StateGraph(CompanyState)
    .addNode("ceo_route", ceoRoute)
    .addNode("manager_plan", managerPlan)
    .addNode("finalize", finalize)
    .addEdge(START, "ceo_route")
    .addConditionalEdges("ceo_route", fanOutToManagers, ["manager_plan"])
    .addEdge("manager_plan", "finalize")
    .addEdge("finalize", END)
    .compile({ checkpointer });
}

export function studioPlanFromGraphState(state: typeof CompanyState.State): StudioMissionPlan[] {
  const order = new Map(state.studios.map((studio) => [studio.id, studio.sortOrder]));
  return studioPlanSchema.array().parse(state.studioPlans).toSorted(
    (left, right) => (order.get(left.studioId) ?? 0) - (order.get(right.studioId) ?? 0)
  );
}
