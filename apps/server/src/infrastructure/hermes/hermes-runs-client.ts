export type HermesFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type HermesSleep = (milliseconds: number) => Promise<void>;

export type HermesRunStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "stopping"
  | "completed"
  | "failed"
  | "cancelled";

export interface HermesRunUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface HermesRunRequest {
  input: string;
  sessionId: string;
  instructions: string;
  sessionKey: string;
  idempotencyKey: string;
}

export interface HermesRunSnapshot {
  runId: string;
  status: HermesRunStatus;
  sessionId: string | null;
  output: string | null;
  error: string | null;
  usage: HermesRunUsage | null;
}

export interface HermesCompletedRun {
  runId: string;
  sessionId: string | null;
  output: string;
  usage: HermesRunUsage;
}

export interface HermesRunsClientOptions {
  baseUrl: string;
  apiKey: string;
  profile: string;
  profilePathPrefix?: boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
  fetch?: HermesFetch;
  sleep?: HermesSleep;
  now?: () => number;
}

export class HermesRunsClientError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HermesRunsClientError";
  }
}

export class HermesRunApprovalRequiredError extends HermesRunsClientError {
  readonly runId: string;
  readonly stopRequested: boolean;

  constructor(runId: string, stopRequested: boolean, stopError?: unknown) {
    const stopDetail = stopRequested
      ? "A stop request was accepted."
      : `The mandatory stop request failed: ${errorMessage(stopError)}.`;
    super(
      `Hermes run ${runId} entered waiting_for_approval. `
        + "Northstar never approves Hermes tool calls automatically. "
        + stopDetail,
      stopError === undefined ? undefined : { cause: stopError }
    );
    this.name = "HermesRunApprovalRequiredError";
    this.runId = runId;
    this.stopRequested = stopRequested;
  }
}

const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000;
const PROFILE_NAME = /^[A-Za-z0-9_-]+$/;
const RUN_STATUSES = new Set<HermesRunStatus>([
  "queued",
  "running",
  "waiting_for_approval",
  "stopping",
  "completed",
  "failed",
  "cancelled"
]);

