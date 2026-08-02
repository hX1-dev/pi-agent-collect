import type { VmLifecycleStatus } from "@private-ai-org/core";

export type VmLifecycleAction = "start" | "stop" | "suspend" | "resume";

export interface VmTarget {
  studioInstanceId: string;
  providerInstanceId: string;
}

export interface VmObservation {
  target: VmTarget;
  status: VmLifecycleStatus;
  observedAt: string;
}

export interface VmLifecycleRequest {
  idempotencyKey: string;
  target: VmTarget;
  action: VmLifecycleAction;
}

export interface VmOperationReceipt {
  id: string;
  idempotencyKey: string;
  target: VmTarget;
  action: VmLifecycleAction;
  statusBefore: VmLifecycleStatus;
  statusAfter: VmLifecycleStatus;
  startedAt: string;
  finishedAt: string;
}

export type VmProviderErrorOutcome = "failed" | "indeterminate";

/**
 * Carries a provider diagnostic that the adapter has explicitly sanitized for
 * durable local evidence. The outcome distinguishes a confirmed provider
 * failure from a forced termination whose external side effect is unknown.
 * Unknown errors are never trusted at this boundary.
 */
export class VmProviderError extends Error {
  constructor(
    message: string,
    readonly outcome: VmProviderErrorOutcome = "failed"
  ) {
    super(message);
    this.name = "VmProviderError";
  }
}

export interface VmProviderPort {
  observe(target: VmTarget): Promise<VmObservation>;
  execute(request: VmLifecycleRequest): Promise<VmOperationReceipt>;
}
