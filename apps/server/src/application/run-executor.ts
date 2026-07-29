import type { Agent, Run, Task } from "@private-ai-org/core";

export interface RunExecutionRequest {
  runId: string;
  task: Task;
  agent: Agent;
  cwd: string;
}

export type RunExecutionEvent =
  | { type: "session.started"; sessionId: string }
  | { type: "activity"; kind: string; summary: string }
  | { type: "warning"; message: string };

export interface RunExecutionResult {
  sessionId: string | null;
  summary: string;
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  };
}

export interface RunExecutor {
  readonly provider: Run["provider"];
  execute(
    request: RunExecutionRequest,
    onEvent: (event: RunExecutionEvent) => void
  ): Promise<RunExecutionResult>;
}

export function buildAgentPrompt(task: Task, agent: Agent): string {
  return [
    `You are ${agent.name}, the ${agent.title} in a private AI organization.`,
    "",
    "Your standing role:",
    agent.role,
    "",
    "Your responsibilities:",
    ...agent.responsibilities.map((responsibility) => `- ${responsibility}`),
    "",
    `Task: ${task.title}`,
    task.brief,
    "",
    "Operating rules:",
    "- You own this task's execution, but not the organization's identity or long-term memory.",
    "- Keep the execution path as shallow as possible.",
    "- Verify material claims and report blockers honestly.",
    "- Do not publish, send messages, make purchases, or perform destructive external actions.",
    "- Finish with a concise result, evidence of verification, and any decision needed from management."
  ].join("\n");
}
