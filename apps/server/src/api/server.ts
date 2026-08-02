import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { CreateDirectiveInput } from "@private-ai-org/core";
import { z } from "zod/v4";
import type { BoardChatHandler } from "../application/orchestration/board-chat-coordinator.js";
import {
  StudioService,
  StudioVmOperationInProgressError
} from "../application/studio-service.js";
import {
  VmLifecycleServiceError,
  type VmLifecycleAccessSnapshot,
  type VmLifecycleEvidenceBundle,
  type VmLifecycleExecutionResult,
  type VmLifecycleSmokeCheck
} from "../application/vm-lifecycle-service.js";
import type { VmObservation } from "../application/vm-provider-port.js";
import { OrganizationRepository } from "../infrastructure/database.js";

interface TaskDispatcher {
  dispatch(taskId: string): unknown;
}

interface TaskOrchestrator {
  orchestrate(taskId: string): Promise<unknown>;
}

interface VmLifecycleController {
  observe(studioId: string, studioInstanceId: string): Promise<VmObservation>;
  execute(input: {
    studioId: string;
    studioInstanceId: string;
    idempotencyKey: string;
    action: "start" | "stop" | "suspend" | "resume";
  }): Promise<VmLifecycleExecutionResult>;
}

interface VmLifecycleEvidenceController {
  read(studioId: string, studioInstanceId: string): VmLifecycleEvidenceBundle;
}

interface VmLifecycleAccessController {
  read(studioId: string, studioInstanceId: string): VmLifecycleAccessSnapshot;
}

interface VmLifecycleSmokeCheckController {
  check(
    studioId: string,
    studioInstanceId: string,
    sessionPrefix: string
  ): VmLifecycleSmokeCheck;
}

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

const boardTurnSchema = z.object({
  threadId: z.string().trim().min(1).max(512),
  messageId: z.string().trim().min(1).max(512),
  text: z.string().trim().min(1).max(8_000)
}).strict();
const entityIdSchema = z.string().trim().min(1).max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const directiveSchema = z.object({
  title: z.string().trim().min(1).max(180),
  brief: z.string().trim().min(1).max(8_000),
  studioId: entityIdSchema.nullable().optional(),
  teamId: entityIdSchema.nullable().optional(),
  priority: z.enum(["low", "normal", "high", "critical"]).optional(),
  risk: z.enum(["green", "yellow", "red"]).optional()
}).strict().refine(
  (directive) => !(directive.studioId && directive.teamId),
  { message: "A directive cannot target both a Studio and a legacy Team" }
);
const studioSchema = z.object({
  id: entityIdSchema.optional(),
  key: z.string().trim().min(2).max(64).regex(/^[a-z][a-z0-9-]+$/),
  name: z.string().trim().min(1).max(120),
  purpose: z.string().trim().min(1).max(2_000),
  managerAgentId: entityIdSchema,
  sortOrder: z.number().int().min(0).max(10_000).optional()
}).strict();
const studioInstanceSchema = z.object({
  id: entityIdSchema.optional(),
  vmProviderInstanceId: z.string().trim().min(1).max(1_024).nullable().optional(),
  replaceCurrent: z.boolean().optional().default(false)
}).strict();
const studioStatusSchema = z.object({
  status: z.enum(["draft", "ready", "active", "suspended", "retired"])
}).strict();
const vmLifecycleActionSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  action: z.enum(["start", "stop", "suspend", "resume"])
}).strict();
const vmLifecycleSmokeSessionPrefixSchema = z.string().trim().min(1).max(96)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const offlineObservationSchema = z.object({
  observedAt: z.string().datetime({ offset: true })
}).strict();
const healthLevelSchema = z.enum(["unknown", "healthy", "degraded", "unavailable"]);
const heartbeatDiskSchema = z.object({
  usedBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  capacityBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable()
}).strict().superRefine((disk, context) => {
  if (
    disk.usedBytes !== null
    && disk.capacityBytes !== null
    && disk.usedBytes > disk.capacityBytes
  ) {
    context.addIssue({
      code: "custom",
      message: "usedBytes must not exceed capacityBytes"
    });
  }
});
const studioHeartbeatSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  reportedAt: z.string().datetime({ offset: true }),
  vmLifecycle: z.enum([
    "unknown",
    "stopped",
    "starting",
    "running",
    "suspended",
    "stopping",
    "error"
  ]),
  components: z.object({
    vm: healthLevelSchema,
    northstarHost: healthLevelSchema,
    hermes: healthLevelSchema,
    sandbox: healthLevelSchema
  }).strict(),
  disk: heartbeatDiskSchema,
  queue: z.object({
    activeJobs: z.number().int().nonnegative().max(10_000),
    waitingJobs: z.number().int().nonnegative().max(10_000)
  }).strict(),
  hostVersion: z.string().trim().min(1).max(128).nullable()
}).strict();

function decodeEntityId(value: string): string {
  return entityIdSchema.parse(decodeURIComponent(value));
}

