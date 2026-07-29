import path from "node:path";
import { fileURLToPath } from "node:url";

export interface AppConfig {
  port: number;
  dataDir: string;
  databasePath: string;
  executionMode: "mock" | "live";
  maxConcurrency: number;
  executionTimeoutMs: number;
  workspaceRoot: string;
  langGraphCheckpointPath: string;
  hermesProfileEndpoints: Record<string, { baseUrl: string; apiKey: string }>;
  hermesMultiplexEndpoint: { baseUrl: string; apiKey: string } | undefined;
  hermesPollIntervalMs: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));

function parseProfileEndpoints(value: string | undefined): Record<string, { baseUrl: string; apiKey: string }> {
  if (!value?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error("HERMES_PROFILE_ENDPOINTS_JSON must be valid JSON", { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("HERMES_PROFILE_ENDPOINTS_JSON must be an object keyed by runtime profile");
  }
  const endpoints: Record<string, { baseUrl: string; apiKey: string }> = {};
  for (const [profile, endpoint] of Object.entries(parsed)) {
    if (typeof endpoint !== "object" || endpoint === null || Array.isArray(endpoint)) {
      throw new Error(`Hermes endpoint for ${profile} must be an object`);
    }
    const values = endpoint as Record<string, unknown>;
    if (typeof values.baseUrl !== "string" || typeof values.apiKey !== "string") {
      throw new Error(`Hermes endpoint for ${profile} needs baseUrl and apiKey strings`);
    }
    endpoints[profile] = { baseUrl: values.baseUrl, apiKey: values.apiKey };
  }
  return endpoints;
}

try {
  process.loadEnvFile(path.join(projectRoot, ".env"));
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

export function loadConfig(cwd = projectRoot): AppConfig {
  const dataDir = path.resolve(cwd, process.env.AI_ORG_DATA_DIR ?? ".data");
  const executionMode = process.env.HERMES_EXECUTION_MODE === "live" ? "live" : "mock";
  const multiplexBaseUrl = process.env.HERMES_MULTIPLEX_BASE_URL?.trim();
  const multiplexApiKey = process.env.HERMES_MULTIPLEX_API_KEY?.trim();
  if ((multiplexBaseUrl && !multiplexApiKey) || (!multiplexBaseUrl && multiplexApiKey)) {
    throw new Error("HERMES_MULTIPLEX_BASE_URL and HERMES_MULTIPLEX_API_KEY must be set together");
  }

  return {
    port: positiveInteger(process.env.AI_ORG_PORT, 4318),
    dataDir,
    databasePath: path.join(dataDir, "organization.sqlite"),
    langGraphCheckpointPath: path.join(dataDir, "langgraph-checkpoints.sqlite"),
    executionMode,
    maxConcurrency: positiveInteger(process.env.AI_ORG_MAX_CONCURRENCY, 2),
    executionTimeoutMs: positiveInteger(process.env.AI_ORG_EXECUTION_TIMEOUT_MS, 30 * 60 * 1_000),
    workspaceRoot: cwd,
    hermesProfileEndpoints: parseProfileEndpoints(process.env.HERMES_PROFILE_ENDPOINTS_JSON),
    hermesMultiplexEndpoint: multiplexBaseUrl && multiplexApiKey
      ? { baseUrl: multiplexBaseUrl, apiKey: multiplexApiKey }
      : undefined,
    hermesPollIntervalMs: positiveInteger(process.env.HERMES_POLL_INTERVAL_MS, 500)
  };
}
