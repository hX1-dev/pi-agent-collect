import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  assertTaskTransition,
  type ActivityEvent,
  type Agent,
  type Approval,
  type ApprovalStatus,
  type Company,
  type CompanyPlan,
  type CreateDirectiveInput,
  type DashboardSnapshot,
  type Goal,
  type OrchestrationRun,
  type RiskLevel,
  type Run,
  type RunStatus,
  type Task,
  type TaskStatus,
  type Team,
  type UsageSummary
} from "@private-ai-org/core";

type Row = Record<string, string | number | null>;
type DatabaseValue = string | number | null | undefined;

const now = () => new Date().toISOString();

function asString(value: DatabaseValue): string {
  if (typeof value !== "string") throw new Error("Expected a string database value");
  return value;
}

function asNullableString(value: DatabaseValue): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: DatabaseValue): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function parseJsonArray(value: DatabaseValue): string[] {
  try {
    const parsed: unknown = JSON.parse(typeof value === "string" ? value : "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseCompanyPlan(value: DatabaseValue): CompanyPlan | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as Partial<CompanyPlan>;
    if (
      typeof parsed.orchestrationId !== "string"
      || typeof parsed.rootTaskId !== "string"
      || typeof parsed.summary !== "string"
      || !Array.isArray(parsed.departments)
    ) return null;
    return parsed as CompanyPlan;
  } catch {
    return null;
  }
}

export interface RepositoryOptions {
  databasePath: string;
  maxConcurrency: number;
  usageSource: UsageSummary["source"];
}

export class OrganizationRepository {
  private readonly db: DatabaseSync;
  private readonly maxConcurrency: number;
  private readonly usageSource: UsageSummary["source"];

  constructor(options: RepositoryOptions) {
    if (options.databasePath !== ":memory:") {
      mkdirSync(path.dirname(options.databasePath), { recursive: true });
    }
    this.db = new DatabaseSync(options.databasePath);
    this.maxConcurrency = options.maxConcurrency;
    this.usageSource = options.usageSource;
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
    this.seed();
    this.ensureDefaultRoster();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS companies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        mission TEXT NOT NULL,
        owner_title TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id),
        name TEXT NOT NULL,
        purpose TEXT NOT NULL,
        color TEXT NOT NULL,
        lead_agent_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id),
        team_id TEXT REFERENCES teams(id),
        manager_agent_id TEXT REFERENCES agents(id),
        name TEXT NOT NULL,
        title TEXT NOT NULL,
        initials TEXT NOT NULL,
        accent TEXT NOT NULL,
        role TEXT NOT NULL,
        responsibilities_json TEXT NOT NULL,
        status TEXT NOT NULL,
        execution_provider TEXT NOT NULL,
        runtime_profile TEXT,
        sandbox TEXT NOT NULL,
        workspace_path TEXT,
        current_task_id TEXT,
        last_active_at TEXT
      );

      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id),
        team_id TEXT REFERENCES teams(id),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id),
        team_id TEXT REFERENCES teams(id),
        goal_id TEXT REFERENCES goals(id),
        parent_task_id TEXT REFERENCES tasks(id),
        owner_agent_id TEXT REFERENCES agents(id),
        reviewer_agent_id TEXT REFERENCES agents(id),
        title TEXT NOT NULL,
        brief TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        risk TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        due_at TEXT,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        agent_id TEXT NOT NULL REFERENCES agents(id),
        provider TEXT NOT NULL,
        provider_thread_id TEXT,
        status TEXT NOT NULL,
        summary TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id),
        task_id TEXT NOT NULL REFERENCES tasks(id),
        requested_by_agent_id TEXT NOT NULL REFERENCES agents(id),
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        rationale TEXT NOT NULL,
        impact TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );

      CREATE TABLE IF NOT EXISTS orchestration_runs (
        id TEXT PRIMARY KEY,
        root_task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
        graph_name TEXT NOT NULL,
        graph_version TEXT NOT NULL,
        langgraph_thread_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        plan_json TEXT,
        summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS board_chat_directives (
        thread_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
        created_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, message_id)
      );

      CREATE TABLE IF NOT EXISTS activity_events (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id),
        task_id TEXT REFERENCES tasks(id),
        run_id TEXT REFERENCES runs(id),
        agent_id TEXT REFERENCES agents(id),
        type TEXT NOT NULL,
        summary TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orchestrations_status ON orchestration_runs(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_board_chat_task ON board_chat_directives(task_id);
      CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_events(created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_active_run_per_task
        ON runs(task_id) WHERE status IN ('queued', 'running');
      CREATE UNIQUE INDEX IF NOT EXISTS idx_active_run_per_agent
        ON runs(agent_id) WHERE status IN ('queued', 'running');
      CREATE UNIQUE INDEX IF NOT EXISTS idx_active_approval_per_task
        ON approvals(task_id) WHERE status = 'pending';
    `);

    const agentColumns = this.db.prepare("PRAGMA table_info(agents)").all() as Row[];
    if (!agentColumns.some((column) => column.name === "runtime_profile")) {
      this.db.exec("ALTER TABLE agents ADD COLUMN runtime_profile TEXT");
    }
    const boardChatColumns = this.db.prepare("PRAGMA table_info(board_chat_directives)").all() as Row[];
    if (!boardChatColumns.some((column) => column.name === "request_hash")) {
      this.db.exec("ALTER TABLE board_chat_directives ADD COLUMN request_hash TEXT");
    }
  }

  private seed(): void {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM companies").get() as Row;
    if (asNumber(row.count) > 0) return;

    const createdAt = now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
    const insertCompany = this.db.prepare(
      "INSERT INTO companies (id, name, mission, owner_title, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    insertCompany.run(
      "company-northstar",
      "Northstar House",
      "Build a calm, capable private organization that turns the board's intentions into finished work.",
      "Board Director",
      createdAt
    );

    const teams: Team[] = [
      {
        id: "team-social",
        companyId: "company-northstar",
        name: "Social Studio",
        purpose: "Grow a thoughtful public presence through research, writing, publishing, and learning.",
        color: "#d96d4a",
        leadAgentId: "agent-mira",
        sortOrder: 1
      },
      {
        id: "team-product",
        companyId: "company-northstar",
        name: "Product Lab",
        purpose: "Turn useful ideas into reliable software, systems, and experiments.",
        color: "#507b71",
        leadAgentId: "agent-kai",
        sortOrder: 2
      },
      {
        id: "team-life",
        companyId: "company-northstar",
        name: "Life Office",
        purpose: "Protect time, energy, commitments, and the quality of everyday life.",
        color: "#6a6f9b",
        leadAgentId: "agent-rowan",
        sortOrder: 3
      }
    ];
    const insertTeam = this.db.prepare(
      "INSERT INTO teams (id, company_id, name, purpose, color, lead_agent_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    for (const team of teams) {
      insertTeam.run(team.id, team.companyId, team.name, team.purpose, team.color, team.leadAgentId, team.sortOrder);
    }

    const agents: Agent[] = [
      {
        id: "agent-avery",
        companyId: "company-northstar",
        teamId: null,
        managerAgentId: null,
        name: "Avery",
        title: "Chief of Staff",
        initials: "AV",
        accent: "#263a37",
        role: "Translate board intent into the smallest effective execution structure and report only decisions that need board attention.",
        responsibilities: ["Portfolio priorities", "Cross-team routing", "Board brief", "Escalations"],
        status: "sleeping",
        executionProvider: "hermes",
        runtimeProfile: "ceo",
        sandbox: "read-only",
        workspacePath: null,
        currentTaskId: null,
        lastActiveAt: createdAt
      },
      {
        id: "agent-mira",
        companyId: "company-northstar",
        teamId: "team-social",
        managerAgentId: "agent-avery",
        name: "Mira",
        title: "Social Lead",
        initials: "MI",
        accent: "#d96d4a",
        role: "Own the social strategy, commission evidence-backed work, and protect the board's voice.",
        responsibilities: ["Content strategy", "Editorial review", "Channel priorities"],
        status: "working",
        executionProvider: "hermes",
        runtimeProfile: "social-manager",
        sandbox: "workspace-write",
        workspacePath: null,
        currentTaskId: "task-social-calendar",
        lastActiveAt: createdAt
      },
      {
        id: "agent-iris",
        companyId: "company-northstar",
        teamId: "team-social",
        managerAgentId: "agent-mira",
        name: "Iris",
        title: "Audience Researcher",
        initials: "IR",
        accent: "#e49a67",
        role: "Find useful signals, verify sources, and turn them into concise research notes.",
        responsibilities: ["Trend research", "Source verification", "Audience insight"],
        status: "sleeping",
        executionProvider: "hermes",
        runtimeProfile: "audience-researcher",
        sandbox: "read-only",
        workspacePath: null,
        currentTaskId: null,
        lastActiveAt: null
      },
      {
        id: "agent-theo",
        companyId: "company-northstar",
        teamId: "team-social",
        managerAgentId: "agent-mira",
        name: "Theo",
        title: "Content Maker",
        initials: "TH",
        accent: "#c9835f",
        role: "Turn approved insight into clear, human drafts without publishing autonomously.",
        responsibilities: ["Drafting", "Repurposing", "Editorial polish"],
        status: "review",
        executionProvider: "hermes",
        runtimeProfile: "content-maker",
        sandbox: "workspace-write",
        workspacePath: null,
        currentTaskId: "task-founder-note",
        lastActiveAt: createdAt
      },
      {
        id: "agent-lyra",
        companyId: "company-northstar",
        teamId: "team-social",
        managerAgentId: "agent-mira",
        name: "Lyra",
        title: "Channel Producer",
        initials: "LY",
        accent: "#b56f57",
        role: "Turn approved concepts into channel-ready visual and production briefs without publishing them.",
        responsibilities: ["Visual briefs", "Channel packaging", "Asset coordination"],
        status: "sleeping",
        executionProvider: "hermes",
        runtimeProfile: "channel-producer",
        sandbox: "workspace-write",
        workspacePath: null,
        currentTaskId: null,
        lastActiveAt: null
      },
      {
        id: "agent-sage",
        companyId: "company-northstar",
        teamId: "team-social",
        managerAgentId: "agent-mira",
        name: "Sage",
        title: "Growth Analyst",
        initials: "SA",
        accent: "#a65e47",
        role: "Measure content outcomes, explain the signal behind the numbers, and recommend bounded experiments.",
        responsibilities: ["Performance analysis", "Experiment design", "Learning reports"],
        status: "sleeping",
        executionProvider: "hermes",
        runtimeProfile: "growth-analyst",
        sandbox: "read-only",
        workspacePath: null,
        currentTaskId: null,
        lastActiveAt: null
      },
      {
        id: "agent-kai",
        companyId: "company-northstar",
        teamId: "team-product",
        managerAgentId: "agent-avery",
        name: "Kai",
        title: "Product Lead",
        initials: "KA",
        accent: "#507b71",
        role: "Own product outcomes and choose the shallowest reliable path from idea to tested artifact.",
        responsibilities: ["Product planning", "Technical direction", "Delivery review"],
        status: "sleeping",
        executionProvider: "hermes",
        runtimeProfile: "engineering-manager",
        sandbox: "workspace-write",
        workspacePath: null,
        currentTaskId: null,
        lastActiveAt: null
      },
      {
        id: "agent-nova",
        companyId: "company-northstar",
        teamId: "team-product",
        managerAgentId: "agent-kai",
        name: "Nova",
        title: "Codex Engineer",
        initials: "NO",
        accent: "#72a195",
        role: "Implement scoped changes, run verification, and leave the workspace in a reviewable state.",
        responsibilities: ["Implementation", "Testing", "Technical documentation"],
        status: "queued",
        executionProvider: "hermes",
        runtimeProfile: "codex-engineer",
        sandbox: "workspace-write",
        workspacePath: null,
        currentTaskId: "task-org-mvp",
        lastActiveAt: createdAt
      },
      {
        id: "agent-atlas",
        companyId: "company-northstar",
        teamId: "team-product",
        managerAgentId: "agent-kai",
        name: "Atlas",
        title: "Systems Architect",
        initials: "AT",
        accent: "#3f6c65",
        role: "Shape small, durable technical boundaries and surface tradeoffs before implementation begins.",
        responsibilities: ["Architecture", "Interface design", "Technical risk"],
        status: "sleeping",
        executionProvider: "hermes",
        runtimeProfile: "systems-architect",
        sandbox: "read-only",
        workspacePath: null,
        currentTaskId: null,
        lastActiveAt: null
      },
      {
        id: "agent-tess",
        companyId: "company-northstar",
        teamId: "team-product",
        managerAgentId: "agent-kai",
        name: "Tess",
        title: "Test Engineer",
        initials: "TE",
        accent: "#5c8e83",
        role: "Design verification, reproduce failures, and report evidence without hiding uncertainty.",
        responsibilities: ["Test design", "Regression checks", "Release evidence"],
        status: "sleeping",
        executionProvider: "hermes",
        runtimeProfile: "test-engineer",
        sandbox: "workspace-write",
        workspacePath: null,
        currentTaskId: null,
        lastActiveAt: null
      },
      {
        id: "agent-rowan",
        companyId: "company-northstar",
        teamId: "team-life",
        managerAgentId: "agent-avery",
        name: "Rowan",
        title: "Life Manager",
        initials: "RO",
        accent: "#6a6f9b",
        role: "Protect the board's attention by maintaining realistic plans and surfacing conflicts early.",
        responsibilities: ["Weekly planning", "Calendar proposals", "Personal operations"],
        status: "waiting",
        executionProvider: "hermes",
        runtimeProfile: "life-manager",
        sandbox: "read-only",
        workspacePath: null,
        currentTaskId: "task-week-plan",
        lastActiveAt: createdAt
      },
      {
        id: "agent-june",
        companyId: "company-northstar",
        teamId: "team-life",
        managerAgentId: "agent-rowan",
        name: "June",
        title: "Planning Coordinator",
        initials: "JU",
        accent: "#7c80aa",
        role: "Turn priorities into realistic schedule proposals while protecting focus and recovery time.",
        responsibilities: ["Priority planning", "Schedule proposals", "Conflict detection"],
        status: "sleeping",
        executionProvider: "hermes",
        runtimeProfile: "planning-coordinator",
        sandbox: "read-only",
        workspacePath: null,
        currentTaskId: null,
        lastActiveAt: null
      },
      {
        id: "agent-sol",
        companyId: "company-northstar",
        teamId: "team-life",
        managerAgentId: "agent-rowan",
        name: "Sol",
        title: "Travel and Purchasing Researcher",
        initials: "SO",
        accent: "#868bb7",
        role: "Research travel and purchasing options with explicit constraints, sources, and no autonomous checkout.",
        responsibilities: ["Travel research", "Purchase comparisons", "Constraint tracking"],
        status: "sleeping",
        executionProvider: "hermes",
        runtimeProfile: "travel-researcher",
        sandbox: "read-only",
        workspacePath: null,
        currentTaskId: null,
        lastActiveAt: null
      },
      {
        id: "agent-vale",
        companyId: "company-northstar",
        teamId: "team-life",
        managerAgentId: "agent-rowan",
        name: "Vale",
        title: "Health and Habits Assistant",
        initials: "VA",
        accent: "#7479a3",
        role: "Support sustainable habits and preparation while escalating medical decisions to qualified humans.",
        responsibilities: ["Habit tracking", "Routine proposals", "Wellbeing research"],
        status: "sleeping",
        executionProvider: "hermes",
        runtimeProfile: "health-habits",
        sandbox: "read-only",
        workspacePath: null,
        currentTaskId: null,
        lastActiveAt: null
      },
      {
        id: "agent-morgan",
        companyId: "company-northstar",
        teamId: "team-life",
        managerAgentId: "agent-rowan",
        name: "Morgan",
        title: "Personal Knowledge Steward",
        initials: "MO",
        accent: "#62678f",
        role: "Keep personal knowledge and administrative material organized, searchable, and sensitivity-scoped.",
        responsibilities: ["Knowledge organization", "Administrative briefs", "Record hygiene"],
        status: "sleeping",
        executionProvider: "hermes",
        runtimeProfile: "knowledge-steward",
        sandbox: "read-only",
        workspacePath: null,
        currentTaskId: null,
        lastActiveAt: null
      },
      {
        id: "agent-quinn",
        companyId: "company-northstar",
        teamId: "team-product",
        managerAgentId: "agent-kai",
        name: "Quinn",
        title: "Independent Reviewer",
        initials: "QU",
        accent: "#8f7656",
        role: "Review important work independently for evidence, risk, and unintended consequences.",
        responsibilities: ["Quality review", "Risk review", "Approval evidence"],
        status: "sleeping",
        executionProvider: "hermes",
        runtimeProfile: "quality-reviewer",
        sandbox: "read-only",
        workspacePath: null,
        currentTaskId: null,
        lastActiveAt: null
      }
    ];
    const insertAgent = this.db.prepare(`
      INSERT INTO agents (
        id, company_id, team_id, manager_agent_id, name, title, initials, accent, role,
        responsibilities_json, status, execution_provider, runtime_profile, sandbox, workspace_path,
        current_task_id, last_active_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const agent of agents) {
      insertAgent.run(
        agent.id,
        agent.companyId,
        agent.teamId,
        agent.managerAgentId,
        agent.name,
        agent.title,
        agent.initials,
        agent.accent,
        agent.role,
        JSON.stringify(agent.responsibilities),
        agent.status,
        agent.executionProvider,
        agent.runtimeProfile,
        agent.sandbox,
        agent.workspacePath,
        agent.currentTaskId,
        agent.lastActiveAt
      );
    }

    const goals: Goal[] = [
      {
        id: "goal-social-system",
        companyId: "company-northstar",
        teamId: "team-social",
        title: "Establish a sustainable public voice",
        description: "Publish useful, evidence-backed work without turning the board into a full-time editor.",
        status: "active",
        createdAt
      },
      {
        id: "goal-org-mvp",
        companyId: "company-northstar",
        teamId: "team-product",
        title: "Launch the private organization MVP",
        description: "Make the organization visible, governable, local-first, and ready to use Codex safely.",
        status: "active",
        createdAt
      },
      {
        id: "goal-weekly-rhythm",
        companyId: "company-northstar",
        teamId: "team-life",
        title: "Create a calmer weekly rhythm",
        description: "Surface conflicts and prepare realistic plans before the week becomes reactive.",
        status: "active",
        createdAt
      }
    ];
    const insertGoal = this.db.prepare(
      "INSERT INTO goals (id, company_id, team_id, title, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    for (const goal of goals) {
      insertGoal.run(goal.id, goal.companyId, goal.teamId, goal.title, goal.description, goal.status, goal.createdAt);
    }

    const tasks: Task[] = [
      {
        id: "task-social-calendar",
        companyId: "company-northstar",
        teamId: "team-social",
        goalId: "goal-social-system",
        parentTaskId: null,
        ownerAgentId: "agent-mira",
        reviewerAgentId: "agent-quinn",
        title: "Shape next week's editorial direction",
        brief: "Prepare a focused set of themes and explain why each deserves the board's attention.",
        status: "in_progress",
        priority: "high",
        risk: "yellow",
        progress: 64,
        createdAt,
        updatedAt: createdAt,
        dueAt: null,
        completedAt: null
      },
      {
        id: "task-founder-note",
        companyId: "company-northstar",
        teamId: "team-social",
        goalId: "goal-social-system",
        parentTaskId: "task-social-calendar",
        ownerAgentId: "agent-theo",
        reviewerAgentId: "agent-mira",
        title: "Draft the AI organization founder note",
        brief: "Explain the idea in a grounded voice and avoid making claims that have not been tested.",
        status: "review",
        priority: "normal",
        risk: "red",
        progress: 88,
        createdAt,
        updatedAt: createdAt,
        dueAt: null,
        completedAt: null
      },
      {
        id: "task-org-mvp",
        companyId: "company-northstar",
        teamId: "team-product",
        goalId: "goal-org-mvp",
        parentTaskId: null,
        ownerAgentId: "agent-nova",
        reviewerAgentId: "agent-kai",
        title: "Build the organization control plane",
        brief: "Implement the local organization, task, approval, and Codex broker boundaries.",
        status: "queued",
        priority: "critical",
        risk: "yellow",
        progress: 20,
        createdAt,
        updatedAt: createdAt,
        dueAt: null,
        completedAt: null
      },
      {
        id: "task-week-plan",
        companyId: "company-northstar",
        teamId: "team-life",
        goalId: "goal-weekly-rhythm",
        parentTaskId: null,
        ownerAgentId: "agent-rowan",
        reviewerAgentId: null,
        title: "Prepare the next weekly planning brief",
        brief: "Produce a proposal only. Do not write to external calendars without board approval.",
        status: "blocked",
        priority: "normal",
        risk: "yellow",
        progress: 35,
        createdAt,
        updatedAt: createdAt,
        dueAt: null,
        completedAt: null
      }
    ];
    const insertTask = this.db.prepare(`
      INSERT INTO tasks (
        id, company_id, team_id, goal_id, parent_task_id, owner_agent_id, reviewer_agent_id,
        title, brief, status, priority, risk, progress, created_at, updated_at, due_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const task of tasks) {
      insertTask.run(
        task.id,
        task.companyId,
        task.teamId,
        task.goalId,
        task.parentTaskId,
        task.ownerAgentId,
        task.reviewerAgentId,
        task.title,
        task.brief,
        task.status,
        task.priority,
        task.risk,
        task.progress,
        task.createdAt,
        task.updatedAt,
        task.dueAt,
        task.completedAt
      );
    }

    this.db.prepare(`
      INSERT INTO approvals (
        id, company_id, task_id, requested_by_agent_id, type, title, rationale,
        impact, status, created_at, decided_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "approval-founder-note",
      "company-northstar",
      "task-founder-note",
      "agent-mira",
      "external_publish",
      "Approve the founder note for publication",
      "The draft has passed editorial review and is ready for the board's voice check.",
      "Publishes externally under the board's identity.",
      "pending",
      createdAt,
      null
    );

    const events: Array<[string, string | null, string | null, string | null, string, string, string | null]> = [
      ["event-1", "task-org-mvp", null, "agent-nova", "task.queued", "Nova is queued to build the organization control plane.", null],
      ["event-2", "task-social-calendar", null, "agent-mira", "task.progress", "Mira narrowed next week's editorial direction to three themes.", "Research evidence is being consolidated for review."],
      ["event-3", "task-founder-note", null, "agent-mira", "approval.requested", "The founder note is waiting for a board decision.", "No external publication can occur before approval."],
      ["event-4", "task-week-plan", null, "agent-rowan", "task.blocked", "Rowan needs the board's preferred protected time before finalizing the week.", null]
    ];
    const insertEvent = this.db.prepare(`
      INSERT INTO activity_events (
        id, company_id, task_id, run_id, agent_id, type, summary, detail, created_at
      ) VALUES (?, 'company-northstar', ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [id, taskId, runId, agentId, type, summary, detail] of events) {
      insertEvent.run(id, taskId, runId, agentId, type, summary, detail, createdAt);
    }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private ensureDefaultRoster(): void {
    const createdAt = now();
    const additions: Agent[] = [
      this.rosterAgent("agent-lyra", "team-social", "agent-mira", "Lyra", "Channel Producer", "LY", "#b56f57", "channel-producer", "Turn approved concepts into channel-ready visual and production briefs without publishing them.", ["Visual briefs", "Channel packaging", "Asset coordination"], "workspace-write"),
      this.rosterAgent("agent-sage", "team-social", "agent-mira", "Sage", "Growth Analyst", "SA", "#a65e47", "growth-analyst", "Measure content outcomes, explain the signal behind the numbers, and recommend bounded experiments.", ["Performance analysis", "Experiment design", "Learning reports"], "read-only"),
      this.rosterAgent("agent-atlas", "team-product", "agent-kai", "Atlas", "Systems Architect", "AT", "#3f6c65", "systems-architect", "Shape small, durable technical boundaries and surface tradeoffs before implementation begins.", ["Architecture", "Interface design", "Technical risk"], "read-only"),
      this.rosterAgent("agent-tess", "team-product", "agent-kai", "Tess", "Test Engineer", "TE", "#5c8e83", "test-engineer", "Design verification, reproduce failures, and report evidence without hiding uncertainty.", ["Test design", "Regression checks", "Release evidence"], "workspace-write"),
      this.rosterAgent("agent-june", "team-life", "agent-rowan", "June", "Planning Coordinator", "JU", "#7c80aa", "planning-coordinator", "Turn priorities into realistic schedule proposals while protecting focus and recovery time.", ["Priority planning", "Schedule proposals", "Conflict detection"], "read-only"),
      this.rosterAgent("agent-sol", "team-life", "agent-rowan", "Sol", "Travel and Purchasing Researcher", "SO", "#868bb7", "travel-researcher", "Research travel and purchasing options with explicit constraints, sources, and no autonomous checkout.", ["Travel research", "Purchase comparisons", "Constraint tracking"], "read-only"),
      this.rosterAgent("agent-vale", "team-life", "agent-rowan", "Vale", "Health and Habits Assistant", "VA", "#7479a3", "health-habits", "Support sustainable habits and preparation while escalating medical decisions to qualified humans.", ["Habit tracking", "Routine proposals", "Wellbeing research"], "read-only"),
      this.rosterAgent("agent-morgan", "team-life", "agent-rowan", "Morgan", "Personal Knowledge Steward", "MO", "#62678f", "knowledge-steward", "Keep personal knowledge and administrative material organized, searchable, and sensitivity-scoped.", ["Knowledge organization", "Administrative briefs", "Record hygiene"], "read-only")
    ];
    const profileByAgentId = new Map<string, string>([
      ["agent-avery", "ceo"],
      ["agent-mira", "social-manager"],
      ["agent-iris", "audience-researcher"],
      ["agent-theo", "content-maker"],
      ["agent-lyra", "channel-producer"],
      ["agent-sage", "growth-analyst"],
      ["agent-kai", "engineering-manager"],
      ["agent-nova", "codex-engineer"],
      ["agent-atlas", "systems-architect"],
      ["agent-tess", "test-engineer"],
      ["agent-quinn", "quality-reviewer"],
      ["agent-rowan", "life-manager"],
      ["agent-june", "planning-coordinator"],
      ["agent-sol", "travel-researcher"],
      ["agent-vale", "health-habits"],
      ["agent-morgan", "knowledge-steward"]
    ]);
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO agents (
        id, company_id, team_id, manager_agent_id, name, title, initials, accent, role,
        responsibilities_json, status, execution_provider, runtime_profile, sandbox,
        workspace_path, current_task_id, last_active_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateRuntime = this.db.prepare(`
      UPDATE agents
      SET runtime_profile = COALESCE(runtime_profile, ?),
          execution_provider = CASE WHEN execution_provider = 'codex' THEN 'hermes' ELSE execution_provider END
      WHERE id = ? AND company_id = 'company-northstar'
    `);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const agent of additions) {
        insert.run(
          agent.id, agent.companyId, agent.teamId, agent.managerAgentId, agent.name,
          agent.title, agent.initials, agent.accent, agent.role,
          JSON.stringify(agent.responsibilities), agent.status, agent.executionProvider,
          agent.runtimeProfile, agent.sandbox, agent.workspacePath, agent.currentTaskId,
          agent.lastActiveAt ?? createdAt
        );
      }
      for (const [agentId, profile] of profileByAgentId) updateRuntime.run(profile, agentId);
      this.db.prepare(`
        UPDATE agents SET team_id = 'team-product', manager_agent_id = 'agent-kai'
        WHERE id = 'agent-quinn' AND team_id IS NULL AND manager_agent_id = 'agent-avery'
      `).run();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private rosterAgent(
    id: string,
    teamId: string,
    managerAgentId: string,
    name: string,
    title: string,
    initials: string,
    accent: string,
    runtimeProfile: string,
    role: string,
    responsibilities: string[],
    sandbox: Agent["sandbox"]
  ): Agent {
    return {
      id,
      companyId: "company-northstar",
      teamId,
      managerAgentId,
      name,
      title,
      initials,
      accent,
      role,
      responsibilities,
      status: "sleeping",
      executionProvider: "hermes",
      runtimeProfile,
      sandbox,
      workspacePath: null,
      currentTaskId: null,
      lastActiveAt: null
    };
  }

  getDashboard(): DashboardSnapshot {
    const companyRow = this.db.prepare("SELECT * FROM companies LIMIT 1").get() as Row | undefined;
    if (!companyRow) throw new Error("Organization is not initialized");
    const company = this.mapCompany(companyRow);
    const teams = (this.db.prepare("SELECT * FROM teams ORDER BY sort_order").all() as Row[]).map((row) => this.mapTeam(row));
    const agents = (this.db.prepare("SELECT * FROM agents ORDER BY name").all() as Row[]).map((row) => this.mapAgent(row));
    const goals = (this.db.prepare("SELECT * FROM goals WHERE status = 'active' ORDER BY created_at DESC").all() as Row[]).map((row) => this.mapGoal(row));
    const tasks = (this.db.prepare("SELECT * FROM tasks ORDER BY updated_at DESC").all() as Row[]).map((row) => this.mapTask(row));
    const runs = (this.db.prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT 20").all() as Row[]).map((row) => this.mapRun(row));
    const orchestrations = (this.db.prepare("SELECT * FROM orchestration_runs ORDER BY updated_at DESC LIMIT 20").all() as Row[]).map((row) => this.mapOrchestration(row));
    const approvals = (this.db.prepare("SELECT * FROM approvals ORDER BY created_at DESC").all() as Row[]).map((row) => this.mapApproval(row));
    const activity = (this.db.prepare("SELECT * FROM activity_events ORDER BY created_at DESC LIMIT 30").all() as Row[]).map((row) => this.mapActivity(row));
    const usageRow = this.db.prepare(`
      SELECT
        (SELECT COALESCE(SUM(input_tokens + output_tokens), 0)
          FROM runs WHERE date(created_at) = date('now')) AS tokens,
        (SELECT COUNT(*) FROM runs WHERE status = 'running') AS active_runs
    `).get() as Row;
    const activeTasks = tasks.filter((task) => ["queued", "in_progress", "review", "blocked"].includes(task.status));
    const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
    const blockedTasks = tasks.filter((task) => task.status === "blocked");

    return {
      company,
      teams,
      agents,
      goals,
      tasks,
      runs,
      orchestrations,
      approvals,
      activity,
      usage: {
        source: this.usageSource,
        windowLabel: "Locally tracked usage",
        estimatedPercentUsed: null,
        activeRuns: asNumber(usageRow.active_runs),
        maxConcurrency: this.maxConcurrency,
        taskTokensToday: asNumber(usageRow.tokens)
      },
      brief: {
        headline: "The organization is formed. The next step is to turn directives into verified work.",
        summary: `${activeTasks.length} active items across ${teams.length} teams. ${pendingApprovals.length} decision requires board attention.`,
        wins: [
          "Permanent roles and reporting lines are defined",
          "All model work will pass through one controlled broker",
          "External actions are separated from internal drafting"
        ],
        attention: blockedTasks.length > 0
          ? blockedTasks.map((task) => task.title)
          : ["No blocked work"]
      }
    };
  }

  getOrchestrationForTask(rootTaskId: string): OrchestrationRun | null {
    const row = this.db.prepare("SELECT * FROM orchestration_runs WHERE root_task_id = ?").get(rootTaskId) as Row | undefined;
    return row ? this.mapOrchestration(row) : null;
  }

  createOrchestration(rootTaskId: string, graphName: string, graphVersion: string): OrchestrationRun {
    const task = this.getTask(rootTaskId);
    if (task.parentTaskId) throw new Error("Only a root board directive can start company orchestration");
    const existing = this.getOrchestrationForTask(rootTaskId);
    if (existing) return existing;

    const id = randomUUID();
    const createdAt = now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO orchestration_runs (
          id, root_task_id, graph_name, graph_version, langgraph_thread_id,
          status, plan_json, summary, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'running', NULL, NULL, ?, ?)
      `).run(id, rootTaskId, graphName, graphVersion, `orchestration:${id}`, createdAt, createdAt);
      this.insertActivity({
        taskId: rootTaskId,
        runId: null,
        agentId: task.ownerAgentId,
        type: "orchestration.started",
        summary: `Company orchestration started for “${task.title}”.`,
        detail: `${graphName}@${graphVersion}`
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getOrchestrationForTask(rootTaskId) as OrchestrationRun;
  }

  completeOrchestration(orchestrationId: string, plan: CompanyPlan): Task[] {
    const orchestration = this.getOrchestration(orchestrationId);
    if (orchestration.status === "completed") {
      return this.listDescendantTasks(orchestration.rootTaskId);
    }
    if (orchestration.status !== "running") throw new Error("Only a running orchestration can complete");
    if (plan.orchestrationId !== orchestration.id || plan.rootTaskId !== orchestration.rootTaskId) {
      throw new Error("Orchestration plan identity does not match its durable record");
    }
    if (plan.departments.length < 1 || plan.departments.length > 3) {
      throw new Error("A company plan must route work to one through three departments");
    }

    const rootTask = this.getTask(orchestration.rootTaskId);
    const teamIds = new Set<string>();
    const createdAt = now();
    const createdTaskIds: string[] = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const department of plan.departments) {
        if (teamIds.has(department.teamId)) throw new Error("A department may appear only once in a company plan");
        teamIds.add(department.teamId);
        const teamRow = this.db.prepare("SELECT * FROM teams WHERE id = ?").get(department.teamId) as Row | undefined;
        if (!teamRow || asString(teamRow.lead_agent_id) !== department.managerAgentId) {
          throw new Error(`Manager ${department.managerAgentId} does not lead ${department.teamId}`);
        }
        if (department.workerAssignments.length < 1 || department.workerAssignments.length > 4) {
          throw new Error("Each manager must assign between one and four workers");
        }

        const missionId = randomUUID();
        this.insertPlannedTask({
          id: missionId,
          companyId: rootTask.companyId,
          teamId: department.teamId,
          goalId: rootTask.goalId,
          parentTaskId: rootTask.id,
          ownerAgentId: department.managerAgentId,
          reviewerAgentId: "agent-avery",
          title: department.missionTitle,
          brief: department.missionBrief,
          priority: rootTask.priority,
          risk: rootTask.risk,
          createdAt
        });
        createdTaskIds.push(missionId);

        const workerIds = new Set<string>();
        for (const assignment of department.workerAssignments) {
          if (workerIds.has(assignment.agentId)) throw new Error("A worker may appear only once per department plan");
          workerIds.add(assignment.agentId);
          const worker = this.getAgent(assignment.agentId);
          if (worker.teamId !== department.teamId || worker.managerAgentId !== department.managerAgentId) {
            throw new Error(`${assignment.agentId} is not a direct report of ${department.managerAgentId}`);
          }
          const workerTaskId = randomUUID();
          const criteria = assignment.acceptanceCriteria.map((item) => `- ${item}`).join("\n");
          this.insertPlannedTask({
            id: workerTaskId,
            companyId: rootTask.companyId,
            teamId: department.teamId,
            goalId: rootTask.goalId,
            parentTaskId: missionId,
            ownerAgentId: assignment.agentId,
            reviewerAgentId: department.managerAgentId,
            title: assignment.title,
            brief: `${assignment.brief}\n\nAcceptance criteria:\n${criteria}`,
            priority: rootTask.priority,
            risk: "green",
            createdAt
          });
          createdTaskIds.push(workerTaskId);
        }
      }

      this.db.prepare(`
        UPDATE orchestration_runs
        SET status = 'completed', plan_json = ?, summary = ?, updated_at = ?
        WHERE id = ?
      `).run(JSON.stringify(plan), plan.summary, createdAt, orchestration.id);
      this.db.prepare("UPDATE tasks SET progress = MAX(progress, 10), updated_at = ? WHERE id = ?").run(createdAt, rootTask.id);
      this.insertActivity({
        taskId: rootTask.id,
        runId: null,
        agentId: rootTask.ownerAgentId,
        type: "orchestration.completed",
        summary: `The company plan created ${createdTaskIds.length} accountable tasks across ${plan.departments.length} department(s).`,
        detail: plan.summary
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return createdTaskIds.map((taskId) => this.getTask(taskId));
  }

  failOrchestration(orchestrationId: string, errorMessage: string): void {
    const orchestration = this.getOrchestration(orchestrationId);
    if (orchestration.status !== "running") return;
    const failedAt = now();
    this.db.prepare(`
      UPDATE orchestration_runs SET status = 'failed', summary = ?, updated_at = ? WHERE id = ?
    `).run(errorMessage, failedAt, orchestrationId);
    this.insertActivity({
      taskId: orchestration.rootTaskId,
      runId: null,
      agentId: null,
      type: "orchestration.failed",
      summary: "Company orchestration stopped before creating department tasks.",
      detail: errorMessage
    });
  }

  private getOrchestration(orchestrationId: string): OrchestrationRun {
    const row = this.db.prepare("SELECT * FROM orchestration_runs WHERE id = ?").get(orchestrationId) as Row | undefined;
    if (!row) throw new Error(`Orchestration not found: ${orchestrationId}`);
    return this.mapOrchestration(row);
  }

  private listDescendantTasks(rootTaskId: string): Task[] {
    const rows = this.db.prepare(`
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM tasks WHERE parent_task_id = ?
        UNION ALL
        SELECT tasks.id FROM tasks JOIN descendants ON tasks.parent_task_id = descendants.id
      )
      SELECT tasks.* FROM tasks JOIN descendants ON tasks.id = descendants.id ORDER BY tasks.created_at
    `).all(rootTaskId) as Row[];
    return rows.map((row) => this.mapTask(row));
  }

  private insertPlannedTask(input: {
    id: string;
    companyId: string;
    teamId: string;
    goalId: string | null;
    parentTaskId: string;
    ownerAgentId: string;
    reviewerAgentId: string;
    title: string;
    brief: string;
    priority: Task["priority"];
    risk: RiskLevel;
    createdAt: string;
  }): void {
    this.db.prepare(`
      INSERT INTO tasks (
        id, company_id, team_id, goal_id, parent_task_id, owner_agent_id, reviewer_agent_id,
        title, brief, status, priority, risk, progress, created_at, updated_at, due_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, 0, ?, ?, NULL, NULL)
    `).run(
      input.id, input.companyId, input.teamId, input.goalId, input.parentTaskId,
      input.ownerAgentId, input.reviewerAgentId, input.title.trim(), input.brief.trim(),
      input.priority, input.risk, input.createdAt, input.createdAt
    );
    this.insertActivity({
      taskId: input.id,
      runId: null,
      agentId: input.ownerAgentId,
      type: "task.planned",
      summary: `${this.getAgent(input.ownerAgentId).name} received “${input.title}”.`,
      detail: `Parent task ${input.parentTaskId}`
    });
  }

  getTask(taskId: string): Task {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Row | undefined;
    if (!row) throw new Error(`Task not found: ${taskId}`);
    return this.mapTask(row);
  }

  getAgent(agentId: string): Agent {
    const row = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as Row | undefined;
    if (!row) throw new Error(`Agent not found: ${agentId}`);
    return this.mapAgent(row);
  }

  createDirective(input: CreateDirectiveInput): Task {
    const title = input.title.trim();
    const brief = input.brief.trim();
    if (!title || !brief) throw new Error("A directive needs both a title and a brief");

    let ownerAgentId = "agent-avery";
    if (input.teamId) {
      const team = this.db.prepare("SELECT lead_agent_id FROM teams WHERE id = ?").get(input.teamId) as Row | undefined;
      if (!team) throw new Error(`Team not found: ${input.teamId}`);
      ownerAgentId = asString(team.lead_agent_id);
    }

    const risk = input.risk ?? "green";
    const reviewerAgentId = risk === "green" ? null : "agent-quinn";
    const id = randomUUID();
    const createdAt = now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO tasks (
          id, company_id, team_id, goal_id, parent_task_id, owner_agent_id, reviewer_agent_id,
          title, brief, status, priority, risk, progress, created_at, updated_at, due_at, completed_at
        ) VALUES (?, 'company-northstar', ?, NULL, NULL, ?, ?, ?, ?, 'planned', ?, ?, 0, ?, ?, NULL, NULL)
      `).run(
        id,
        input.teamId ?? null,
        ownerAgentId,
        reviewerAgentId,
        title,
        brief,
        input.priority ?? "normal",
        risk,
        createdAt,
        createdAt
      );
      this.insertActivity({
        taskId: id,
        runId: null,
        agentId: ownerAgentId,
        type: "board.directive",
        summary: `The board issued a new directive: ${title}`,
        detail: brief
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getTask(id);
  }

  getOrCreateBoardChatDirective(input: {
    threadId: string;
    messageId: string;
    title: string;
    brief: string;
  }): Task {
    const threadId = input.threadId.trim();
    const messageId = input.messageId.trim();
    const title = input.title.trim();
    const brief = input.brief.trim();
    const requestHash = createHash("sha256").update(brief).digest("hex");
    if (!threadId || threadId.length > 512) throw new Error("A board chat thread ID is required");
    if (!messageId || messageId.length > 512) throw new Error("A board chat message ID is required");
    if (!title || title.length > 180) throw new Error("A board chat directive needs a title of at most 180 characters");
    if (!brief || brief.length > 8_000) throw new Error("A board chat directive needs a brief of at most 8,000 characters");

    const createdAt = now();
    let taskId: string | null = null;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare(`
        SELECT task_id, request_hash FROM board_chat_directives WHERE thread_id = ? AND message_id = ?
      `).get(threadId, messageId) as Row | undefined;
      if (existing) {
        const existingHash = asNullableString(existing.request_hash);
        if (existingHash && existingHash !== requestHash) {
          throw new Error("A board chat message ID cannot be reused with different content");
        }
        if (!existingHash) {
          this.db.prepare(`
            UPDATE board_chat_directives SET request_hash = ? WHERE thread_id = ? AND message_id = ?
          `).run(requestHash, threadId, messageId);
        }
        taskId = asString(existing.task_id);
      } else {
        taskId = randomUUID();
        this.db.prepare(`
          INSERT INTO tasks (
            id, company_id, team_id, goal_id, parent_task_id, owner_agent_id, reviewer_agent_id,
            title, brief, status, priority, risk, progress, created_at, updated_at, due_at, completed_at
          ) VALUES (?, 'company-northstar', NULL, NULL, NULL, 'agent-avery', NULL, ?, ?, 'planned',
            'normal', 'green', 0, ?, ?, NULL, NULL)
        `).run(taskId, title, brief, createdAt, createdAt);
        this.db.prepare(`
          INSERT INTO board_chat_directives (thread_id, message_id, request_hash, task_id, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(threadId, messageId, requestHash, taskId, createdAt);
        this.insertActivity({
          taskId,
          runId: null,
          agentId: "agent-avery",
          type: "board.directive",
          summary: `The board issued a new directive in its private chat: ${title}`,
          detail: brief
        });
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    if (!taskId) throw new Error("Board chat directive could not be created");
    return this.getTask(taskId);
  }

  createRun(taskId: string, provider: Run["provider"]): Run {
    const task = this.getTask(taskId);
    if (!task.ownerAgentId) throw new Error("Task must have one owner before dispatch");
    if (!["planned", "queued", "blocked", "failed"].includes(task.status)) {
      throw new Error(`Task cannot be dispatched from ${task.status}`);
    }
    const openChild = this.db.prepare(`
      SELECT id FROM tasks
      WHERE parent_task_id = ? AND status NOT IN ('done', 'cancelled')
      LIMIT 1
    `).get(taskId);
    if (openChild) throw new Error("A coordination task cannot run until its child tasks are finished");
    const id = randomUUID();
    const createdAt = now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const activeRun = this.db.prepare(
        "SELECT id FROM runs WHERE task_id = ? AND status IN ('queued', 'running') LIMIT 1"
      ).get(taskId);
      if (activeRun) throw new Error("Task already has an active run");
      const activeAgentRun = this.db.prepare(
        "SELECT id FROM runs WHERE agent_id = ? AND status IN ('queued', 'running') LIMIT 1"
      ).get(task.ownerAgentId);
      if (activeAgentRun) throw new Error("This agent already has queued or running work");
      this.db.prepare(`
        INSERT INTO runs (
          id, task_id, agent_id, provider, provider_thread_id, status, summary,
          input_tokens, cached_input_tokens, output_tokens, started_at, finished_at, created_at
        ) VALUES (?, ?, ?, ?, NULL, 'queued', NULL, 0, 0, 0, NULL, NULL, ?)
      `).run(id, taskId, task.ownerAgentId, provider, createdAt);
      this.db.prepare("UPDATE tasks SET status = 'queued', updated_at = ? WHERE id = ?").run(createdAt, taskId);
      this.db.prepare("UPDATE agents SET status = 'queued', current_task_id = ? WHERE id = ?").run(taskId, task.ownerAgentId);
      this.insertActivity({
        taskId,
        runId: id,
        agentId: task.ownerAgentId,
        type: "run.queued",
        summary: `${this.getAgent(task.ownerAgentId).name} entered the controlled work queue.`,
        detail: null
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getRun(id);
  }

  getRun(runId: string): Run {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as Row | undefined;
    if (!row) throw new Error(`Run not found: ${runId}`);
    return this.mapRun(row);
  }

  markRunStarted(runId: string, threadId: string | null): void {
    const run = this.getRun(runId);
    const startedAt = now();
    this.db.prepare(
      "UPDATE runs SET status = 'running', provider_thread_id = COALESCE(?, provider_thread_id), started_at = ? WHERE id = ?"
    ).run(threadId, startedAt, runId);
    this.db.prepare("UPDATE tasks SET status = 'in_progress', progress = MAX(progress, 10), updated_at = ? WHERE id = ?").run(startedAt, run.taskId);
    this.db.prepare("UPDATE agents SET status = 'working', last_active_at = ? WHERE id = ?").run(startedAt, run.agentId);
    this.insertActivity({
      taskId: run.taskId,
      runId,
      agentId: run.agentId,
      type: "run.started",
      summary: `${this.getAgent(run.agentId).name} started a controlled work session.`,
      detail: threadId ? `Provider session ${threadId}` : null
    });
  }

  updateRunThread(runId: string, threadId: string): void {
    this.db.prepare("UPDATE runs SET provider_thread_id = ? WHERE id = ?").run(threadId, runId);
  }

  appendRunActivity(runId: string, type: string, summary: string, detail: string | null = null): void {
    const run = this.getRun(runId);
    this.insertActivity({ taskId: run.taskId, runId, agentId: run.agentId, type, summary, detail });
  }

  completeRun(
    runId: string,
    result: { summary: string; inputTokens: number; cachedInputTokens: number; outputTokens: number }
  ): void {
    const run = this.getRun(runId);
    const task = this.getTask(run.taskId);
    const finishedAt = now();
    let nextStatus: TaskStatus = "done";
    let nextAgentStatus: Agent["status"] = "sleeping";
    if (task.risk === "yellow" || task.reviewerAgentId) {
      nextStatus = "review";
      nextAgentStatus = "review";
    }
    if (task.risk === "red") {
      nextStatus = "awaiting_approval";
      nextAgentStatus = "waiting";
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        UPDATE runs SET status = 'succeeded', summary = ?, input_tokens = ?, cached_input_tokens = ?,
          output_tokens = ?, finished_at = ? WHERE id = ?
      `).run(result.summary, result.inputTokens, result.cachedInputTokens, result.outputTokens, finishedAt, runId);
      this.db.prepare(`
        UPDATE tasks SET status = ?, progress = ?, updated_at = ?, completed_at = ? WHERE id = ?
      `).run(nextStatus, nextStatus === "done" ? 100 : 90, finishedAt, nextStatus === "done" ? finishedAt : null, task.id);
      this.db.prepare("UPDATE agents SET status = ?, current_task_id = NULL, last_active_at = ? WHERE id = ?").run(
        nextAgentStatus,
        finishedAt,
        run.agentId
      );
      this.insertActivity({
        taskId: task.id,
        runId,
        agentId: run.agentId,
        type: "run.completed",
        summary: `${this.getAgent(run.agentId).name} completed a work session.`,
        detail: result.summary
      });
      if (nextStatus === "awaiting_approval") {
        this.createPendingApprovalInsideTransaction(task, run.agentId);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  failRun(runId: string, errorMessage: string): void {
    const run = this.getRun(runId);
    const finishedAt = now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE runs SET status = 'failed', summary = ?, finished_at = ? WHERE id = ?").run(errorMessage, finishedAt, runId);
      this.db.prepare("UPDATE tasks SET status = 'failed', updated_at = ? WHERE id = ?").run(finishedAt, run.taskId);
      this.db.prepare("UPDATE agents SET status = 'blocked', current_task_id = NULL, last_active_at = ? WHERE id = ?").run(finishedAt, run.agentId);
      this.insertActivity({
        taskId: run.taskId,
        runId,
        agentId: run.agentId,
        type: "run.failed",
        summary: `${this.getAgent(run.agentId).name}'s work session failed.`,
        detail: errorMessage
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  reviewTask(taskId: string, decision: "accepted" | "rework"): Task {
    const task = this.getTask(taskId);
    if (task.status !== "review") throw new Error("Only work in review can receive a review decision");
    const reviewedAt = now();
    const nextStatus: TaskStatus = decision === "accepted" ? "done" : "planned";
    assertTaskTransition(task.status, nextStatus);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(
        "UPDATE tasks SET status = ?, progress = ?, updated_at = ?, completed_at = ? WHERE id = ?"
      ).run(
        nextStatus,
        decision === "accepted" ? 100 : Math.min(task.progress, 75),
        reviewedAt,
        decision === "accepted" ? reviewedAt : null,
        task.id
      );
      if (task.ownerAgentId) {
        this.db.prepare(`
          UPDATE agents
          SET status = 'sleeping', current_task_id = NULL, last_active_at = ?
          WHERE id = ? AND (current_task_id = ? OR current_task_id IS NULL)
        `).run(reviewedAt, task.ownerAgentId, task.id);
      }
      this.insertActivity({
        taskId: task.id,
        runId: null,
        agentId: task.reviewerAgentId,
        type: `review.${decision}`,
        summary: decision === "accepted"
          ? `Review accepted “${task.title}”.`
          : `Review returned “${task.title}” for another pass.`,
        detail: null
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getTask(task.id);
  }

  decideApproval(approvalId: string, decision: Exclude<ApprovalStatus, "pending">): Approval {
    const row = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as Row | undefined;
    if (!row) throw new Error(`Approval not found: ${approvalId}`);
    const approval = this.mapApproval(row);
    if (approval.status !== "pending") throw new Error("Approval has already been decided");
    const decidedAt = now();
    const task = this.getTask(approval.taskId);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?").run(decision, decidedAt, approvalId);
      const nextStatus: TaskStatus = decision === "approved" ? "done" : "cancelled";
      if (task.status !== nextStatus) {
        assertTaskTransition(task.status, nextStatus);
      }
      this.db.prepare("UPDATE tasks SET status = ?, progress = ?, updated_at = ?, completed_at = ? WHERE id = ?").run(
        nextStatus,
        decision === "approved" ? 100 : task.progress,
        decidedAt,
        decision === "approved" ? decidedAt : null,
        task.id
      );
      if (task.ownerAgentId) {
        this.db.prepare(`
          UPDATE agents
          SET status = 'sleeping', current_task_id = NULL, last_active_at = ?
          WHERE id = ? AND (current_task_id = ? OR current_task_id IS NULL)
        `).run(decidedAt, task.ownerAgentId, task.id);
      }
      this.insertActivity({
        taskId: task.id,
        runId: null,
        agentId: approval.requestedByAgentId,
        type: `approval.${decision}`,
        summary: `The board ${decision} “${approval.title}”.`,
        detail: null
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    const updated = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as Row;
    return this.mapApproval(updated);
  }

  private createPendingApprovalInsideTransaction(task: Task, agentId: string): void {
    const existing = this.db.prepare("SELECT id FROM approvals WHERE task_id = ? AND status = 'pending'").get(task.id);
    if (existing) return;
    this.db.prepare(`
      INSERT INTO approvals (
        id, company_id, task_id, requested_by_agent_id, type, title, rationale,
        impact, status, created_at, decided_at
      ) VALUES (?, ?, ?, ?, 'external_publish', ?, ?, ?, 'pending', ?, NULL)
    `).run(
      randomUUID(),
      task.companyId,
      task.id,
      agentId,
      `Approve external action for ${task.title}`,
      "The work is complete, but its risk policy requires a board decision.",
      "May create an external side effect under the board's identity.",
      now()
    );
  }

  private insertActivity(input: Omit<ActivityEvent, "id" | "companyId" | "createdAt">): void {
    this.db.prepare(`
      INSERT INTO activity_events (
        id, company_id, task_id, run_id, agent_id, type, summary, detail, created_at
      ) VALUES (?, 'company-northstar', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      input.taskId,
      input.runId,
      input.agentId,
      input.type,
      input.summary,
      input.detail,
      now()
    );
  }

  private mapCompany(row: Row): Company {
    return {
      id: asString(row.id),
      name: asString(row.name),
      mission: asString(row.mission),
      ownerTitle: asString(row.owner_title),
      createdAt: asString(row.created_at)
    };
  }

  private mapTeam(row: Row): Team {
    return {
      id: asString(row.id),
      companyId: asString(row.company_id),
      name: asString(row.name),
      purpose: asString(row.purpose),
      color: asString(row.color),
      leadAgentId: asString(row.lead_agent_id),
      sortOrder: asNumber(row.sort_order)
    };
  }

  private mapAgent(row: Row): Agent {
    return {
      id: asString(row.id),
      companyId: asString(row.company_id),
      teamId: asNullableString(row.team_id),
      managerAgentId: asNullableString(row.manager_agent_id),
      name: asString(row.name),
      title: asString(row.title),
      initials: asString(row.initials),
      accent: asString(row.accent),
      role: asString(row.role),
      responsibilities: parseJsonArray(row.responsibilities_json),
      status: asString(row.status) as Agent["status"],
      executionProvider: asString(row.execution_provider) as Agent["executionProvider"],
      runtimeProfile: asNullableString(row.runtime_profile),
      sandbox: asString(row.sandbox) as Agent["sandbox"],
      workspacePath: asNullableString(row.workspace_path),
      currentTaskId: asNullableString(row.current_task_id),
      lastActiveAt: asNullableString(row.last_active_at)
    };
  }

  private mapGoal(row: Row): Goal {
    return {
      id: asString(row.id),
      companyId: asString(row.company_id),
      teamId: asNullableString(row.team_id),
      title: asString(row.title),
      description: asString(row.description),
      status: asString(row.status) as Goal["status"],
      createdAt: asString(row.created_at)
    };
  }

  private mapTask(row: Row): Task {
    return {
      id: asString(row.id),
      companyId: asString(row.company_id),
      teamId: asNullableString(row.team_id),
      goalId: asNullableString(row.goal_id),
      parentTaskId: asNullableString(row.parent_task_id),
      ownerAgentId: asNullableString(row.owner_agent_id),
      reviewerAgentId: asNullableString(row.reviewer_agent_id),
      title: asString(row.title),
      brief: asString(row.brief),
      status: asString(row.status) as Task["status"],
      priority: asString(row.priority) as Task["priority"],
      risk: asString(row.risk) as RiskLevel,
      progress: asNumber(row.progress),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
      dueAt: asNullableString(row.due_at),
      completedAt: asNullableString(row.completed_at)
    };
  }

  private mapRun(row: Row): Run {
    return {
      id: asString(row.id),
      taskId: asString(row.task_id),
      agentId: asString(row.agent_id),
      provider: asString(row.provider) as Run["provider"],
      providerThreadId: asNullableString(row.provider_thread_id),
      status: asString(row.status) as RunStatus,
      summary: asNullableString(row.summary),
      inputTokens: asNumber(row.input_tokens),
      cachedInputTokens: asNumber(row.cached_input_tokens),
      outputTokens: asNumber(row.output_tokens),
      startedAt: asNullableString(row.started_at),
      finishedAt: asNullableString(row.finished_at),
      createdAt: asString(row.created_at)
    };
  }

  private mapOrchestration(row: Row): OrchestrationRun {
    return {
      id: asString(row.id),
      rootTaskId: asString(row.root_task_id),
      graphName: asString(row.graph_name),
      graphVersion: asString(row.graph_version),
      langgraphThreadId: asString(row.langgraph_thread_id),
      status: asString(row.status) as OrchestrationRun["status"],
      plan: parseCompanyPlan(row.plan_json),
      summary: asNullableString(row.summary),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at)
    };
  }

  private mapApproval(row: Row): Approval {
    return {
      id: asString(row.id),
      companyId: asString(row.company_id),
      taskId: asString(row.task_id),
      requestedByAgentId: asString(row.requested_by_agent_id),
      type: asString(row.type) as Approval["type"],
      title: asString(row.title),
      rationale: asString(row.rationale),
      impact: asString(row.impact),
      status: asString(row.status) as ApprovalStatus,
      createdAt: asString(row.created_at),
      decidedAt: asNullableString(row.decided_at)
    };
  }

  private mapActivity(row: Row): ActivityEvent {
    return {
      id: asString(row.id),
      companyId: asString(row.company_id),
      taskId: asNullableString(row.task_id),
      runId: asNullableString(row.run_id),
      agentId: asNullableString(row.agent_id),
      type: asString(row.type),
      summary: asString(row.summary),
      detail: asNullableString(row.detail),
      createdAt: asString(row.created_at)
    };
  }
}
