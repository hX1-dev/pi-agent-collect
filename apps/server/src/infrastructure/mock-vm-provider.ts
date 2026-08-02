import type { VmLifecycleStatus } from "@private-ai-org/core";
import type {
  VmLifecycleAction,
  VmLifecycleRequest,
  VmObservation,
  VmOperationReceipt,
  VmProviderPort,
  VmTarget
} from "../application/vm-provider-port.js";

export interface MockVmProviderOptions {
  targets: Array<{ providerInstanceId: string; status: VmLifecycleStatus }>;
  now?: () => string;
}

const resultingStatus: Record<
  VmLifecycleAction,
  Partial<Record<VmLifecycleStatus, VmLifecycleStatus>>
> = {
  start: { stopped: "running" },
  stop: { running: "stopped", suspended: "stopped" },
  suspend: { running: "suspended" },
  resume: { suspended: "running" }
};

function requestFingerprint(request: VmLifecycleRequest): string {
  return [
    request.target.studioInstanceId,
    request.target.providerInstanceId,
    request.action
  ].join("\n");
}

export class MockVmProvider implements VmProviderPort {
  private readonly states = new Map<string, VmLifecycleStatus>();
  private readonly receipts = new Map<
    string,
    { fingerprint: string; receipt: VmOperationReceipt }
  >();
  private readonly operationHistory: VmOperationReceipt[] = [];
  private readonly now: () => string;

  constructor(options: MockVmProviderOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    for (const target of options.targets) {
      if (!target.providerInstanceId.trim()) {
        throw new Error("Mock VM provider target ID must not be empty");
      }
      if (this.states.has(target.providerInstanceId)) {
        throw new Error(`Duplicate Mock VM provider target: ${target.providerInstanceId}`);
      }
      this.states.set(target.providerInstanceId, target.status);
    }
  }

  async observe(target: VmTarget): Promise<VmObservation> {
    return {
      target,
      status: this.requireStatus(target),
      observedAt: this.now()
    };
  }

  async execute(request: VmLifecycleRequest): Promise<VmOperationReceipt> {
    if (!request.idempotencyKey.trim()) {
      throw new Error("VM lifecycle idempotency key must not be empty");
    }

    const fingerprint = requestFingerprint(request);
    const existing = this.receipts.get(request.idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new Error("VM lifecycle idempotency key was reused for a different request");
      }
      return existing.receipt;
    }

    const statusBefore = this.requireStatus(request.target);
    const statusAfter = resultingStatus[request.action][statusBefore];
    if (!statusAfter) {
      throw new Error(`Invalid VM lifecycle action: ${request.action} from ${statusBefore}`);
    }

    const startedAt = this.now();
    this.states.set(request.target.providerInstanceId, statusAfter);
    const receipt: VmOperationReceipt = {
      id: `mock-vm-operation:${request.idempotencyKey}`,
      idempotencyKey: request.idempotencyKey,
      target: request.target,
      action: request.action,
      statusBefore,
      statusAfter,
      startedAt,
      finishedAt: this.now()
    };
    this.receipts.set(request.idempotencyKey, { fingerprint, receipt });
    this.operationHistory.push(receipt);
    return receipt;
  }

  history(): readonly VmOperationReceipt[] {
    return this.operationHistory;
  }

  private requireStatus(target: VmTarget): VmLifecycleStatus {
    if (!target.studioInstanceId.trim() || !target.providerInstanceId.trim()) {
      throw new Error("VM target identifiers must not be empty");
    }
    const status = this.states.get(target.providerInstanceId);
    if (!status) {
      throw new Error(`VM target is not configured: ${target.providerInstanceId}`);
    }
    return status;
  }
}
