import { createHash } from "node:crypto";
import { AIMessage, isHumanMessage } from "@langchain/core/messages";
import {
  END,
  MessagesAnnotation,
  START,
  StateGraph,
  type LangGraphRunnableConfig
} from "@langchain/langgraph";
import { z } from "zod/v4";
import type { BoardChatHandler, BoardChatOutcome } from "./board-chat-coordinator.js";

const boardInputSchema = z.object({
  threadId: z.string().trim().min(1).max(512),
  messageId: z.string().trim().min(1).max(512),
  text: z.string().trim().min(1).max(8_000)
});

function formatOutcome(outcome: BoardChatOutcome): string {
  const studioLines = outcome.studios.map((studio) => (
    `- **${studio.studioName}** — ${studio.managerName}，${studio.temporaryWorkerCount} 个临时执行单元`
  ));
  const workerCount = outcome.studios.reduce(
    (sum, studio) => sum + studio.temporaryWorkerCount,
    0
  );
  return [
    `Avery 已接收你的指令：**${outcome.title}**`,
    "",
    ...studioLines,
    "",
    `工作室编排已完成：${outcome.studios.length} 位 Studio Manager 规划了 ${workerCount} 个临时执行单元。`,
    outcome.summary,
    "",
    "目前只创建内部计划与任务，不会自动发布、发消息、改日历或产生付款。"
  ].join("\n");
}

function derivedMessageId(threadId: string, position: number, text: string): string {
  const digest = createHash("sha256").update(`${threadId}\u0000${position}\u0000${text}`).digest("hex");
  return `derived-${digest}`;
}

export function createBoardChatGraph(handler: BoardChatHandler) {
  const receiveDirective = async (
    state: typeof MessagesAnnotation.State,
    config: LangGraphRunnableConfig
  ) => {
    const position = state.messages.findLastIndex((message) => isHumanMessage(message));
    const message = position >= 0 ? state.messages[position] : undefined;
    if (!message || !isHumanMessage(message)) throw new Error("Board chat needs a human message");

    const threadId = config.configurable?.thread_id;
    const parsed = boardInputSchema.parse({
      threadId,
      messageId: message.id ?? (typeof threadId === "string"
        ? derivedMessageId(threadId, position, message.text)
        : ""),
      text: message.text
    });
    const outcome = await handler.handleDirective(parsed);
    return {
      messages: [new AIMessage({
        id: `board-response-${parsed.messageId}`,
        name: "Avery",
        content: formatOutcome(outcome)
      })]
    };
  };

  return new StateGraph(MessagesAnnotation)
    .addNode("receive_directive", receiveDirective)
    .addEdge(START, "receive_directive")
    .addEdge("receive_directive", END)
    .compile();
}
