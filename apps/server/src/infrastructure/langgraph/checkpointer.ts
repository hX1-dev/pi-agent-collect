import { mkdirSync } from "node:fs";
import path from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

export function createLangGraphCheckpointer(databasePath: string): SqliteSaver {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  return SqliteSaver.fromConnString(databasePath);
}
