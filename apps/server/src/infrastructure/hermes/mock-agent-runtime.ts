import type {
  AgentRuntimePort,
  AgentRuntimeRequest,
  AgentRuntimeResult
} from "../../application/orchestration/agent-runtime-port.js";

type JsonRecord = Record<string, unknown>;

const STUDIO_KEYWORDS: Record<string, string[]> = {
  "github-research": [
    "github", "repository", "repo", "research", "test", "code", "project",
    "仓库", "项目", "调研", "实测", "代码"
  ],
  "content-marketing": [
    "social", "content", "audience", "marketing", "script", "channel", "post",
    "社媒", "内容", "文案", "营销", "脚本", "发布"
  ],
  "video-production": [
    "video", "openmontage", "edit", "footage", "render", "colour", "color",
    "视频", "剪辑", "素材", "渲染", "调色"
  ]
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
  const studios = records(request.context.studios);
  if (studios.length === 0) throw new Error("Mock CEO needs the durable Studio registry");

  const preferredStudioId = typeof request.context.preferredStudioId === "string"
    ? request.context.preferredStudioId
    : null;
  const text = request.brief.toLowerCase();
  const broadDirective = /(all studios|all departments|cross[- ]?company|company[- ]?wide|whole company|全公司|所有工作室|全部工作室|各工作室|三个工作室|所有部门|三个部门|跨部门)/i.test(text);
  let selected = preferredStudioId
    ? studios.filter((studio) => studio.id === preferredStudioId)
    : studios.filter((studio) => (
      STUDIO_KEYWORDS[string(studio.key, "studio.key")] ?? []
    ).some((keyword) => text.includes(keyword)));

  if (!preferredStudioId && broadDirective) selected = studios;
  if (selected.length === 0) {
    selected = [
      studios.find((studio) => studio.key === "github-research") ?? studios[0]
    ].filter(isRecord);
  }

  const title = request.brief.split("\n", 1)[0]?.trim() || "Board directive";
  return {
    studios: selected.slice(0, 3).map((studio) => ({
      studioId: string(studio.id, "studio.id"),
      managerAgentId: string(studio.managerAgentId, "studio.managerAgentId"),
      missionTitle: `${string(studio.name, "studio.name")}: ${title}`.slice(0, 180),
      missionBrief: `Own the ${string(studio.name, "studio.name")} contribution to this board directive. Keep the plan small and return attributable evidence.`
    }))
  };
}

function planResponse(request: AgentRuntimeRequest): unknown {
  const studio = isRecord(request.context.studio) ? request.context.studio : null;
  if (!studio) throw new Error(`Mock manager ${request.agent.id} needs its Studio context`);
  const studioKey = string(studio.key, "studio.key");
  const sandboxed = studioKey === "github-research";
  const role = sandboxed ? "Repository verification worker" : "Production workflow worker";
  return {
    temporaryWorkers: [{
        key: sandboxed ? "repository-verification" : "production-workflow",
        kind: sandboxed ? "sandbox" : "workflow",
        role,
        title: `${role} deliverable`.slice(0, 180),
        brief: `Produce the smallest useful contribution for “${request.brief.split("\n", 1)[0]}” under the Studio manager's accountability.`,
        acceptanceCriteria: [
          "The result directly addresses the assigned Studio mission.",
          "Material claims include evidence or are marked as assumptions.",
          "No external action is executed."
        ]
      }]
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
