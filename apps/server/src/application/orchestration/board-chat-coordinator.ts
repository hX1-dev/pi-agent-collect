import type { OrchestrationRun, Task } from "@private-ai-org/core";
import { OrganizationRepository } from "../../infrastructure/database.js";
import { CompanyOrchestrator } from "./company-orchestrator.js";

export interface BoardChatDirective {
  threadId: string;
  messageId: string;
  text: string;
}

export interface BoardChatDepartmentOutcome {
  teamName: string;
  managerName: string;
  workerCount: number;
}

export interface BoardChatOutcome {
  rootTaskId: string;
  title: string;
  orchestrationId: string;
  summary: string;
  departments: BoardChatDepartmentOutcome[];
}

export interface BoardChatHandler {
  handleDirective(input: BoardChatDirective): Promise<BoardChatOutcome>;
}

function titleFromDirective(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const candidate = firstLine || text.trim();
  if (candidate.length <= 180) return candidate;
  return `${candidate.slice(0, 179).trimEnd()}…`;
}

function completedPlan(orchestration: OrchestrationRun) {
  if (orchestration.status !== "completed" || !orchestration.plan) {
    throw new Error("The company did not produce a completed plan for this directive");
  }
  return orchestration.plan;
}

export class BoardChatCoordinator implements BoardChatHandler {
  constructor(
    private readonly repository: OrganizationRepository,
    private readonly orchestrator: CompanyOrchestrator
  ) {}

  async handleDirective(input: BoardChatDirective): Promise<BoardChatOutcome> {
    const task: Task = this.repository.getOrCreateBoardChatDirective({
      threadId: input.threadId,
      messageId: input.messageId,
      title: titleFromDirective(input.text),
      brief: input.text
    });
    const orchestration = await this.orchestrator.orchestrate(task.id);
    const plan = completedPlan(orchestration);
    const dashboard = this.repository.getDashboard();
    const teams = new Map(dashboard.teams.map((team) => [team.id, team.name]));
    const agents = new Map(dashboard.agents.map((agent) => [agent.id, agent.name]));

    return {
      rootTaskId: task.id,
      title: task.title,
      orchestrationId: orchestration.id,
      summary: plan.summary,
      departments: plan.departments.map((department) => ({
        teamName: teams.get(department.teamId) ?? department.teamId,
        managerName: agents.get(department.managerAgentId) ?? department.managerAgentId,
        workerCount: department.workerAssignments.length
      }))
    };
  }
}