const defaultSleep: HermesSleep = async (milliseconds) => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "unknown error";
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HermesRunsClientError(`Hermes response field ${field} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new HermesRunsClientError(`Hermes response field ${field} must be a string when present`);
  }
  return value;
}

function tokenCount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new HermesRunsClientError(`Hermes response field ${field} must be a non-negative integer`);
  }
  return value;
}

function parseUsage(value: unknown): HermesRunUsage {
  if (!isRecord(value)) throw new HermesRunsClientError("Hermes completed run is missing usage data");
  return {
    inputTokens: tokenCount(value.input_tokens, "usage.input_tokens"),
    outputTokens: tokenCount(value.output_tokens, "usage.output_tokens"),
    totalTokens: tokenCount(value.total_tokens, "usage.total_tokens")
  };
}

function parseStartResponse(value: unknown): string {
  if (!isRecord(value)) throw new HermesRunsClientError("Hermes start response must be an object");
  const runId = requiredString(value.run_id, "run_id");
  if (value.status !== "started") {
    throw new HermesRunsClientError("Hermes start response status must be started");
  }
  return runId;
}

function parseRunSnapshot(value: unknown, expectedRunId: string): HermesRunSnapshot {
  if (!isRecord(value)) throw new HermesRunsClientError("Hermes run status response must be an object");
  if (value.object !== "hermes.run") {
    throw new HermesRunsClientError("Hermes run status response has an invalid object type");
  }

  const runId = requiredString(value.run_id, "run_id");
  if (runId !== expectedRunId) {
    throw new HermesRunsClientError(`Hermes returned status for an unexpected run: ${runId}`);
  }
  if (typeof value.status !== "string" || !RUN_STATUSES.has(value.status as HermesRunStatus)) {
    throw new HermesRunsClientError("Hermes run status response has an unknown status");
  }

  const status = value.status as HermesRunStatus;
  const output = optionalString(value.output, "output");
  const error = optionalString(value.error, "error");
  const usage = value.usage === undefined || value.usage === null ? null : parseUsage(value.usage);

  if (status === "completed" && output === null) {
    throw new HermesRunsClientError("Hermes completed run is missing output");
  }
  if (status === "completed" && usage === null) {
    throw new HermesRunsClientError("Hermes completed run is missing usage data");
  }

  return {
    runId,
    status,
    sessionId: optionalString(value.session_id, "session_id"),
    output,
    error,
    usage
  };
}

function validateHeaderValue(value: string, field: string, maxLength: number): string {
  if (!value.trim()) throw new Error(`${field} must be a non-empty string`);
  if (value.length > maxLength) throw new Error(`${field} exceeds ${maxLength} characters`);
  if (/[\u0000-\u001F\u007F]/.test(value)) throw new Error(`${field} contains control characters`);
  return value;
}

function validateApiKey(value: string): string {
  const key = validateHeaderValue(value, "Hermes apiKey", 8_192);
  if (key.length < 16) throw new Error("Hermes apiKey must contain at least 16 characters");
  return key;
}

function positiveInteger(value: number | undefined, fallback: number, field: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return resolved;
}

function safeRemoteError(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const candidate = isRecord(value.error) ? value.error.message : value.error;
  if (typeof candidate !== "string" || !candidate.trim()) return null;
  return candidate.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

export class HermesRunsClient {
  private readonly baseUrl: URL;
  private readonly apiKey: string;
  private readonly profile: string;
  private readonly profilePathPrefix: boolean;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly fetch: HermesFetch;
  private readonly sleep: HermesSleep;
  private readonly now: () => number;

  constructor(options: HermesRunsClientOptions) {
    const baseUrl = new URL(options.baseUrl);
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
      throw new Error("Hermes baseUrl must use http or https");
    }
    const loopback = baseUrl.hostname === "127.0.0.1"
      || baseUrl.hostname === "localhost"
      || baseUrl.hostname === "[::1]";
    if (baseUrl.protocol === "http:" && !loopback) {
      throw new Error("A non-loopback Hermes baseUrl must use https");
    }
    if (baseUrl.username || baseUrl.password) {
      throw new Error("Hermes baseUrl must not contain credentials");
    }
    if (!PROFILE_NAME.test(options.profile)) {
      throw new Error("Hermes profile must contain only letters, numbers, hyphens, or underscores");
    }

    this.baseUrl = baseUrl;
    this.apiKey = validateApiKey(options.apiKey);
    this.profile = options.profile;
    this.profilePathPrefix = options.profilePathPrefix ?? false;
    this.pollIntervalMs = positiveInteger(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, "pollIntervalMs");
    this.timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  async start(request: HermesRunRequest): Promise<string> {
    const headers = this.headers();
    headers.set("X-Hermes-Session-Key", validateHeaderValue(request.sessionKey, "sessionKey", 256));
    headers.set("Idempotency-Key", validateHeaderValue(request.idempotencyKey, "idempotencyKey", 512));
    const response = await this.requestJson(this.runsUrl(), {
      method: "POST",
      headers,
      body: JSON.stringify({
        input: requiredInput(request.input, "input"),
        session_id: requiredInput(request.sessionId, "sessionId"),
        instructions: requiredInput(request.instructions, "instructions")
      })
    });
    return parseStartResponse(response);
  }

  async get(runId: string): Promise<HermesRunSnapshot> {
    const normalizedRunId = validatePathId(runId, "runId");
    const response = await this.requestJson(this.runUrl(normalizedRunId), {
      method: "GET",
      headers: this.headers()
    });
    return parseRunSnapshot(response, normalizedRunId);
  }

  async stop(runId: string): Promise<void> {
    const normalizedRunId = validatePathId(runId, "runId");
    const response = await this.requestJson(this.runUrl(normalizedRunId, "/stop"), {
      method: "POST",
      headers: this.headers()
    });
    if (!isRecord(response)) throw new HermesRunsClientError("Hermes stop response must be an object");
    if (requiredString(response.run_id, "run_id") !== normalizedRunId || response.status !== "stopping") {
      throw new HermesRunsClientError("Hermes stop response did not confirm the requested run");
    }
  }

  async run(request: HermesRunRequest): Promise<HermesCompletedRun> {
    const startedAt = this.now();
    const runId = await this.start(request);

    while (true) {
      const snapshot = await this.get(runId);
      if (snapshot.status === "completed") {
        return {
          runId,
          sessionId: snapshot.sessionId,
          output: snapshot.output as string,
          usage: snapshot.usage as HermesRunUsage
        };
      }
      if (snapshot.status === "failed") {
        throw new HermesRunsClientError(`Hermes run ${runId} failed: ${snapshot.error ?? "no error detail"}`);
      }
      if (snapshot.status === "cancelled") {
        throw new HermesRunsClientError(`Hermes run ${runId} was cancelled`);
      }
      if (snapshot.status === "waiting_for_approval") {
        try {
          await this.stop(runId);
        } catch (error) {
          throw new HermesRunApprovalRequiredError(runId, false, error);
        }
        throw new HermesRunApprovalRequiredError(runId, true);
      }
      if (this.now() - startedAt >= this.timeoutMs) {
        try {
          await this.stop(runId);
        } catch (error) {
          throw new HermesRunsClientError(
            `Hermes run ${runId} exceeded ${this.timeoutMs}ms and its stop request failed`,
            { cause: error }
          );
        }
        throw new HermesRunsClientError(
          `Hermes run ${runId} exceeded ${this.timeoutMs}ms; a stop request was accepted`
        );
      }
      await this.sleep(this.pollIntervalMs);
    }
  }

  private headers(): Headers {
    return new Headers({
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json"
    });
  }

  private runsUrl(): URL {
    return this.endpoint("/v1/runs");
  }

  private runUrl(runId: string, suffix = ""): URL {
    return this.endpoint(`/v1/runs/${encodeURIComponent(runId)}${suffix}`);
  }

  private endpoint(resourcePath: string): URL {
    const url = new URL(this.baseUrl);
    const basePath = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    const profilePrefix = this.profilePathPrefix ? `/p/${encodeURIComponent(this.profile)}` : "";
    url.pathname = `${basePath}${profilePrefix}${resourcePath}`;
    url.search = "";
    url.hash = "";
    return url;
  }

  private async requestJson(url: URL, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetch(url.toString(), init);
    } catch (error) {
      throw new HermesRunsClientError(`Hermes request failed for ${init.method ?? "GET"} ${url.pathname}`, {
        cause: error
      });
    }

    let raw: string;
    try {
      raw = await response.text();
    } catch (error) {
      throw new HermesRunsClientError(`Could not read Hermes response for ${url.pathname}`, { cause: error });
    }

    let value: unknown = null;
    if (raw.trim()) {
      try {
        value = JSON.parse(raw) as unknown;
      } catch (error) {
        if (response.ok) {
          throw new HermesRunsClientError(`Hermes returned invalid JSON for ${url.pathname}`, { cause: error });
        }
      }
    }

    if (!response.ok) {
      const detail = safeRemoteError(value);
      throw new HermesRunsClientError(
        `Hermes request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`
      );
    }
    if (value === null) throw new HermesRunsClientError(`Hermes returned an empty response for ${url.pathname}`);
    return value;
  }
}

function requiredInput(value: string, field: string): string {
  if (!value.trim()) throw new Error(`Hermes run ${field} must be a non-empty string`);
  return value;
}

function validatePathId(value: string, field: string): string {
  if (!value.trim()) throw new Error(`${field} must be a non-empty string`);
  if (value.length > 512) throw new Error(`${field} exceeds 512 characters`);
  if (/[\u0000-\u001F\u007F]/.test(value)) throw new Error(`${field} contains control characters`);
  return value;
}
