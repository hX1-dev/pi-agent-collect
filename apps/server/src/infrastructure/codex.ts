import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { Agent, Task } from "@private-ai-org/core";

export interface CodexUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export type CodexEvent =
  | { type: "thread.started"; threadId: string }
  | { type: "activity"; kind: string; summary: string; raw: unknown }
  | { type: "completed"; summary: string; usage: CodexUsage }
  | { type: "warning"; message: string };

export interface CodexExecutionRequest {
  prompt: string;
  cwd: string;
  sandbox: Agent["sandbox"];
  threadId?: string;
}

export interface CodexExecutor {
  readonly provider: "codex" | "mock";
  execute(request: CodexExecutionRequest, onEvent: (event: CodexEvent) => void): Promise<{
    threadId: string | null;
    summary: string;
    usage: CodexUsage;
  }>;
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class MockCodexExecutor implements CodexExecutor {
  readonly provider = "mock" as const;

  async execute(request: CodexExecutionRequest, onEvent: (event: CodexEvent) => void) {
    const threadId = request.threadId ?? `mock-${crypto.randomUUID()}`;
    onEvent({ type: "thread.started", threadId });
    await sleep(180);
    onEvent({
      type: "activity",
      kind: "plan",
      summary: "Prepared a minimal execution plan and checked the task boundary.",
      raw: null
    });
    await sleep(220);
    const summary = "Mock execution finished safely. Switch CODEX_EXECUTION_MODE to live when the board is ready to consume Codex usage.";
    const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    onEvent({ type: "completed", summary, usage });
    return { threadId, summary, usage };
  }
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "TERM",
    "CODEX_HOME",
    "SSL_CERT_FILE",
    "NODE_EXTRA_CA_CERTS",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "ALL_PROXY",
    "NO_PROXY"
  ] as const;
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function lastAgentMessage(event: Record<string, unknown>): string | null {
  const item = event.item;
  if (!item || typeof item !== "object") return null;
  const typedItem = item as Record<string, unknown>;
  if (typedItem.type !== "agent_message") return null;
  return typeof typedItem.text === "string" ? typedItem.text : null;
}

function usageFrom(event: Record<string, unknown>): CodexUsage {
  const usage = event.usage;
  if (!usage || typeof usage !== "object") {
    return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  }
  const values = usage as Record<string, unknown>;
  const number = (key: string) => typeof values[key] === "number" ? values[key] as number : 0;
  return {
    inputTokens: number("input_tokens"),
    cachedInputTokens: number("cached_input_tokens"),
    outputTokens: number("output_tokens")
  };
}

export class LiveCodexExecutor implements CodexExecutor {
  readonly provider = "codex" as const;
  private readonly workspaceRoot: string;
  private readonly timeoutMs: number;

  constructor(workspaceRoot: string, timeoutMs: number) {
    this.workspaceRoot = realpathSync(workspaceRoot);
    this.timeoutMs = timeoutMs;
  }

  async execute(request: CodexExecutionRequest, onEvent: (event: CodexEvent) => void) {
    const cwd = realpathSync(request.cwd);
    const relative = path.relative(this.workspaceRoot, cwd);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Codex workspaces must stay inside the configured organization workspace");
    }

    const args = [
      "--sandbox",
      request.sandbox,
      "--ask-for-approval",
      "never",
      "--cd",
      cwd,
      "exec"
    ];
    if (request.threadId) {
      args.push("resume", "--json", "--strict-config", request.threadId, "-");
    } else {
      args.push("--json", "--strict-config", "-");
    }

    return await new Promise<{
      threadId: string | null;
      summary: string;
      usage: CodexUsage;
    }>((resolve, reject) => {
      const child = spawn("codex", args, {
        cwd,
        env: safeEnvironment(),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"]
      });
      let threadId: string | null = request.threadId ?? null;
      let summary = "";
      let usage: CodexUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
      let stderr = "";
      let callbackError: unknown = null;
      let timeoutError: Error | null = null;
      const emit = (event: CodexEvent): void => {
        if (callbackError) return;
        try {
          onEvent(event);
        } catch (error) {
          callbackError = error;
          child.kill("SIGTERM");
        }
      };
      const timeout = setTimeout(() => {
        timeoutError = new Error(`Codex execution exceeded ${this.timeoutMs}ms`);
        child.kill("SIGTERM");
      }, this.timeoutMs);

      const lines = readline.createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        if (!line.trim()) return;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line) as Record<string, unknown>;
        } catch {
          emit({ type: "warning", message: `Ignored a non-JSON Codex output line: ${line.slice(0, 160)}` });
          return;
        }

        if (event.type === "thread.started" && typeof event.thread_id === "string") {
          threadId = event.thread_id;
          emit({ type: "thread.started", threadId });
          return;
        }
        const agentMessage = lastAgentMessage(event);
        if (agentMessage) summary = agentMessage;
        if (event.type === "turn.completed") usage = usageFrom(event);
        if (typeof event.type === "string" && event.type.startsWith("item.")) {
          emit({
            type: "activity",
            kind: event.type,
            summary: agentMessage ?? "Codex produced a work event.",
            raw: event
          });
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.length < 65_536) stderr += chunk.toString("utf8").slice(0, 65_536 - stderr.length);
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (callbackError) {
          reject(callbackError);
          return;
        }
        if (timeoutError) {
          reject(timeoutError);
          return;
        }
        if (code !== 0) {
          reject(new Error(stderr.trim() || `Codex exited with status ${code ?? "unknown"}`));
          return;
        }
        const finalSummary = summary || "Codex completed the task without a final text response.";
        try {
          onEvent({ type: "completed", summary: finalSummary, usage });
        } catch (error) {
          reject(error);
          return;
        }
        resolve({ threadId, summary: finalSummary, usage });
      });
      child.stdin.end(request.prompt);
    });
  }
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
