import type { Id } from "./types.js";

export type StudioStatus = "draft" | "ready" | "active" | "suspended" | "retired";

export type StudioInstanceStatus =
  | "pending_enrollment"
  | "online"
  | "degraded"
  | "offline"
  | "revoked";

export type HeartbeatFreshness = "unknown" | "fresh" | "stale" | "offline";
export type HealthLevel = "unknown" | "healthy" | "degraded" | "unavailable";
export type VmLifecycleStatus =
  | "unknown"
  | "stopped"
  | "starting"
  | "running"
  | "suspended"
  | "stopping"
  | "error";

export interface Studio {
  id: Id;
  companyId: Id;
  key: string;
  name: string;
  purpose: string;
  managerAgentId: Id;
  sortOrder: number;
  status: StudioStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * A Studio instance is the replaceable runtime home of a durable Studio.
 * Provider process and VM identifiers must never be used as the Studio ID.
 */
export interface StudioInstance {
  id: Id;
  studioId: Id;
  generation: number;
  status: StudioInstanceStatus;
  vmProviderInstanceId: string | null;
  credentialVersion: number;
  enrolledAt: string | null;
  lastHeartbeatAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudioComponentHealth {
  vm: HealthLevel;
  northstarHost: HealthLevel;
  hermes: HealthLevel;
  sandbox: HealthLevel;
}

export interface StudioHealth {
  studioId: Id;
  instanceId: Id | null;
  observedAt: string;
  lastHeartbeatAt: string | null;
  heartbeatFreshness: HeartbeatFreshness;
  overall: HealthLevel;
  vmLifecycle: VmLifecycleStatus;
  components: StudioComponentHealth;
  disk: {
    usedBytes: number | null;
    capacityBytes: number | null;
  };
  queue: {
    activeJobs: number;
    waitingJobs: number;
  };
  hostVersion: string | null;
}

export interface StudioOperationalSnapshot {
  studio: Studio;
  instances: StudioInstance[];
  health: StudioHealth;
}

export interface StudioHeartbeatReport {
  idempotencyKey: string;
  reportedAt: string;
  vmLifecycle: VmLifecycleStatus;
  components: StudioComponentHealth;
  disk: {
    usedBytes: number | null;
    capacityBytes: number | null;
  };
  queue: {
    activeJobs: number;
    waitingJobs: number;
  };
  hostVersion: string | null;
}

export type JobLeaseStatus = "active" | "released" | "cancelled";

export interface JobLease {
  id: Id;
  studioId: Id;
  instanceId: Id;
  taskId: Id;
  runId: Id;
  status: JobLeaseStatus;
  issuedAt: string;
  renewedAt: string;
  expiresAt: string;
  releasedAt: string | null;
}

export type ArtifactKind =
  | "log"
  | "report"
  | "screenshot"
  | "recording"
  | "source_archive"
  | "editable_project"
  | "video"
  | "other";

export type ArtifactStatus = "declared" | "available" | "rejected" | "deleted";

/**
 * Large artifact bytes stay outside SQLite. storageKey is an internal,
 * controller-issued reference rather than a guest-supplied filesystem path.
 */
export interface ArtifactMetadata {
  id: Id;
  studioId: Id;
  taskId: Id;
  runId: Id;
  kind: ArtifactKind;
  status: ArtifactStatus;
  name: string;
  mediaType: string;
  byteSize: number | null;
  sha256: string | null;
  storageKey: string | null;
  createdAt: string;
  availableAt: string | null;
}

export const studioTransitions: Record<StudioStatus, readonly StudioStatus[]> = {
  draft: ["ready", "retired"],
  ready: ["active", "suspended", "retired"],
  active: ["suspended", "retired"],
  suspended: ["ready", "active", "retired"],
  retired: []
};

export const studioInstanceTransitions: Record<
  StudioInstanceStatus,
  readonly StudioInstanceStatus[]
> = {
  pending_enrollment: ["online", "degraded", "revoked"],
  online: ["degraded", "offline", "revoked"],
  degraded: ["online", "offline", "revoked"],
  offline: ["online", "degraded", "revoked"],
  revoked: []
};

export function canTransitionStudio(from: StudioStatus, to: StudioStatus): boolean {
  return studioTransitions[from].includes(to);
}

export function assertStudioTransition(from: StudioStatus, to: StudioStatus): void {
  if (!canTransitionStudio(from, to)) {
    throw new Error(`Invalid Studio transition: ${from} -> ${to}`);
  }
}

export function canTransitionStudioInstance(
  from: StudioInstanceStatus,
  to: StudioInstanceStatus
): boolean {
  return studioInstanceTransitions[from].includes(to);
}

export function assertStudioInstanceTransition(
  from: StudioInstanceStatus,
  to: StudioInstanceStatus
): void {
  if (!canTransitionStudioInstance(from, to)) {
    throw new Error(`Invalid Studio instance transition: ${from} -> ${to}`);
  }
}

export interface HeartbeatFreshnessInput {
  lastHeartbeatAt: string | null;
  observedAt: string;
  staleAfterMs: number;
  offlineAfterMs: number;
}

function timestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a valid timestamp`);
  return parsed;
}

function positiveDuration(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
}

export function evaluateHeartbeatFreshness(
  input: HeartbeatFreshnessInput
): HeartbeatFreshness {
  positiveDuration(input.staleAfterMs, "staleAfterMs");
  positiveDuration(input.offlineAfterMs, "offlineAfterMs");
  if (input.offlineAfterMs < input.staleAfterMs) {
    throw new Error("offlineAfterMs must be greater than or equal to staleAfterMs");
  }
  if (input.lastHeartbeatAt === null) return "unknown";

  const observedAt = timestamp(input.observedAt, "observedAt");
  const lastHeartbeatAt = timestamp(input.lastHeartbeatAt, "lastHeartbeatAt");
  const ageMs = Math.max(0, observedAt - lastHeartbeatAt);

  if (ageMs >= input.offlineAfterMs) return "offline";
  if (ageMs >= input.staleAfterMs) return "stale";
  return "fresh";
}

export function isJobLeaseExpired(lease: JobLease, observedAt: string): boolean {
  if (lease.status !== "active") return false;
  return timestamp(observedAt, "observedAt") >= timestamp(lease.expiresAt, "lease.expiresAt");
}
