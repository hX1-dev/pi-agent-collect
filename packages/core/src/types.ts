export type Id = string;

export type AgentStatus =
  | "sleeping"
  | "queued"
  | "working"
  | "waiting"
  | "review"
  | "blocked";

export type TaskStatus =
  | "inbox"
  | "planned"
  | "queued"
  | "in_progress"
  | "review"
  | "awaiting_approval"
  | "done"
  | "blocked"
  | "failed"
  | "cancelled";

export type TaskPriority = "low" | "normal" | "high" | "critical";
export type RiskLevel = "green" | "yellow" | "red";
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type SandboxMode = "read-only" | "workspace-write";
export type AgentExecutionProvider = "hermes" | "codex" | "system";
export type RunProvider = "hermes" | "codex" | "mock";
export type OrchestrationStatus = "running" | "completed" | "failed";

export interface Company {
  id: Id;
  name: string;
  mission: string;
  ownerTitle: string;
  createdAt: string;
}

export interface Team {
  id: Id;
  companyId: Id;
  name: string;
  purpose: string;
  color: string;
  leadAgentId: Id;
  sortOrder: number;
}

export interface Agent {
  id: Id;
  companyId: Id;
  teamId: Id | null;
  managerAgentId: Id | null;
  name: string;
  title: string;
  initials: string;
  accent: string;
  role: string;
  responsibilities: string[];
  status: AgentStatus;
  executionProvider: AgentExecutionProvider;
  runtimeProfile: string | null;
  sandbox: SandboxMode;
  workspacePath: string | null;
  currentTaskId: Id | null;
  lastActiveAt: string | null;
}

export interface Goal {
  id: Id;
  companyId: Id;
  teamId: Id | null;
  title: string;
  description: string;
  status: "active" | "paused" | "complete";
  createdAt: string;
}

export interface Task {
  id: Id;
  companyId: Id;
  studioId: Id | null;
  teamId: Id | null;
  goalId: Id | null;
  parentTaskId: Id | null;
  ownerAgentId: Id | null;
  reviewerAgentId: Id | null;
  title: string;
  brief: string;
  status: TaskStatus;
  priority: TaskPriority;
  risk: RiskLevel;
  progress: number;
  createdAt: string;
  updatedAt: string;
  dueAt: string | null;
  completedAt: string | null;
}

export interface Run {
  id: Id;
  taskId: Id;
  agentId: Id;
  provider: RunProvider;
  providerThreadId: string | null;
  status: RunStatus;
  summary: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export type TemporaryWorkerKind = "workflow" | "subagent" | "sandbox";

/**
 * A temporary worker is a Run-scoped execution description, not a durable
 * Agent identity. The Studio manager remains accountable for its work.
 */
export interface TemporaryWorkerPlan {
  key: string;
  kind: TemporaryWorkerKind;
  role: string;
  title: string;
  brief: string;
  acceptanceCriteria: string[];
}

export interface StudioMissionPlan {
  studioId: Id;
  managerAgentId: Id;
  missionTitle: string;
  missionBrief: string;
  temporaryWorkers: TemporaryWorkerPlan[];
}

export interface StudioCompanyPlan {
  planningModel: "studio-v1";
  orchestrationId: Id;
  rootTaskId: Id;
  studios: StudioMissionPlan[];
  summary: string;
}

/**
 * Historical plans stay readable after the Studio migration. New
 * orchestrations must never create this shape.
 */
export interface LegacyWorkerAssignment {
  agentId: Id;
  title: string;
  brief: string;
  acceptanceCriteria: string[];
}

export interface LegacyDepartmentPlan {
  teamId: Id;
  managerAgentId: Id;
  missionTitle: string;
  missionBrief: string;
  workerAssignments: LegacyWorkerAssignment[];
}

export interface LegacyCompanyPlan {
  planningModel: "legacy-team-v1";
  orchestrationId: Id;
  rootTaskId: Id;
  departments: LegacyDepartmentPlan[];
  summary: string;
}

export type CompanyPlan = StudioCompanyPlan | LegacyCompanyPlan;

export interface OrchestrationRun {
  id: Id;
  rootTaskId: Id;
  graphName: string;
  graphVersion: string;
  langgraphThreadId: string;
  status: OrchestrationStatus;
  plan: CompanyPlan | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityEvent {
  id: Id;
  companyId: Id;
  studioId: Id | null;
  studioInstanceId: Id | null;
  taskId: Id | null;
  runId: Id | null;
  agentId: Id | null;
  type: string;
  summary: string;
  detail: string | null;
  createdAt: string;
}

export interface Approval {
  id: Id;
  companyId: Id;
  taskId: Id;
  requestedByAgentId: Id;
  type: "external_publish" | "message_send" | "calendar_write" | "payment" | "destructive_action";
  title: string;
  rationale: string;
  impact: string;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt: string | null;
}

export interface UsageSummary {
  source: "chatgpt" | "api" | "unknown";
  windowLabel: string;
  estimatedPercentUsed: number | null;
  activeRuns: number;
  maxConcurrency: number;
  taskTokensToday: number;
}

export interface DashboardSnapshot {
  company: Company;
  studios: import("./studio.js").StudioOperationalSnapshot[];
  teams: Team[];
  agents: Agent[];
  goals: Goal[];
  tasks: Task[];
  runs: Run[];
  orchestrations: OrchestrationRun[];
  approvals: Approval[];
  activity: ActivityEvent[];
  usage: UsageSummary;
  brief: {
    headline: string;
    summary: string;
    wins: string[];
    attention: string[];
  };
}

export interface CreateDirectiveInput {
  title: string;
  brief: string;
  studioId?: Id | null;
  /** @deprecated Compatibility input for the pre-Studio UI and old clients. */
  teamId?: Id | null;
  priority?: TaskPriority;
  risk?: RiskLevel;
}
