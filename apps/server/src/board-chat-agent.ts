import { createBoardChatGraph } from "./application/orchestration/board-chat-graph.js";
import { loadConfig } from "./config.js";
import { NorthstarBoardClient } from "./infrastructure/northstar-board-client.js";

const config = loadConfig();
export const graph = createBoardChatGraph(
  new NorthstarBoardClient(`http://127.0.0.1:${config.port}`)
);
