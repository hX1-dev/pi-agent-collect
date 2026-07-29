import { z } from "zod/v4";
import type {
  BoardChatDirective,
  BoardChatHandler,
  BoardChatOutcome
} from "../application/orchestration/board-chat-coordinator.js";

const boardChatOutcomeSchema = z.object({
  rootTaskId: z.string(),
  title: z.string(),
  orchestrationId: z.string(),
  summary: z.string(),
  departments: z.array(z.object({
    teamName: z.string(),
    managerName: z.string(),
    workerCount: z.number().int().min(1).max(4)
  })).min(1).max(3)
});

export class NorthstarBoardClient implements BoardChatHandler {
  private readonly turnsUrl: URL;

  constructor(baseUrl: string) {
    this.turnsUrl = new URL("/api/board/turns", baseUrl);
  }

  async handleDirective(input: BoardChatDirective): Promise<BoardChatOutcome> {
    const response = await fetch(this.turnsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30 * 60 * 1_000)
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(body);
      throw new Error(error.success ? error.data.error : `Northstar API returned ${response.status}`);
    }
    return boardChatOutcomeSchema.parse(body);
  }
}
