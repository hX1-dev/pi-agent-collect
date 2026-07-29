import path from "node:path";
import type {
  AgentRuntimePort,
  AgentRuntimeRequest,
  AgentRuntimeResult
} from "./orchestration/agent-runtime-port.js";

interface PendingExecution {
  request: AgentRuntimeRequest;
  resolve: (result: AgentRuntimeResult) => void;
  reject: (error: unknown) => void;
  workspace: string;
  writable: boolean;
}

export class AgentRuntimeGate implements AgentRuntimePort {
  private readonly queue: PendingExecution[] = [];
  private readonly activeAgentIds = new Set<string>();
  private readonly activeWritableWorkspaces = new Set<string>();
  private activeCount = 0;

  constructor(
    private readonly runtime: AgentRuntimePort,
    private readonly maxConcurrency: number,
    private readonly workspaceRoot: string
  ) {
    if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new Error("Agent runtime concurrency must be a positive integer");
    }
  }

  execute(request: AgentRuntimeRequest): Promise<AgentRuntimeResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        request,
        resolve,
        reject,
        workspace: path.resolve(request.agent.workspacePath ?? this.workspaceRoot),
        writable: request.agent.sandbox === "workspace-write"
      });
      this.pump();
    });
  }

  private pump(): void {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const jobIndex = this.queue.findIndex((candidate) => (
        !this.activeAgentIds.has(candidate.request.agent.id)
        && (!candidate.writable || !this.activeWritableWorkspaces.has(candidate.workspace))
      ));
      if (jobIndex < 0) return;
      const [job] = this.queue.splice(jobIndex, 1);
      if (!job) return;

      this.activeCount += 1;
      this.activeAgentIds.add(job.request.agent.id);
      if (job.writable) this.activeWritableWorkspaces.add(job.workspace);
      void this.runtime.execute(job.request).then(job.resolve, job.reject).finally(() => {
        this.activeCount -= 1;
        this.activeAgentIds.delete(job.request.agent.id);
        if (job.writable) this.activeWritableWorkspaces.delete(job.workspace);
        this.pump();
      });
    }
  }
}
