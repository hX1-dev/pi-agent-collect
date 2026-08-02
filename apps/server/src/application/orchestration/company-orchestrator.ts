import type { OrchestrationRun, StudioCompanyPlan } from "@private-ai-org/core";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { OrganizationRepository } from "../../infrastructure/database.js";
import type { AgentRuntimePort } from "./agent-runtime-port.js";
import {
  COMPANY_GRAPH_NAME,
  COMPANY_GRAPH_VERSION,
  createCompanyGraph,
  studioPlanFromGraphState
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
    if (
      existing
      && (
        existing.graphName !== COMPANY_GRAPH_NAME
        || existing.graphVersion !== COMPANY_GRAPH_VERSION
      )
    ) {
      const message = [
        `Cannot resume ${existing.graphName}@${existing.graphVersion}`,
        `with ${COMPANY_GRAPH_NAME}@${COMPANY_GRAPH_VERSION};`,
        "the durable orchestration must be retried as a new board directive."
      ].join(" ");
      this.repository.failOrchestration(existing.id, message);
      throw new Error(message);
    }

    const orchestration = existing ?? this.repository.createOrchestration(
      rootTaskId,
      COMPANY_GRAPH_NAME,
      COMPANY_GRAPH_VERSION
    );

    try {
      const task = this.repository.getTask(rootTaskId);
      const dashboard = this.repository.getDashboard();
      const ceos = dashboard.agents.filter(
        (agent) => agent.managerAgentId === null && agent.teamId === null
      );
      if (ceos.length !== 1) {
        throw new Error(`The Studio planner requires exactly one CEO profile; found ${ceos.length}`);
      }
      const ceo = ceos[0];
      if (!ceo) throw new Error("The Studio planner CEO profile disappeared");
      const availableStudios = dashboard.studios
        .map((snapshot) => snapshot.studio)
        .filter((studio) => studio.status !== "retired");
      if (availableStudios.length < 1 || availableStudios.length > 3) {
        throw new Error(
          `The Studio planner requires one through three non-retired Studios; found ${availableStudios.length}`
        );
      }
      const legacyTeam = task.teamId
        ? dashboard.teams.find((team) => team.id === task.teamId)
        : null;
      const preferredStudioId = task.studioId ?? (
        legacyTeam
          ? availableStudios.find(
              (studio) => studio.managerAgentId === legacyTeam.leadAgentId
            )?.id ?? null
          : null
      );
      const state = await this.graph.invoke({
        orchestrationId: orchestration.id,
        rootTaskId,
        title: task.title,
        brief: task.brief,
        risk: task.risk,
        ceoAgentId: ceo.id,
        preferredStudioId,
        studios: availableStudios.map(({
          id, key, name, purpose, managerAgentId, sortOrder, status
        }) => ({
          id, key, name, purpose, managerAgentId, sortOrder, status
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
      const plan: StudioCompanyPlan = {
        planningModel: "studio-v1",
        orchestrationId: orchestration.id,
        rootTaskId,
        studios: studioPlanFromGraphState(state),
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
