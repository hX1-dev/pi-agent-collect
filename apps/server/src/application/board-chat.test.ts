import assert from "node:assert/strict";
import test from "node:test";
import { HumanMessage, isAIMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { OrganizationRepository } from "../infrastructure/database.js";
import { MockAgentRuntime } from "../infrastructure/hermes/mock-agent-runtime.js";
import {
  BoardChatCoordinator,
  type BoardChatDirective,
  type BoardChatHandler,
  type BoardChatOutcome
} from "./orchestration/board-chat-coordinator.js";
import { createBoardChatGraph } from "./orchestration/board-chat-graph.js";
import { CompanyOrchestrator } from "./orchestration/company-orchestrator.js";

class RecordingBoardChatHandler implements BoardChatHandler {
  readonly requests: BoardChatDirective[] = [];

  async handleDirective(input: BoardChatDirective): Promise<BoardChatOutcome> {
    this.requests.push(input);
    return {
      rootTaskId: "task-1",
      title: input.text,
      orchestrationId: "orchestration-1",
      summary: "3 manager(s) assigned 12 specialist deliverable(s).",
      departments: [
        { teamName: "Social Studio", managerName: "Mira", workerCount: 4 },
        { teamName: "Product Lab", managerName: "Kai", workerCount: 4 },
        { teamName: "Life Office", managerName: "Rowan", workerCount: 4 }
      ]
    };
  }
}

test("turns a human board message into one visible Avery response", async () => {
  const handler = new RecordingBoardChatHandler();
  const graph = createBoardChatGraph(handler);
  const state = await graph.invoke({
    messages: [new HumanMessage({ id: "message-1", content: "Plan the company launch" })]
  }, {
    configurable: { thread_id: "thread-1" }
  });

  assert.deepEqual(handler.requests, [{
    threadId: "thread-1",
    messageId: "message-1",
    text: "Plan the company launch"
  }]);
  assert.equal(state.messages.length, 2);
  const response = state.messages[1];
  assert.ok(response && isAIMessage(response));
  assert.match(response.text, /Avery/);
  assert.match(response.text, /3 位部门经理向 12 位专员/);
  assert.match(response.text, /不会自动发布/);
});

test("requires the LangGraph thread identity at the board boundary", async () => {
  const graph = createBoardChatGraph(new RecordingBoardChatHandler());
  await assert.rejects(graph.invoke({
    messages: [new HumanMessage({ id: "message-1", content: "Plan the company launch" })]
  }), /threadId/);
});

test("maps one chat message to one durable company directive across retries", async () => {
  const repository = new OrganizationRepository({
    databasePath: ":memory:",
    maxConcurrency: 2,
    usageSource: "unknown"
  });
  const orchestrator = new CompanyOrchestrator(repository, new MockAgentRuntime(), new MemorySaver());
  const coordinator = new BoardChatCoordinator(repository, orchestrator);
  const initialTaskCount = repository.getDashboard().tasks.length;

  const first = await coordinator.handleDirective({
    threadId: "thread-stable",
    messageId: "message-stable",
    text: "请三个部门准备一份公司启动计划"
  });
  const countAfterFirstTurn = repository.getDashboard().tasks.length;
  const repeated = await coordinator.handleDirective({
    threadId: "thread-stable",
    messageId: "message-stable",
    text: "请三个部门准备一份公司启动计划"
  });

  assert.equal(first.rootTaskId, repeated.rootTaskId);
  assert.equal(first.orchestrationId, repeated.orchestrationId);
  assert.equal(first.departments.length, 3);
  assert.equal(first.departments.reduce((sum, department) => sum + department.workerCount, 0), 12);
  assert.equal(countAfterFirstTurn, initialTaskCount + 16);
  assert.equal(repository.getDashboard().tasks.length, countAfterFirstTurn);
  await assert.rejects(coordinator.handleDirective({
    threadId: "thread-stable",
    messageId: "message-stable",
    text: "A different directive must not reuse the same message identity"
  }), /cannot be reused with different content/);
  assert.equal(repository.getDashboard().tasks.length, countAfterFirstTurn);
  repository.close();
});
