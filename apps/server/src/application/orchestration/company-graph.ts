import type { Agent, DepartmentPlan, RiskLevel, Team } from "@private-ai-org/core";
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
export const COMPANY_GRAPH_VERSION = "1";

const graphTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.string(),
  leadAgentId: z.string(),
  sortOrder: z.number()
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

const departmentRouteSchema = z.object({
  teamId: z.string(),
  managerAgentId: z.string(),
  missionTitle: z.string().min(1).max(180),
  missionBrief: z.string().min(1).max(8_000)
});

const workerAssignmentSchema = z.object({
  agentId: z.string(),
  title: z.string().min(1).max(180),
  brief: z.string().min(1).max(8_000),
  acceptanceCriteria: z.array(z.string().min(1).max(1_000)).min(1).max(8)
});

const departmentPlanSchema = departmentRouteSchema.extend({
  workerAssignments: z.array(workerAssignmentSchema).min(1).max(4)
});

const ceoResponseSchema = z.object({
  departments: z.array(departmentRouteSchema).min(1).max(3)
});

const managerResponseSchema = z.object({
  workerAssignments: z.array(workerAssignmentSchema).min(1).max(4)
});

const CompanyState = new StateSchema({
  orchestrationId: z.string(),
  rootTaskId: z.string(),
  title: z.string(),
  brief: z.string(),
  risk: z.enum(["green", "yellow", "red"]),
  preferredTeamId: z.string().nullable().default(null),
  teams: z.array(graphTeamSchema),
  agents: z.array(graphAgentSchema),
  routes: z.array(departmentRouteSchema).default(() => []),
  activeRoute: departmentRouteSchema.nullable().default(null),
  departmentPlans: new ReducedValue(
    z.array(departmentPlanSchema).default(() => []),
    {
      inputSchema: departmentPlanSchema,
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
  preferredTeamId: string | null;
  teams: Array<Pick<Team, "id" | "name" | "purpose" | "leadAgentId" | "sortOrder">>;
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

function validateRoutes(state: typeof CompanyState.State, routes: z.infer<typeof departmentRouteSchema>[]) {
  const seenTeams = new Set<string>();
  for (const route of routes) {
    if (seenTeams.has(route.teamId)) throw new Error(`CEO routed the same team twice: ${route.teamId}`);
    seenTeams.add(route.teamId);
    const team = state.teams.find((candidate) => candidate.id === route.teamId);
    if (!team || team.leadAgentId !== route.managerAgentId) {
      throw new Error(`CEO route does not match the durable organization: ${route.teamId}`);
    }
  }
}

function validateAssignments(
  state: typeof CompanyState.State,
  route: z.infer<typeof departmentRouteSchema>,
  assignments: z.infer<typeof workerAssignmentSchema>[]
) {
  const seenWorkers = new Set<string>();
  for (const assignment of assignments) {
    if (seenWorkers.has(assignment.agentId)) throw new Error(`Manager assigned one worker twice: ${assignment.agentId}`);
    seenWorkers.add(assignment.agentId);
    const worker = state.agents.find((candidate) => candidate.id === assignment.agentId);
    if (!worker || worker.teamId !== route.teamId || worker.managerAgentId !== route.managerAgentId) {
      throw new Error(`${assignment.agentId} is not a direct report of ${route.managerAgentId}`);
    }
  }
}

export function createCompanyGraph(runtime: AgentRuntimePort, checkpointer: BaseCheckpointSaver) {
  const ceoRoute = async (state: typeof CompanyState.State) => {
    const ceo = state.agents.find((agent) => agent.managerAgentId === null && agent.teamId === null);
    if (!ceo) throw new Error("The organization needs exactly one root CEO profile");
    const result = await runtime.execute({
      idempotencyKey: `${state.orchestrationId}:ceo-route:${ceo.id}`,
      orchestrationId: state.orchestrationId,
      rootTaskId: state.rootTaskId,
      agent: agentFromState(state, ceo.id),
      mode: "route",
      brief: `${state.title}\n\n${state.brief}`,
      instructions: [
        "Route this board directive to one through three department managers.",
        "Use only the team and manager IDs supplied in context.",
        "Return JSON only: {\"departments\":[{\"teamId\":\"...\",\"managerAgentId\":\"...\",\"missionTitle\":\"...\",\"missionBrief\":\"...\"}]}"
      ].join("\n"),
      context: {
        preferredTeamId: state.preferredTeamId,
        teams: state.teams
      }
    });
    const response = ceoResponseSchema.parse(parseJsonObject(result.output));
    validateRoutes(state, response.departments);
    return { routes: response.departments };
  };

  const fanOutToManagers = (state: typeof CompanyState.State) => state.routes.map((route) => new Send(
    "manager_plan",
    { ...state, activeRoute: route }
  ));

  const managerPlan = async (state: typeof CompanyState.State) => {
    const route = state.activeRoute;
    if (!route) throw new Error("Manager planning requires an active department route");
    const manager = agentFromState(state, route.managerAgentId);
    const workers = state.agents.filter((agent) => agent.managerAgentId === manager.id && agent.teamId === route.teamId);
    const result = await runtime.execute({
      idempotencyKey: `${state.orchestrationId}:manager-plan:${manager.id}`,
      orchestrationId: state.orchestrationId,
      rootTaskId: state.rootTaskId,
      agent: manager,
      mode: "plan",
      brief: `${route.missionTitle}\n\n${route.missionBrief}`,
      instructions: [
        "Assign the mission to one through four direct reports. Use only supplied worker IDs.",
        "Create one accountable deliverable per worker and concrete acceptance criteria.",
        "Return JSON only: {\"workerAssignments\":[{\"agentId\":\"...\",\"title\":\"...\",\"brief\":\"...\",\"acceptanceCriteria\":[\"...\"]}]}"
      ].join("\n"),
      context: { route, workers }
    });
    const response = managerResponseSchema.parse(parseJsonObject(result.output));
    validateAssignments(state, route, response.workerAssignments);
    return {
      departmentPlans: {
        ...route,
        workerAssignments: response.workerAssignments
      }
    };
  };

  const finalize = (state: typeof CompanyState.State) => {
    if (state.departmentPlans.length !== state.routes.length) {
      throw new Error("Not every routed manager produced a department plan");
    }
    const workerCount = state.departmentPlans.reduce((sum, department) => sum + department.workerAssignments.length, 0);
    return {
      summary: `${state.departmentPlans.length} manager(s) assigned ${workerCount} specialist deliverable(s).`
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

export function companyPlanFromGraphState(state: typeof CompanyState.State): DepartmentPlan[] {
  const order = new Map(state.teams.map((team) => [team.id, team.sortOrder]));
  return departmentPlanSchema.array().parse(state.departmentPlans).toSorted(
    (left, right) => (order.get(left.teamId) ?? 0) - (order.get(right.teamId) ?? 0)
  );
}
