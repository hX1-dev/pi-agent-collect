import type { Agent } from "@private-ai-org/core";

export type AgentRuntimeMode = "route" | "plan" | "execute" | "review";

export interface AgentRuntimeRequest {
  idempotencyKey: string;
  orchestrationId: string;
  rootTaskId: string;
  agent: Agent;
  mode: AgentRuntimeMode;
  brief: string;
  instructions: string;
  context: Record<string, unknown>;
}

export interface AgentRuntimeResult {
  executionId: string;
  output: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface AgentRuntimePort {
  execute(request: AgentRuntimeRequest): Promise<AgentRuntimeResult>;
}
