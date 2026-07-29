import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { CreateDirectiveInput } from "@private-ai-org/core";
import { z } from "zod/v4";
import { BoardChatCoordinator } from "../application/orchestration/board-chat-coordinator.js";
import { CompanyOrchestrator } from "../application/orchestration/company-orchestrator.js";
import { RunBroker } from "../application/run-broker.js";
import { OrganizationRepository } from "../infrastructure/database.js";

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 65_536) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function routeMatch(pathname: string, expression: RegExp): RegExpMatchArray | null {
  return pathname.match(expression);
}

function isLoopbackAuthority(value: string, kind: "host" | "origin"): boolean {
  try {
    const url = kind === "host" ? new URL(`http://${value}`) : new URL(value);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  } catch {
    return false;
  }
}

function assertLocalMutation(request: IncomingMessage): void {
  const host = request.headers.host;
  if (!host || !isLoopbackAuthority(host, "host")) {
    throw new Error("Mutations are accepted only through a loopback host");
  }
  const origin = request.headers.origin;
  if (origin && !isLoopbackAuthority(origin, "origin")) {
    throw new Error("Mutation origin is not allowed");
  }
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new Error("Mutations require application/json");
  }
}

const priorities = new Set(["low", "normal", "high", "critical"]);
const risks = new Set(["green", "yellow", "red"]);
const boardTurnSchema = z.object({
  threadId: z.string().trim().min(1).max(512),
  messageId: z.string().trim().min(1).max(512),
  text: z.string().trim().min(1).max(8_000)
}).strict();

export function createApiServer(
  repository: OrganizationRepository,
  broker: RunBroker,
  orchestrator: CompanyOrchestrator,
  boardChat: BoardChatCoordinator
) {
  return createServer(async (request, response) => {
    if (!request.url || !request.method) {
      sendJson(response, 400, { error: "Invalid request" });
      return;
    }
    const url = new URL(request.url, "http://localhost");
    try {
      if (request.method === "POST") assertLocalMutation(request);
      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, { ok: true, service: "private-ai-organization" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/dashboard") {
        sendJson(response, 200, repository.getDashboard());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/directives") {
        const body = await readJson(request) as Partial<CreateDirectiveInput>;
        if (body.priority !== undefined && !priorities.has(body.priority)) {
          throw new Error("Unknown directive priority");
        }
        if (body.risk !== undefined && !risks.has(body.risk)) {
          throw new Error("Unknown directive risk level");
        }
        const task = repository.createDirective({
          title: typeof body.title === "string" ? body.title : "",
          brief: typeof body.brief === "string" ? body.brief : "",
          teamId: typeof body.teamId === "string" ? body.teamId : null,
          priority: body.priority ?? "normal",
          risk: body.risk ?? "green"
        });
        void orchestrator.orchestrate(task.id).catch((error) => {
          console.error(`Company orchestration failed for ${task.id}`, error);
        });
        sendJson(response, 201, task);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/board/turns") {
        const body = boardTurnSchema.parse(await readJson(request));
        sendJson(response, 200, await boardChat.handleDirective(body));
        return;
      }

      const orchestrateMatch = routeMatch(url.pathname, /^\/api\/tasks\/([^/]+)\/orchestrate$/);
      if (request.method === "POST" && orchestrateMatch?.[1]) {
        const orchestration = await orchestrator.orchestrate(decodeURIComponent(orchestrateMatch[1]));
        sendJson(response, 200, orchestration);
        return;
      }

      const dispatchMatch = routeMatch(url.pathname, /^\/api\/tasks\/([^/]+)\/dispatch$/);
      if (request.method === "POST" && dispatchMatch?.[1]) {
        const run = broker.dispatch(decodeURIComponent(dispatchMatch[1]));
        sendJson(response, 202, run);
        return;
      }

      const reviewMatch = routeMatch(url.pathname, /^\/api\/tasks\/([^/]+)\/review$/);
      if (request.method === "POST" && reviewMatch?.[1]) {
        const body = await readJson(request) as { decision?: unknown };
        if (body.decision !== "accepted" && body.decision !== "rework") {
          throw new Error("Review decision must be accepted or rework");
        }
        const task = repository.reviewTask(decodeURIComponent(reviewMatch[1]), body.decision);
        sendJson(response, 200, task);
        return;
      }

      const approvalMatch = routeMatch(url.pathname, /^\/api\/approvals\/([^/]+)\/decision$/);
      if (request.method === "POST" && approvalMatch?.[1]) {
        const body = await readJson(request) as { decision?: unknown };
        if (body.decision !== "approved" && body.decision !== "rejected") {
          sendJson(response, 400, { error: "Decision must be approved or rejected" });
          return;
        }
        const approval = repository.decideApproval(decodeURIComponent(approvalMatch[1]), body.decision);
        sendJson(response, 200, approval);
        return;
      }

      sendJson(response, 404, { error: "Route not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 400, { error: message });
    }
  });
}
