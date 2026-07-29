import type {
  AgentRuntimePort,
  AgentRuntimeRequest,
  AgentRuntimeResult
} from "../../application/orchestration/agent-runtime-port.js";
import {
  HermesRunsClient,
  type HermesFetch,
  type HermesRunsClientOptions,
  type HermesSleep
} from "./hermes-runs-client.js";

export interface HermesProfileEndpoint {
  baseUrl: string;
  apiKey: string;
}

export interface HermesAgentRuntimeOptions {
  profileEndpoints?: Record<string, HermesProfileEndpoint>;
  multiplexEndpoint?: HermesProfileEndpoint;
  pollIntervalMs?: number;
  timeoutMs?: number;
  fetch?: HermesFetch;
  sleep?: HermesSleep;
  now?: () => number;
}

export class HermesAgentRuntime implements AgentRuntimePort {
  private readonly options: HermesAgentRuntimeOptions;

  constructor(options: HermesAgentRuntimeOptions) {
    this.options = options;
  }

  async execute(request: AgentRuntimeRequest): Promise<AgentRuntimeResult> {
    if (request.agent.executionProvider !== "hermes") {
      throw new Error(`Agent ${request.agent.id} is not configured for the Hermes runtime`);
    }
    const profile = request.agent.runtimeProfile;
    if (!profile) throw new Error(`Agent ${request.agent.id} does not have a Hermes runtimeProfile`);

    const result = await new HermesRunsClient(this.clientOptions(profile)).run({
      input: buildTaskInput(request),
      instructions: buildRunInstructions(request),
      sessionId: request.idempotencyKey,
      sessionKey: `northstar:${request.agent.companyId}:agent:${request.agent.id}`,
      idempotencyKey: request.idempotencyKey
    });

    return {
      executionId: result.runId,
      output: result.output,
      usage: result.usage
    };
  }

  private clientOptions(profile: string): HermesRunsClientOptions {
    const dedicated = this.options.profileEndpoints?.[profile];
    const endpoint = dedicated ?? this.options.multiplexEndpoint;
    if (!endpoint) {
      throw new Error(`Hermes profile ${profile} does not have a configured Runs API endpoint`);
    }
    return {
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      profile,
      profilePathPrefix: dedicated === undefined,
      ...(this.options.pollIntervalMs === undefined ? {} : { pollIntervalMs: this.options.pollIntervalMs }),
      ...(this.options.timeoutMs === undefined ? {} : { timeoutMs: this.options.timeoutMs }),
      ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
      ...(this.options.sleep === undefined ? {} : { sleep: this.options.sleep }),
      ...(this.options.now === undefined ? {} : { now: this.options.now })
    };
  }
}

function buildRunInstructions(request: AgentRuntimeRequest): string {
  return [
    `You are ${request.agent.name}, the ${request.agent.title} in a private AI organization.`,
    `Your current execution mode is ${request.mode}.`,
    "",
    "Standing role:",
    request.agent.role,
    "",
    "Responsibilities:",
    ...request.agent.responsibilities.map((responsibility) => `- ${responsibility}`),
    "",
    "Instructions for this run:",
    request.instructions,
    "",
    "Do not publish, send messages, change calendars, make payments, or perform destructive external actions.",
    "If a tool requires approval, wait for the control plane; never assume approval."
  ].join("\n");
}

function buildTaskInput(request: AgentRuntimeRequest): string {
  let context: string;
  try {
    context = JSON.stringify(request.context, null, 2);
  } catch (error) {
    throw new Error(`Could not serialize runtime context for agent ${request.agent.id}`, { cause: error });
  }
  if (context === undefined) context = "{}";

  return [
    `Orchestration: ${request.orchestrationId}`,
    `Root task: ${request.rootTaskId}`,
    "",
    "Task brief:",
    request.brief,
    "",
    "Context data:",
    context
  ].join("\n");
}
