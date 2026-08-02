import type { OrchestrationRun, Task } from "@private-ai-org/core";
import { OrganizationRepository } from "../../infrastructure/database.js";
import { CompanyOrchestrator } from "./company-orchestrator.js";

export interface BoardChatDirective {
  threadId: string;
  messageId: string;
  text: string;
}

export interface BoardChatStudioOutcome {
  studioName: string;
  managerName: string;
  temporaryWorkerCount: number;
}

export interface BoardChatOutcome {
  rootTaskId: string;
  title: string;
  orchestrationId: string;
  summary: string;
  studios: BoardChatStudioOutcome[];
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
    if (plan.planningModel !== "studio-v1") {
      throw new Error("A newly completed board directive must use the Studio planning model");
    }
    const studios = new Map(
      dashboard.studios.map((snapshot) => [snapshot.studio.id, snapshot.studio.name])
    );
    const agents = new Map(dashboard.agents.map((agent) => [agent.id, agent.name]));

    return {
      rootTaskId: task.id,
      title: task.title,
      orchestrationId: orchestration.id,
      summary: plan.summary,
      studios: plan.studios.map((studio) => ({
        studioName: studios.get(studio.studioId) ?? studio.studioId,
        managerName: agents.get(studio.managerAgentId) ?? studio.managerAgentId,
        temporaryWorkerCount: studio.temporaryWorkers.length
      }))
    };
  }
}
