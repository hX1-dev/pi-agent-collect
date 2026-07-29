import type {
  AgentRuntimePort,
  AgentRuntimeRequest,
  AgentRuntimeResult
} from "../../application/orchestration/agent-runtime-port.js";

type JsonRecord = Record<string, unknown>;

const TEAM_KEYWORDS: Record<string, string[]> = {
  "team-social": ["social", "content", "audience", "channel", "post", "launch", "社媒", "内容", "发布", "增长"],
  "team-product": ["product", "code", "coding", "software", "system", "build", "api", "产品", "代码", "工程", "系统"],
  "team-life": ["life", "calendar", "travel", "health", "habit", "plan", "生活", "日程", "旅行", "健康", "习惯"]
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Mock runtime context is missing ${field}`);
  return value;
}

function routeResponse(request: AgentRuntimeRequest): unknown {
  const teams = records(request.context.teams);
  if (teams.length === 0) throw new Error("Mock CEO needs the durable team roster");

  const preferredTeamId = typeof request.context.preferredTeamId === "string"
    ? request.context.preferredTeamId
    : null;
  const text = request.brief.toLowerCase();
  const broadDirective = /(all departments|cross[- ]?company|company[- ]?wide|whole company|全公司|所有部门|全部部门|各部门|三个部门|跨部门)/i.test(text);
  let selected = preferredTeamId
    ? teams.filter((team) => team.id === preferredTeamId)
    : teams.filter((team) => (TEAM_KEYWORDS[string(team.id, "team.id")] ?? []).some((keyword) => text.includes(keyword)));

  if (!preferredTeamId && broadDirective) selected = teams;
  if (selected.length === 0) {
    selected = [teams.find((team) => team.id === "team-product") ?? teams[0]].filter(isRecord);
  }

  const title = request.brief.split("\n", 1)[0]?.trim() || "Board directive";
  return {
    departments: selected.slice(0, 3).map((team) => ({
      teamId: string(team.id, "team.id"),
      managerAgentId: string(team.leadAgentId, "team.leadAgentId"),
      missionTitle: `${string(team.name, "team.name")}: ${title}`.slice(0, 180),
      missionBrief: `Own the ${string(team.name, "team.name")} contribution to this board directive. Keep the plan small, assign accountable deliverables, and return evidence.`
    }))
  };
}

function planResponse(request: AgentRuntimeRequest): unknown {
  const workers = records(request.context.workers);
  if (workers.length === 0) throw new Error(`Mock manager ${request.agent.id} has no direct reports in context`);
  return {
    workerAssignments: workers.slice(0, 4).map((worker) => {
      const workerName = string(worker.name, "worker.name");
      const workerTitle = string(worker.title, "worker.title");
      return {
        agentId: string(worker.id, "worker.id"),
        title: `${workerTitle} deliverable`.slice(0, 180),
        brief: `${workerName} will produce the smallest useful ${workerTitle.toLowerCase()} contribution for “${request.brief.split("\n", 1)[0]}”.`,
        acceptanceCriteria: [
          "The result directly addresses the assigned department mission.",
          "Material claims include evidence or are marked as assumptions.",
          "No external action is executed."
        ]
      };
    })
  };
}

export class MockAgentRuntime implements AgentRuntimePort {
  async execute(request: AgentRuntimeRequest): Promise<AgentRuntimeResult> {
    let output: string;
    if (request.mode === "route") output = JSON.stringify(routeResponse(request));
    else if (request.mode === "plan") output = JSON.stringify(planResponse(request));
    else {
      output = `Mock ${request.mode} completed for ${request.agent.name}. No model API or external capability was used.`;
    }
    return {
      executionId: `mock:${request.idempotencyKey}`,
      output,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    };
  }
}
