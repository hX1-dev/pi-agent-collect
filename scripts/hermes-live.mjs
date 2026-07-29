#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, chmod, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hermesBinary = path.join(root, ".upstream", "hermes-agent", ".venv", "bin", "hermes");
const templateConfig = path.join(root, "config", "hermes", "config.yaml");
const keychainService = "com.northstar.deepseek";
const keychainAccount = "northstar-hermes-pilot";

const profiles = [
  { name: "ceo", port: 8701 },
  { name: "social-manager", port: 8710 },
  { name: "engineering-manager", port: 8720 },
  { name: "life-manager", port: 8730 }
];

const children = new Set();
let shuttingDown = false;

function fail(message) {
  throw new Error(message);
}

async function exists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function readDeepSeekKey() {
  const fromEnvironment = process.env.DEEPSEEK_API_KEY?.trim();
  if (fromEnvironment) return fromEnvironment;

  if (process.platform !== "darwin") {
    fail("DEEPSEEK_API_KEY is not set. On Linux, inject it through the service secret environment.");
  }

  const result = spawnSync(
    "/usr/bin/security",
    ["find-generic-password", "-a", keychainAccount, "-s", keychainService, "-w"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const key = result.status === 0 ? result.stdout.trim() : "";
  if (!key) {
    fail(
      "DeepSeek key is missing from macOS Keychain. Store it interactively with "
        + "`security add-generic-password -U -a northstar-hermes-pilot "
        + "-s com.northstar.deepseek -w`."
    );
  }
  return key;
}

async function seedProfile(profile) {
  const home = path.join(root, ".data", "hermes", profile.name);
  const configPath = path.join(home, "config.yaml");
  const soulPath = path.join(home, "SOUL.md");
  const soulTemplate = path.join(root, "config", "hermes", "souls", `${profile.name}.md`);

  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(home, 0o700);
  if (!(await exists(configPath))) await copyFile(templateConfig, configPath);
  if (!(await exists(soulPath))) await copyFile(soulTemplate, soulPath);
  await chmod(configPath, 0o600);
  await chmod(soulPath, 0o600);
  return home;
}

function prefixLines(stream, label, destination) {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line) destination.write(`[${label}] ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (pending) destination.write(`[${label}] ${pending}\n`);
  });
}

function track(child) {
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

async function waitForHealth(profile, child, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${profile.port}/health`;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      fail(`Hermes ${profile.name} exited before becoming healthy (exit ${child.exitCode}).`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Startup races are expected while the gateway imports its adapters.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(`Hermes ${profile.name} did not become healthy on port ${profile.port}.`);
}

async function assertPortUnused(profile) {
  try {
    const response = await fetch(`http://127.0.0.1:${profile.port}/health`, {
      signal: AbortSignal.timeout(500)
    });
    if (response.ok) fail(`Port ${profile.port} already has a Hermes-compatible service.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already has")) throw error;
  }
}

async function startGateway(profile, deepSeekKey) {
  await assertPortUnused(profile);
  const home = await seedProfile(profile);
  const gatewayKey = randomBytes(32).toString("hex");
  const env = {
    ...process.env,
    HERMES_HOME: home,
    DEEPSEEK_API_KEY: deepSeekKey,
    API_SERVER_ENABLED: "true",
    API_SERVER_HOST: "127.0.0.1",
    API_SERVER_PORT: String(profile.port),
    API_SERVER_KEY: gatewayKey,
    API_SERVER_MODEL_NAME: profile.name,
    PYTHONUNBUFFERED: "1",
    NO_COLOR: "1"
  };

  const child = track(spawn(hermesBinary, ["gateway", "run"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  }));
  child.once("error", (error) => {
    process.stderr.write(`[${profile.name}] failed to start: ${error.message}\n`);
  });
  prefixLines(child.stdout, profile.name, process.stdout);
  prefixLines(child.stderr, profile.name, process.stderr);
  await waitForHealth(profile, child);
  return { profile, child, gatewayKey };
}

async function stopChildren() {
  if (shuttingDown) return;
  shuttingDown = true;
  const running = [...children];
  for (const child of running) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  await Promise.race([
    Promise.all(running.map((child) => new Promise((resolve) => child.once("exit", resolve)))),
    new Promise((resolve) => setTimeout(resolve, 5_000))
  ]);
  for (const child of running) {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

async function smoke() {
  const deepSeekKey = readDeepSeekKey();
  const gateway = await startGateway(profiles[0], deepSeekKey);
  const { HermesRunsClient } = await import(pathToFileURL(
    path.join(root, "apps", "server", "dist", "infrastructure", "hermes", "hermes-runs-client.js")
  ).href);
  const client = new HermesRunsClient({
    baseUrl: `http://127.0.0.1:${gateway.profile.port}`,
    apiKey: gateway.gatewayKey,
    profile: gateway.profile.name,
    pollIntervalMs: 250,
    timeoutMs: 120_000
  });

  const id = randomUUID();
  const result = await client.run({
    input: "这是 Northstar 的 DeepSeek 连通测试。请用一句简短中文确认你已经上线。",
    instructions: "You are Avery. Do not use tools. Reply with one short Chinese sentence only.",
    sessionId: `smoke-${id}`,
    sessionKey: "northstar:pilot:agent:ceo",
    idempotencyKey: `northstar-hermes-smoke-${id}`
  });

  process.stdout.write("\nDeepSeek-backed Hermes CEO smoke passed.\n");
  process.stdout.write(`Run: ${result.runId}\n`);
  process.stdout.write(`Output: ${result.output.trim()}\n`);
  process.stdout.write(
    `Usage: ${result.usage.inputTokens} input + ${result.usage.outputTokens} output = ${result.usage.totalTokens} tokens\n`
  );
}

function northstarEnvironment(gateways) {
  const environment = { ...process.env };
  delete environment.DEEPSEEK_API_KEY;
  environment.HERMES_EXECUTION_MODE = "live";
  environment.HERMES_PROFILE_ENDPOINTS_JSON = JSON.stringify(Object.fromEntries(
    gateways.map(({ profile, gatewayKey }) => [
      profile.name,
      { baseUrl: `http://127.0.0.1:${profile.port}`, apiKey: gatewayKey }
    ])
  ));
  return environment;
}

async function company() {
  const deepSeekKey = readDeepSeekKey();
  const gateways = [];
  for (const profile of profiles) gateways.push(await startGateway(profile, deepSeekKey));

  process.stdout.write("\nHermes CEO + 3 managers are ready with DeepSeek V4 Flash.\n");
  process.stdout.write("Starting Northstar, LangGraph, and the Board chat at http://127.0.0.1:3000/\n\n");

  const app = track(spawn("npm", ["run", "dev:chat"], {
    cwd: root,
    env: northstarEnvironment(gateways),
    stdio: "inherit"
  }));
  const exitCode = await new Promise((resolve, reject) => {
    app.once("error", reject);
    app.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  process.exitCode = exitCode;
}

async function main() {
  await access(hermesBinary, fsConstants.X_OK).catch(() => {
    fail("Hermes runtime is missing. Run `uv sync --project .upstream/hermes-agent --extra messaging --locked` first.");
  });

  const command = process.argv[2] ?? "smoke";
  if (command === "smoke") await smoke();
  else if (command === "company") await company();
  else fail("Usage: node scripts/hermes-live.mjs <smoke|company>");
}

process.once("SIGINT", () => void stopChildren().finally(() => process.exit(130)));
process.once("SIGTERM", () => void stopChildren().finally(() => process.exit(143)));

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await stopChildren();
}
