import { spawnSync } from "node:child_process";
import type { UsageSummary } from "@private-ai-org/core";

export function detectCodexAuthSource(): UsageSummary["source"] {
  try {
    const result = spawnSync("codex", ["login", "status"], {
      encoding: "utf8",
      timeout: 5_000
    });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (/using ChatGPT/i.test(output)) return "chatgpt";
    if (/API key/i.test(output)) return "api";
  } catch {
    // Authentication is reported as unknown in the UI; execution will surface a concrete error.
  }
  return "unknown";
}