function apiError(error: unknown): {
  status: number;
  body: { error: string; code: string };
} {
  if (error instanceof z.ZodError) {
    return {
      status: 400,
      body: { error: "Request validation failed", code: "INVALID_REQUEST" }
    };
  }
  if (error instanceof SyntaxError) {
    return {
      status: 400,
      body: { error: "Request body must be valid JSON", code: "INVALID_JSON" }
    };
  }
  if (error instanceof StudioVmOperationInProgressError) {
    return {
      status: 409,
      body: { error: error.message, code: error.code }
    };
  }
  if (error instanceof VmLifecycleServiceError) {
    if (
      error.code === "VM_ACTIONS_NOT_ARMED"
      || error.code === "VM_ACTIONS_ARMING_EXPIRED"
    ) {
      return {
        status: 403,
        body: { error: error.message, code: error.code }
      };
    }
    if (
      error.code === "VM_OPERATION_IN_PROGRESS"
      || error.code === "VM_OPERATION_INDETERMINATE"
    ) {
      return {
        status: 409,
        body: { error: error.message, code: error.code }
      };
    }
    return {
      status: 502,
      body: { error: error.message, code: error.code }
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("vmware lifecycle is not configured")) {
    return {
      status: 503,
      body: { error: message, code: "VM_NOT_CONFIGURED" }
    };
  }
  if (normalized.includes("no configured vm provider target")) {
    return {
      status: 409,
      body: { error: message, code: "VM_TARGET_NOT_CONFIGURED" }
    };
  }
  if (normalized.includes("not found") || normalized.includes("does not belong")) {
    return { status: 404, body: { error: message, code: "NOT_FOUND" } };
  }
  if (
    normalized.includes("already has")
    || normalized.includes("unique constraint")
    || normalized.includes("idempotency key")
    || normalized.includes("invalid studio")
    || normalized.includes("revoked")
    || normalized.includes("must advance")
  ) {
    return { status: 409, body: { error: message, code: "CONFLICT" } };
  }
  return { status: 400, body: { error: message, code: "BAD_REQUEST" } };
}

export function createApiServer(
  repository: OrganizationRepository,
  broker: TaskDispatcher,
  orchestrator: TaskOrchestrator,
  boardChat: BoardChatHandler,
  studios: StudioService,
  vmLifecycle: VmLifecycleController | null,
  vmLifecycleEvidence: VmLifecycleEvidenceController,
  vmLifecycleAccess: VmLifecycleAccessController,
  vmLifecycleSmokeCheck: VmLifecycleSmokeCheckController
) {
  return createServer(async (request, response) => {
    if (!request.url || !request.method) {
      sendJson(response, 400, { error: "Invalid request" });
      return;
    }
    const url = new URL(request.url, "http://localhost");
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        assertLocalMutation(request);
      }
      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, { ok: true, service: "private-ai-organization" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/dashboard") {
        sendJson(response, 200, repository.getDashboard());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/studios") {
        sendJson(response, 200, studios.listOperationalSnapshots());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/studios") {
        const body = studioSchema.parse(await readJson(request));
        const snapshot = studios.createStudio({
          ...(body.id ? { id: body.id } : {}),
          key: body.key,
          name: body.name,
          purpose: body.purpose,
          managerAgentId: body.managerAgentId,
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {})
        });
        sendJson(response, 201, snapshot);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/studios/observe-offline") {
        const body = offlineObservationSchema.parse(await readJson(request));
        sendJson(response, 200, {
          observedAt: body.observedAt,
          changed: studios.observeOffline(body.observedAt)
        });
        return;
      }

      const studioStatusMatch = routeMatch(
        url.pathname,
        /^\/api\/studios\/([^/]+)\/status$/
      );
      if (request.method === "PATCH" && studioStatusMatch?.[1]) {
        const studioId = decodeEntityId(studioStatusMatch[1]);
        const body = studioStatusSchema.parse(await readJson(request));
        sendJson(response, 200, studios.transitionStudio(studioId, body.status));
        return;
      }

      const studioInstanceMatch = routeMatch(
        url.pathname,
        /^\/api\/studios\/([^/]+)\/instances$/
      );
      if (request.method === "POST" && studioInstanceMatch?.[1]) {
        const studioId = decodeEntityId(studioInstanceMatch[1]);
        const body = studioInstanceSchema.parse(await readJson(request));
        const instance = studios.createInstance({
          ...(body.id ? { id: body.id } : {}),
          studioId,
          ...(body.vmProviderInstanceId !== undefined
            ? { vmProviderInstanceId: body.vmProviderInstanceId }
            : {}),
          replaceCurrent: body.replaceCurrent
        });
        sendJson(response, 201, instance);
        return;
      }

      const heartbeatMatch = routeMatch(
        url.pathname,
        /^\/api\/studios\/([^/]+)\/instances\/([^/]+)\/heartbeat$/
      );
      if (request.method === "POST" && heartbeatMatch?.[1] && heartbeatMatch[2]) {
        const studioId = decodeEntityId(heartbeatMatch[1]);
        const instanceId = decodeEntityId(heartbeatMatch[2]);
        const report = studioHeartbeatSchema.parse(await readJson(request));
        if (Date.parse(report.reportedAt) > Date.now() + 5 * 60_000) {
          throw new Error("Heartbeat reportedAt is too far in the future");
        }
        sendJson(response, 200, studios.recordHeartbeat({
          studioId,
          instanceId,
          report
        }));
        return;
      }

      const vmLifecycleMatch = routeMatch(
        url.pathname,
        /^\/api\/studios\/([^/]+)\/instances\/([^/]+)\/vm$/
      );
      if (request.method === "GET" && vmLifecycleMatch?.[1] && vmLifecycleMatch[2]) {
        if (!vmLifecycle) throw new Error("VMware lifecycle is not configured");
        const studioId = decodeEntityId(vmLifecycleMatch[1]);
        const instanceId = decodeEntityId(vmLifecycleMatch[2]);
        sendJson(response, 200, await vmLifecycle.observe(studioId, instanceId));
        return;
      }

      const vmLifecycleEvidenceMatch = routeMatch(
        url.pathname,
        /^\/api\/studios\/([^/]+)\/instances\/([^/]+)\/vm\/evidence$/
      );
      if (
        request.method === "GET"
        && vmLifecycleEvidenceMatch?.[1]
        && vmLifecycleEvidenceMatch[2]
      ) {
        const studioId = decodeEntityId(vmLifecycleEvidenceMatch[1]);
        const instanceId = decodeEntityId(vmLifecycleEvidenceMatch[2]);
        sendJson(
          response,
          200,
          vmLifecycleEvidence.read(studioId, instanceId)
        );
        return;
      }

      const vmLifecycleAccessMatch = routeMatch(
        url.pathname,
        /^\/api\/studios\/([^/]+)\/instances\/([^/]+)\/vm\/access$/
      );
      if (
        request.method === "GET"
        && vmLifecycleAccessMatch?.[1]
        && vmLifecycleAccessMatch[2]
      ) {
        const studioId = decodeEntityId(vmLifecycleAccessMatch[1]);
        const instanceId = decodeEntityId(vmLifecycleAccessMatch[2]);
        sendJson(
          response,
          200,
          vmLifecycleAccess.read(studioId, instanceId)
        );
        return;
      }

      const vmLifecycleActionMatch = routeMatch(
        url.pathname,
        /^\/api\/studios\/([^/]+)\/instances\/([^/]+)\/vm\/actions$/
      );
      if (
        request.method === "POST"
        && vmLifecycleActionMatch?.[1]
        && vmLifecycleActionMatch[2]
      ) {
        if (!vmLifecycle) throw new Error("VMware lifecycle is not configured");
        const studioId = decodeEntityId(vmLifecycleActionMatch[1]);
        const instanceId = decodeEntityId(vmLifecycleActionMatch[2]);
        const body = vmLifecycleActionSchema.parse(await readJson(request));
        sendJson(response, 200, await vmLifecycle.execute({
          studioId,
          studioInstanceId: instanceId,
          idempotencyKey: body.idempotencyKey,
          action: body.action
        }));
        return;
      }

      const vmLifecycleSmokeCheckMatch = routeMatch(
        url.pathname,
        /^\/api\/studios\/([^/]+)\/instances\/([^/]+)\/vm\/smoke-check$/
      );
      if (
        request.method === "GET"
        && vmLifecycleSmokeCheckMatch?.[1]
        && vmLifecycleSmokeCheckMatch[2]
      ) {
        const studioId = decodeEntityId(vmLifecycleSmokeCheckMatch[1]);
        const instanceId = decodeEntityId(vmLifecycleSmokeCheckMatch[2]);
        const sessionPrefix = vmLifecycleSmokeSessionPrefixSchema.parse(
          url.searchParams.get("sessionPrefix")
        );
        sendJson(
          response,
          200,
          vmLifecycleSmokeCheck.check(
            studioId,
            instanceId,
            sessionPrefix
          )
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/directives") {
        const body = directiveSchema.parse(await readJson(request));
        const input: CreateDirectiveInput = {
          title: body.title,
          brief: body.brief,
          studioId: body.studioId ?? null,
          teamId: body.teamId ?? null,
          priority: body.priority ?? "normal",
          risk: body.risk ?? "green"
        };
        const task = repository.createDirective(input);
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
          sendJson(response, 400, {
            error: "Decision must be approved or rejected",
            code: "BAD_REQUEST"
          });
          return;
        }
        const approval = repository.decideApproval(decodeURIComponent(approvalMatch[1]), body.decision);
        sendJson(response, 200, approval);
        return;
      }

      sendJson(response, 404, { error: "Route not found", code: "ROUTE_NOT_FOUND" });
    } catch (error) {
      const mapped = apiError(error);
      sendJson(response, mapped.status, mapped.body);
    }
  });
}
