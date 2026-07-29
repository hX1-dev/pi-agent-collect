import path from "node:path";
import type { Run } from "@private-ai-org/core";
import { OrganizationRepository } from "../infrastructure/database.js";
import type { RunExecutor } from "./run-executor.js";

interface PendingJob {
  run: Run;
  cwd: string;
  writable: boolean;
}

export class RunBroker {
  private readonly queue: PendingJob[] = [];
  private readonly activeAgentIds = new Set<string>();
  private readonly activeWritableWorkspaces = new Set<string>();
  private activeCount = 0;

  constructor(
    private readonly repository: OrganizationRepository,
    private readonly executor: RunExecutor,
    private readonly maxConcurrency: number,
    private readonly workspaceRoot: string
  ) {}

  dispatch(taskId: string): Run {
    const run = this.repository.createRun(taskId, this.executor.provider);
    const agent = this.repository.getAgent(run.agentId);
    this.queue.push({
      run,
      cwd: path.resolve(agent.workspacePath ?? this.workspaceRoot),
      writable: agent.sandbox === "workspace-write"
    });
    this.pump();
    return run;
  }

  private pump(): void {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const jobIndex = this.queue.findIndex((candidate) => (
        !this.activeAgentIds.has(candidate.run.agentId)
        && (!candidate.writable || !this.activeWritableWorkspaces.has(candidate.cwd))
      ));
      if (jobIndex < 0) return;
      const [job] = this.queue.splice(jobIndex, 1);
      if (!job) return;
      this.activeCount += 1;
      this.activeAgentIds.add(job.run.agentId);
      if (job.writable) this.activeWritableWorkspaces.add(job.cwd);
      void this.execute(job).finally(() => {
        this.activeCount -= 1;
        this.activeAgentIds.delete(job.run.agentId);
        if (job.writable) this.activeWritableWorkspaces.delete(job.cwd);
        this.pump();
      });
    }
  }

  private async execute(job: PendingJob): Promise<void> {
    try {
      const task = this.repository.getTask(job.run.taskId);
      const agent = this.repository.getAgent(job.run.agentId);
      this.repository.markRunStarted(job.run.id, null);
      const result = await this.executor.execute({
        runId: job.run.id,
        task,
        agent,
        cwd: job.cwd
      }, (event) => {
        if (event.type === "session.started") {
          this.repository.updateRunThread(job.run.id, event.sessionId);
        } else if (event.type === "activity") {
          this.repository.appendRunActivity(job.run.id, "run.progress", event.summary, event.kind);
        } else {
          this.repository.appendRunActivity(job.run.id, "run.warning", event.message);
        }
      });
      if (result.sessionId) this.repository.updateRunThread(job.run.id, result.sessionId);
      this.repository.completeRun(job.run.id, {
        summary: result.summary,
        inputTokens: result.usage.inputTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        outputTokens: result.usage.outputTokens
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        this.repository.failRun(job.run.id, message);
      } catch (persistenceError) {
        console.error("Could not persist failed agent run", persistenceError);
      }
    }
  }
}
