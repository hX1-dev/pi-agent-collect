import type { RunExecutor } from "../../application/run-executor.js";
import { buildAgentPrompt } from "../../application/run-executor.js";
import type { AgentRuntimePort } from "../../application/orchestration/agent-runtime-port.js";

export class AgentRuntimeTaskExecutor implements RunExecutor {
  constructor(
    private readonly runtime: AgentRuntimePort,
    readonly provider: "hermes" | "mock"
  ) {}

  async execute(request: Parameters<RunExecutor["execute"]>[0], onEvent: Parameters<RunExecutor["execute"]>[1]) {
    const result = await this.runtime.execute({
      idempotencyKey: `run:${request.runId}:execute:${request.agent.id}`,
      orchestrationId: `task-run:${request.runId}`,
      rootTaskId: request.task.id,
      agent: request.agent,
      mode: "execute",
      brief: buildAgentPrompt(request.task, request.agent),
      instructions: "Complete only the assigned deliverable and return a concise result with evidence.",
      context: {
        taskId: request.task.id,
        parentTaskId: request.task.parentTaskId,
        workspace: request.cwd,
        risk: request.task.risk
      }
    });
    onEvent({ type: "session.started", sessionId: result.executionId });
    return {
      sessionId: result.executionId,
      summary: result.output,
      usage: {
        inputTokens: result.usage.inputTokens,
        cachedInputTokens: 0,
        outputTokens: result.usage.outputTokens
      }
    };
  }
}
