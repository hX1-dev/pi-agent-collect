import type { CompanyPlan, OrchestrationRun } from "@private-ai-org/core";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { OrganizationRepository } from "../../infrastructure/database.js";
import type { AgentRuntimePort } from "./agent-runtime-port.js";
import {
  COMPANY_GRAPH_NAME,
  COMPANY_GRAPH_VERSION,
  companyPlanFromGraphState,
  createCompanyGraph
} from "./company-graph.js";

export class CompanyOrchestrator {
  private readonly graph: ReturnType<typeof createCompanyGraph>;
  private readonly inFlight = new Map<string, Promise<OrchestrationRun>>();

  constructor(
    private readonly repository: OrganizationRepository,
    runtime: AgentRuntimePort,
    checkpointer: BaseCheckpointSaver
  ) {
    this.graph = createCompanyGraph(runtime, checkpointer);
  }

  orchestrate(rootTaskId: string): Promise<OrchestrationRun> {
    const current = this.inFlight.get(rootTaskId);
    if (current) return current;
    const execution = this.run(rootTaskId).finally(() => this.inFlight.delete(rootTaskId));
    this.inFlight.set(rootTaskId, execution);
    return execution;
  }

  private async run(rootTaskId: string): Promise<OrchestrationRun> {
    const existing = this.repository.getOrchestrationForTask(rootTaskId);
    if (existing?.status === "completed") return existing;
    if (existing?.status === "failed") {
      throw new Error(`Company orchestration already failed: ${existing.summary ?? "no error detail"}`);
    }

    const orchestration = existing ?? this.repository.createOrchestration(
      rootTaskId,
      COMPANY_GRAPH_NAME,
      COMPANY_GRAPH_VERSION
    );

    try {
      const task = this.repository.getTask(rootTaskId);
      const dashboard = this.repository.getDashboard();
      const state = await this.graph.invoke({
        orchestrationId: orchestration.id,
        rootTaskId,
        title: task.title,
        brief: task.brief,
        risk: task.risk,
        preferredTeamId: task.teamId,
        teams: dashboard.teams.map(({ id, name, purpose, leadAgentId, sortOrder }) => ({
          id, name, purpose, leadAgentId, sortOrder
        })),
        agents: dashboard.agents.map(({
          id, teamId, managerAgentId, name, title, role, responsibilities, runtimeProfile
        }) => ({
          id, teamId, managerAgentId, name, title, role, responsibilities, runtimeProfile
        }))
      }, {
        configurable: { thread_id: orchestration.langgraphThreadId },
        recursionLimit: 12
      });
      const plan: CompanyPlan = {
        orchestrationId: orchestration.id,
        rootTaskId,
        departments: companyPlanFromGraphState(state),
        summary: state.summary
      };
      this.repository.completeOrchestration(orchestration.id, plan);
      return this.repository.getOrchestrationForTask(rootTaskId) as OrchestrationRun;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.repository.failOrchestration(orchestration.id, message);
      throw error;
    }
  }
}
