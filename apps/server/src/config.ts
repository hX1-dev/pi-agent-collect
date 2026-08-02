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
  vmwareFusion: {
    vmrunExecutablePath: string;
    studioId: string;
    studioInstanceId: string;
    vmxPath: string;
    actionsArmed: boolean;
    actionsArmedUntil: string | null;
  } | undefined;
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

export function parseVmwareFusionConfig(
  environment: Record<string, string | undefined>,
  now: () => Date = () => new Date()
): AppConfig["vmwareFusion"] {
  const actionsArmedValue = environment.VMWARE_FUSION_ACTIONS_ARMED?.trim();
  if (
    actionsArmedValue !== undefined
    && actionsArmedValue !== ""
    && actionsArmedValue !== "true"
    && actionsArmedValue !== "false"
  ) {
    throw new Error(
      "VMWARE_FUSION_ACTIONS_ARMED must be exactly true or false"
    );
  }
  const actionsArmed = actionsArmedValue === "true";
  const actionsArmedUntilValue =
    environment.VMWARE_FUSION_ACTIONS_ARMED_UNTIL?.trim() || null;
  const entries = {
    vmrunExecutablePath: environment.VMWARE_FUSION_VMRUN_PATH?.trim(),
    studioId: environment.VMWARE_FUSION_STUDIO_ID?.trim(),
    studioInstanceId: environment.VMWARE_FUSION_INSTANCE_ID?.trim(),
    vmxPath: environment.VMWARE_FUSION_VMX_PATH?.trim()
  };
  const configured = Object.values(entries).filter(Boolean).length;
  if (configured === 0) {
    if (actionsArmed || actionsArmedUntilValue) {
      throw new Error(
        "VMware Fusion actions cannot be armed without one complete configured target"
      );
    }
    return undefined;
  }
  if (configured !== Object.keys(entries).length) {
    throw new Error(
      "VMware Fusion lifecycle requires VMRUN_PATH, STUDIO_ID, INSTANCE_ID, and VMX_PATH together"
    );
  }
  if (!actionsArmed && actionsArmedUntilValue) {
    throw new Error(
      "VMWARE_FUSION_ACTIONS_ARMED_UNTIL requires ACTIONS_ARMED=true"
    );
  }
  let actionsArmedUntil: string | null = null;
  if (actionsArmed) {
    if (!actionsArmedUntilValue) {
      throw new Error(
        "VMWARE_FUSION_ACTIONS_ARMED=true requires ACTIONS_ARMED_UNTIL"
      );
    }
    const deadlineMs = Date.parse(actionsArmedUntilValue);
    const nowMs = now().getTime();
    if (!Number.isFinite(deadlineMs)) {
      throw new Error(
        "VMWARE_FUSION_ACTIONS_ARMED_UNTIL must be a valid timestamp"
      );
    }
    if (!Number.isFinite(nowMs)) {
      throw new Error("Northstar cannot evaluate the VMware action window");
    }
    if (deadlineMs <= nowMs) {
      throw new Error(
        "VMWARE_FUSION_ACTIONS_ARMED_UNTIL must be in the future"
      );
    }
    if (deadlineMs - nowMs > 30 * 60_000) {
      throw new Error(
        "VMware Fusion action window must not exceed 30 minutes"
      );
    }
    actionsArmedUntil = new Date(deadlineMs).toISOString();
  }
  return {
    ...(entries as Omit<
      NonNullable<AppConfig["vmwareFusion"]>,
      "actionsArmed" | "actionsArmedUntil"
    >),
    actionsArmed,
    actionsArmedUntil
  };
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
    hermesPollIntervalMs: positiveInteger(process.env.HERMES_POLL_INTERVAL_MS, 500),
    vmwareFusion: parseVmwareFusionConfig(process.env)
  };
}
