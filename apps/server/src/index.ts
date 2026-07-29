import { CompanyOrchestrator } from "./application/orchestration/company-orchestrator.js";
import { BoardChatCoordinator } from "./application/orchestration/board-chat-coordinator.js";
import { AgentRuntimeGate } from "./application/agent-runtime-gate.js";
import { RunBroker } from "./application/run-broker.js";
import { createApiServer } from "./api/server.js";
import { loadConfig } from "./config.js";
import { OrganizationRepository } from "./infrastructure/database.js";
import { AgentRuntimeTaskExecutor } from "./infrastructure/hermes/agent-runtime-task-executor.js";
import { HermesAgentRuntime } from "./infrastructure/hermes/hermes-agent-runtime.js";
import { MockAgentRuntime } from "./infrastructure/hermes/mock-agent-runtime.js";
import { createLangGraphCheckpointer } from "./infrastructure/langgraph/checkpointer.js";

const config = loadConfig();
const repository = new OrganizationRepository({
  databasePath: config.databasePath,
  maxConcurrency: config.maxConcurrency,
  usageSource: config.executionMode === "live" ? "api" : "unknown"
});
const baseRuntime = config.executionMode === "live"
  ? new HermesAgentRuntime({
    profileEndpoints: config.hermesProfileEndpoints,
    ...(config.hermesMultiplexEndpoint ? { multiplexEndpoint: config.hermesMultiplexEndpoint } : {}),
    pollIntervalMs: config.hermesPollIntervalMs,
    timeoutMs: config.executionTimeoutMs
  })
  : new MockAgentRuntime();
const runtime = new AgentRuntimeGate(baseRuntime, config.maxConcurrency, config.workspaceRoot);
const executor = new AgentRuntimeTaskExecutor(runtime, config.executionMode === "live" ? "hermes" : "mock");
const broker = new RunBroker(
  repository,
  executor,
  config.maxConcurrency,
  config.workspaceRoot
);
const checkpointer = createLangGraphCheckpointer(config.langGraphCheckpointPath);
const orchestrator = new CompanyOrchestrator(repository, runtime, checkpointer);
const boardChat = new BoardChatCoordinator(repository, orchestrator);
const server = createApiServer(repository, broker, orchestrator, boardChat);

server.listen(config.port, "127.0.0.1", () => {
  console.log(`Private AI Organization API running at http://127.0.0.1:${config.port}`);
  console.log(`Hermes execution mode: ${config.executionMode}`);
});

function shutdown(): void {
  server.close(() => {
    checkpointer.db.close();
    repository.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
