import type {
  ActivityEvent,
  Studio,
  StudioInstance,
  VmLifecycleStatus
} from "@private-ai-org/core";
import {
  VmProviderError,
  type VmLifecycleAction,
  type VmObservation,
  type VmOperationReceipt,
  type VmProviderPort,
  type VmTarget
} from "./vm-provider-port.js";

export type VmLifecycleOperationStatus = "pending" | "succeeded" | "failed";

export interface VmLifecycleOperationRecord {
  id: string;
  studioId: string;
  studioInstanceId: string;
  providerInstanceId: string;
  idempotencyKey: string;
  action: VmLifecycleAction;
  status: VmLifecycleOperationStatus;
  providerReceiptId: string | null;
  statusBefore: VmOperationReceipt["statusBefore"] | null;
  statusAfter: VmOperationReceipt["statusAfter"] | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface VmLifecycleRepositoryPort {
  getVmTarget(studioId: string, studioInstanceId: string): VmTarget;
  beginVmLifecycleOperation(input: {
    studioId: string;
    target: VmTarget;
    idempotencyKey: string;
    action: VmLifecycleAction;
  }): { operation: VmLifecycleOperationRecord; replayed: boolean };
  completeVmLifecycleOperation(
    operationId: string,
    receipt: VmOperationReceipt
  ): VmLifecycleOperationRecord;
  failVmLifecycleOperation(operationId: string, errorMessage: string): VmLifecycleOperationRecord;
  recordVmObservation(studioId: string, observation: VmObservation): void;
  readVmLifecycleEvidence(
    studioId: string,
    studioInstanceId: string,
    limit: number
  ): {
    operations: VmLifecycleOperationRecord[];
    activity: ActivityEvent[];
  };
}

export class VmLifecycleServiceError extends Error {
  constructor(
    readonly code:
      | "VM_ACTIONS_NOT_ARMED"
      | "VM_ACTIONS_ARMING_EXPIRED"
      | "VM_OPERATION_IN_PROGRESS"
      | "VM_OPERATION_INDETERMINATE"
      | "VM_OPERATION_FAILED"
      | "VM_PROVIDER_CONTRACT_VIOLATION",
    message: string
  ) {
    super(message);
    this.name = "VmLifecycleServiceError";
  }
}

/**
 * Repository-level concurrency signal. Infrastructure throws this only when a
 * different pending lifecycle operation already owns the Studio instance.
 * It contains no provider path or operation identifier.
 */
export class VmLifecyclePendingOperationError extends Error {
  constructor() {
    super("Another VM lifecycle operation is already pending for this Studio instance");
    this.name = "VmLifecyclePendingOperationError";
  }
}

export interface VmLifecycleExecutionResult {
  receipt: VmOperationReceipt;
  replayed: boolean;
}

export interface VmLifecycleEvidenceBundle {
  studioId: string;
  studioInstanceId: string;
  ordering: "newest_first";
  operationsTruncated: boolean;
  activityTruncated: boolean;
  operations: Array<{
    operationId: string;
    idempotencyKey: string;
    action: VmLifecycleAction;
    status: VmLifecycleOperationStatus;
    statusBefore: VmLifecycleStatus | null;
    statusAfter: VmLifecycleStatus | null;
    receiptRecorded: boolean;
    failureRecorded: boolean;
    startedAt: string;
    finishedAt: string | null;
  }>;
  activity: Array<{
    eventId: string;
    type: string;
    createdAt: string;
  }>;
}

export type VmLifecycleActionMode =
  | "disabled"
  | "read_only"
  | "armed"
  | "expired";

export type VmLifecycleTargetEligibility =
  | "not_configured"
  | "eligible"
  | "instance_revoked"
  | "studio_retired";

export interface VmLifecycleAccessSnapshot {
  studioId: string;
  studioInstanceId: string;
  provider: "vmware-fusion" | null;
  configured: boolean;
  preflight: "not_configured" | "ready";
  preflightCheckedAt: string | null;
  targetEligibility: VmLifecycleTargetEligibility;
  actionMode: VmLifecycleActionMode;
  actionsAllowed: boolean;
  actionsArmedUntil: string | null;
  observedAt: string;
}

export interface ConfiguredVmLifecycleAccess {
  studioId: string;
  studioInstanceId: string;
  preflightCheckedAt: string;
  actionsArmed: boolean;
  actionsArmedUntil: string | null;
}

export interface VmLifecycleSmokeCheck {
  studioId: string;
  studioInstanceId: string;
  sessionPrefix: string;
  automatedChecksPassed: boolean;
  checks: {
    evidenceComplete: boolean;
    sessionOperationsComplete: boolean;
    legalTransitions: boolean;
    chronological: boolean;
    activityMinimumsPresent: boolean;
  };
  operations: Array<{
    action: VmLifecycleAction;
    idempotencyKey: string;
    occurrenceCount: number;
    operationId: string | null;
    status: VmLifecycleOperationStatus | null;
    statusBefore: VmLifecycleStatus | null;
    statusAfter: VmLifecycleStatus | null;
    receiptRecorded: boolean;
    failureRecorded: boolean;
    startedAt: string | null;
    finishedAt: string | null;
    passed: boolean;
  }>;
  activityCounts: {
    requested: number;
    succeeded: number;
    failed: number;
    observed: number;
  };
  failureCodes: string[];
  manualRequirements: Array<{
    code: string;
    description: string;
  }>;
}

const evidenceLimit = 100;
const publicObservationFailureMessage = "VM lifecycle observation failed";
const publicOperationFailureMessage = "VM lifecycle operation failed; inspect durable Studio evidence";
const publicIndeterminateOperationMessage = "VM lifecycle result is indeterminate; do not retry until durable Studio evidence and VM state are reconciled";

const vmLifecycleStatuses = new Set<VmLifecycleStatus>([
  "unknown",
  "stopped",
  "starting",
  "running",
  "suspended",
  "stopping",
  "error"
]);

const validReceiptTransitions: Record<
  VmLifecycleAction,
  ReadonlySet<string>
> = {
  start: new Set(["stopped->running"]),
  stop: new Set(["running->stopped", "suspended->stopped"]),
  suspend: new Set(["running->suspended"]),
  resume: new Set(["suspended->running"])
};

function isValidInstant(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= 64
    && Number.isFinite(Date.parse(value))
  );
}

function safeProviderDiagnostic(error: unknown, target: VmTarget): string {
  const raw = error instanceof VmProviderError
    || error instanceof VmLifecycleServiceError
    ? error.message
    : "VM provider failed without a trusted diagnostic";
  const redacted = raw.replaceAll(
    target.providerInstanceId,
    "[configured-vm-target]"
  );
  const normalized = redacted.trim().replaceAll(/\s+/g, " ")
    || "VM lifecycle provider failed without diagnostic output";
  return normalized.slice(0, 2_000);
}

function safeEvidenceIdempotencyKey(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
    ? value
    : "[redacted-idempotency-key]";
}

const smokeSequence: ReadonlyArray<{
  action: VmLifecycleAction;
  statusBefore: VmLifecycleStatus;
  statusAfter: VmLifecycleStatus;
}> = [
  { action: "start", statusBefore: "stopped", statusAfter: "running" },
  { action: "suspend", statusBefore: "running", statusAfter: "suspended" },
  { action: "resume", statusBefore: "suspended", statusAfter: "running" },
  { action: "stop", statusBefore: "running", statusAfter: "stopped" }
];

const smokeManualRequirements = [
  {
    code: "BOARD_APPROVAL",
    description: "Record explicit Board approval for the disposable VM and bounded action window."
  },
  {
    code: "ACCESS_SNAPSHOTS",
    description: "Capture read-only, armed, and expired or disabled access snapshots."
  },
  {
    code: "REPLAY_RESPONSE",
    description: "Retain the repeated start response proving replayed: true."
  },
  {
    code: "MATCH_ACTIVITY_TO_SESSION",
    description: "Confirm the activity events belong to this smoke window; aggregate counts alone are not correlation."
  },
  {
    code: "OTHER_VM_UNTOUCHED",
    description: "Confirm an unrelated VM remained untouched."
  },
  {
    code: "VERSIONS_AND_CLEANUP",
    description: "Record VMware/vmrun versions, final stopped observation, disarming, and cleanup."
  }
] as const;

function assertProviderObservation(
  expected: VmTarget,
  observation: VmObservation
): void {
  if (
    observation.target.studioInstanceId !== expected.studioInstanceId
    || observation.target.providerInstanceId !== expected.providerInstanceId
  ) {
    throw new VmLifecycleServiceError(
      "VM_PROVIDER_CONTRACT_VIOLATION",
      "VM provider observed a different configured target"
    );
  }
  if (!vmLifecycleStatuses.has(observation.status)) {
    throw new VmLifecycleServiceError(
      "VM_PROVIDER_CONTRACT_VIOLATION",
      "VM provider returned an unknown lifecycle status"
    );
  }
  if (!isValidInstant(observation.observedAt)) {
    throw new VmLifecycleServiceError(
      "VM_PROVIDER_CONTRACT_VIOLATION",
      "VM provider returned an invalid observation timestamp"
    );
  }
}

function receiptFromOperation(operation: VmLifecycleOperationRecord): VmOperationReceipt {
  if (
    operation.status !== "succeeded"
    || !operation.providerReceiptId
    || !operation.statusBefore
    || !operation.statusAfter
    || !operation.finishedAt
  ) {
    throw new VmLifecycleServiceError(
      "VM_PROVIDER_CONTRACT_VIOLATION",
      `VM lifecycle operation ${operation.id} has no complete receipt`
    );
  }
  return {
    id: operation.providerReceiptId,
    idempotencyKey: operation.idempotencyKey,
    target: {
      studioInstanceId: operation.studioInstanceId,
      providerInstanceId: operation.providerInstanceId
    },
    action: operation.action,
    statusBefore: operation.statusBefore,
    statusAfter: operation.statusAfter,
    startedAt: operation.startedAt,
    finishedAt: operation.finishedAt
  };
}

function assertProviderReceipt(
  expected: {
    target: VmTarget;
    idempotencyKey: string;
    action: VmLifecycleAction;
  },
  receipt: VmOperationReceipt
): void {
  if (
    receipt.idempotencyKey !== expected.idempotencyKey
    || receipt.action !== expected.action
    || receipt.target.studioInstanceId !== expected.target.studioInstanceId
    || receipt.target.providerInstanceId !== expected.target.providerInstanceId
  ) {
    throw new VmLifecycleServiceError(
      "VM_PROVIDER_CONTRACT_VIOLATION",
      "VM provider returned a receipt for a different lifecycle request"
    );
  }
  if (
    typeof receipt.id !== "string"
    || receipt.id.trim().length === 0
    || receipt.id.length > 512
  ) {
    throw new VmLifecycleServiceError(
      "VM_PROVIDER_CONTRACT_VIOLATION",
      "VM provider returned an invalid receipt identifier"
    );
  }
  if (
    !vmLifecycleStatuses.has(receipt.statusBefore)
    || !vmLifecycleStatuses.has(receipt.statusAfter)
    || !validReceiptTransitions[receipt.action].has(
      `${receipt.statusBefore}->${receipt.statusAfter}`
    )
  ) {
    throw new VmLifecycleServiceError(
      "VM_PROVIDER_CONTRACT_VIOLATION",
      "VM provider returned an invalid lifecycle state transition"
    );
  }
  if (
    !isValidInstant(receipt.startedAt)
    || !isValidInstant(receipt.finishedAt)
    || Date.parse(receipt.finishedAt) < Date.parse(receipt.startedAt)
  ) {
    throw new VmLifecycleServiceError(
      "VM_PROVIDER_CONTRACT_VIOLATION",
      "VM provider returned invalid lifecycle timing evidence"
    );
  }
}

export class VmLifecycleService {
  private readonly actionsArmedUntilMs: number | null;
  private readonly now: () => string;

  constructor(
    private readonly repository: VmLifecycleRepositoryPort,
    private readonly provider: VmProviderPort,
    private readonly options: {
      actionsArmed: boolean;
      actionsArmedUntil?: string | null;
      now?: () => string;
    } = {
      actionsArmed: false,
      actionsArmedUntil: null
    }
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    if (!options.actionsArmed) {
      if (options.actionsArmedUntil) {
        throw new Error(
          "VM lifecycle action deadline requires actions to be armed"
        );
      }
      this.actionsArmedUntilMs = null;
      return;
    }
    if (!options.actionsArmedUntil) {
      throw new Error(
        "Armed VM lifecycle actions require an expiry timestamp"
      );
    }
    const deadlineMs = Date.parse(options.actionsArmedUntil);
    if (!Number.isFinite(deadlineMs)) {
      throw new Error(
        "VM lifecycle action expiry timestamp is invalid"
      );
    }
    this.actionsArmedUntilMs = deadlineMs;
  }

  async observe(studioId: string, studioInstanceId: string): Promise<VmObservation> {
    const target = this.repository.getVmTarget(studioId, studioInstanceId);
    let observation: VmObservation;
    try {
      observation = await this.provider.observe(target);
    } catch {
      throw new VmLifecycleServiceError(
        "VM_OPERATION_FAILED",
        publicObservationFailureMessage
      );
    }
    assertProviderObservation(target, observation);
    this.repository.recordVmObservation(studioId, observation);
    return observation;
  }

  async execute(input: {
    studioId: string;
    studioInstanceId: string;
    idempotencyKey: string;
    action: VmLifecycleAction;
  }): Promise<VmLifecycleExecutionResult> {
    if (!this.options.actionsArmed) {
      throw new VmLifecycleServiceError(
        "VM_ACTIONS_NOT_ARMED",
        "VM lifecycle actions are not armed"
      );
    }
    const observedNowMs = Date.parse(this.now());
    if (
      !Number.isFinite(observedNowMs)
      || this.actionsArmedUntilMs === null
      || observedNowMs >= this.actionsArmedUntilMs
    ) {
      throw new VmLifecycleServiceError(
        "VM_ACTIONS_ARMING_EXPIRED",
        "VM lifecycle action authorization has expired"
      );
    }
    const target = this.repository.getVmTarget(input.studioId, input.studioInstanceId);
    let begun: ReturnType<
      VmLifecycleRepositoryPort["beginVmLifecycleOperation"]
    >;
    try {
      begun = this.repository.beginVmLifecycleOperation({
        studioId: input.studioId,
        target,
        idempotencyKey: input.idempotencyKey,
        action: input.action
      });
    } catch (error) {
      if (error instanceof VmLifecyclePendingOperationError) {
        throw new VmLifecycleServiceError(
          "VM_OPERATION_IN_PROGRESS",
          error.message
        );
      }
      throw error;
    }

    if (begun.replayed) {
      if (begun.operation.status === "succeeded") {
        return {
          receipt: receiptFromOperation(begun.operation),
          replayed: true
        };
      }
      if (begun.operation.status === "failed") {
        throw new VmLifecycleServiceError(
          "VM_OPERATION_FAILED",
          publicOperationFailureMessage
        );
      }
      throw new VmLifecycleServiceError(
        "VM_OPERATION_IN_PROGRESS",
        `VM lifecycle operation ${begun.operation.id} is already pending`
      );
    }

    let receipt: VmOperationReceipt;
    try {
      receipt = await this.provider.execute({
        idempotencyKey: input.idempotencyKey,
        target,
        action: input.action
      });
      assertProviderReceipt({ ...input, target }, receipt);
    } catch (error) {
      // A forced provider termination or failed post-command verification may
      // follow a real VM state change. Keep the durable operation pending so a
      // repeated idempotency key cannot blindly execute the action again.
      if (
        error instanceof VmProviderError
        && error.outcome === "indeterminate"
      ) {
        throw new VmLifecycleServiceError(
          "VM_OPERATION_INDETERMINATE",
          publicIndeterminateOperationMessage
        );
      }
      const diagnostic = safeProviderDiagnostic(error, target);
      try {
        this.repository.failVmLifecycleOperation(
          begun.operation.id,
          diagnostic
        );
      } catch {
        throw new VmLifecycleServiceError(
          "VM_OPERATION_INDETERMINATE",
          publicIndeterminateOperationMessage
        );
      }
      if (error instanceof VmLifecycleServiceError) throw error;
      throw new VmLifecycleServiceError(
        "VM_OPERATION_FAILED",
        publicOperationFailureMessage
      );
    }

    // If durable completion itself fails after VMware returns success, leave the
    // operation pending. Marking it failed would invite an unsafe blind retry.
    let completed: VmLifecycleOperationRecord;
    try {
      completed = this.repository.completeVmLifecycleOperation(
        begun.operation.id,
        receipt
      );
    } catch {
      throw new VmLifecycleServiceError(
        "VM_OPERATION_INDETERMINATE",
        publicIndeterminateOperationMessage
      );
    }
    return {
      receipt: receiptFromOperation(completed),
      replayed: false
    };
  }
}

export class VmLifecycleEvidenceService {
  constructor(
    private readonly repository: Pick<
      VmLifecycleRepositoryPort,
      "readVmLifecycleEvidence"
    >
  ) {}

  read(studioId: string, studioInstanceId: string): VmLifecycleEvidenceBundle {
    const evidence = this.repository.readVmLifecycleEvidence(
      studioId,
      studioInstanceId,
      evidenceLimit + 1
    );
    return {
      studioId,
      studioInstanceId,
      ordering: "newest_first",
      operationsTruncated: evidence.operations.length > evidenceLimit,
      activityTruncated: evidence.activity.length > evidenceLimit,
      operations: evidence.operations.slice(0, evidenceLimit).map((operation) => ({
        operationId: operation.id,
        idempotencyKey: safeEvidenceIdempotencyKey(operation.idempotencyKey),
        action: operation.action,
        status: operation.status,
        statusBefore: operation.statusBefore,
        statusAfter: operation.statusAfter,
        receiptRecorded: operation.providerReceiptId !== null,
        failureRecorded: operation.errorMessage !== null,
        startedAt: operation.startedAt,
        finishedAt: operation.finishedAt
      })),
      activity: evidence.activity.slice(0, evidenceLimit).map((event) => ({
        eventId: event.id,
        type: event.type,
        createdAt: event.createdAt
      }))
    };
  }
}

export class VmLifecycleAccessService {
  constructor(
    private readonly repository: {
      getStudio(studioId: string): Studio;
      getStudioInstance(instanceId: string): StudioInstance;
    },
    private readonly configured: ConfiguredVmLifecycleAccess | null,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    if (!configured) return;
    if (
      !configured.studioId.trim()
      || !configured.studioInstanceId.trim()
      || !isValidInstant(configured.preflightCheckedAt)
    ) {
      throw new Error("Configured VM lifecycle access status is invalid");
    }
    if (
      configured.actionsArmed
      && !isValidInstant(configured.actionsArmedUntil)
    ) {
      throw new Error("Armed VM lifecycle access needs a valid expiry");
    }
    if (!configured.actionsArmed && configured.actionsArmedUntil !== null) {
      throw new Error("Read-only VM lifecycle access must not have an expiry");
    }
  }

  read(studioId: string, studioInstanceId: string): VmLifecycleAccessSnapshot {
    const instance = this.repository.getStudioInstance(studioInstanceId);
    if (instance.studioId !== studioId) {
      throw new Error("Studio instance does not belong to the requested Studio");
    }
    const studio = this.repository.getStudio(studioId);
    const observedAt = this.now();
    if (!isValidInstant(observedAt)) {
      throw new Error("VM lifecycle access observation time is invalid");
    }
    if (
      !this.configured
      || this.configured.studioId !== studioId
      || this.configured.studioInstanceId !== studioInstanceId
    ) {
      return {
        studioId,
        studioInstanceId,
        provider: null,
        configured: false,
        preflight: "not_configured",
        preflightCheckedAt: null,
        targetEligibility: "not_configured",
        actionMode: "disabled",
        actionsAllowed: false,
        actionsArmedUntil: null,
        observedAt
      };
    }

    const targetEligibility: VmLifecycleTargetEligibility = studio.status === "retired"
      ? "studio_retired"
      : instance.status === "revoked"
        ? "instance_revoked"
        : "eligible";
    if (targetEligibility !== "eligible") {
      return {
        studioId,
        studioInstanceId,
        provider: "vmware-fusion",
        configured: true,
        preflight: "ready",
        preflightCheckedAt: this.configured.preflightCheckedAt,
        targetEligibility,
        actionMode: "disabled",
        actionsAllowed: false,
        actionsArmedUntil: this.configured.actionsArmedUntil,
        observedAt
      };
    }

    const actionsArmedUntil = this.configured.actionsArmedUntil;
    const actionsAllowed = Boolean(
      this.configured.actionsArmed
      && actionsArmedUntil
      && Date.parse(observedAt) < Date.parse(actionsArmedUntil)
    );
    const actionMode: VmLifecycleActionMode = !this.configured.actionsArmed
      ? "read_only"
      : actionsAllowed
        ? "armed"
        : "expired";
    return {
      studioId,
      studioInstanceId,
      provider: "vmware-fusion",
      configured: true,
      preflight: "ready",
      preflightCheckedAt: this.configured.preflightCheckedAt,
      targetEligibility,
      actionMode,
      actionsAllowed,
      actionsArmedUntil,
      observedAt
    };
  }
}

export class VmLifecycleSmokeCheckService {
  constructor(
    private readonly evidence: Pick<VmLifecycleEvidenceService, "read">
  ) {}

  check(
    studioId: string,
    studioInstanceId: string,
    sessionPrefix: string
  ): VmLifecycleSmokeCheck {
    const normalizedPrefix = sessionPrefix.trim();
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(normalizedPrefix)
    ) {
      throw new Error(
        "VM lifecycle smoke sessionPrefix must be 1-96 safe characters"
      );
    }
    const evidence = this.evidence.read(studioId, studioInstanceId);
    const operations = smokeSequence.map((expected) => {
      const idempotencyKey = `${normalizedPrefix}-${expected.action}`;
      const matches = evidence.operations.filter(
        (operation) => operation.idempotencyKey === idempotencyKey
      );
      const operation = matches.length === 1 ? matches[0] : null;
      const passed = Boolean(
        operation
        && operation.action === expected.action
        && operation.status === "succeeded"
        && operation.statusBefore === expected.statusBefore
        && operation.statusAfter === expected.statusAfter
        && operation.receiptRecorded
        && !operation.failureRecorded
        && isValidInstant(operation.startedAt)
        && isValidInstant(operation.finishedAt)
        && Date.parse(operation.finishedAt) >= Date.parse(operation.startedAt)
      );
      return {
        action: expected.action,
        idempotencyKey,
        occurrenceCount: matches.length,
        operationId: operation?.operationId ?? null,
        status: operation?.status ?? null,
        statusBefore: operation?.statusBefore ?? null,
        statusAfter: operation?.statusAfter ?? null,
        receiptRecorded: operation?.receiptRecorded ?? false,
        failureRecorded: operation?.failureRecorded ?? false,
        startedAt: operation?.startedAt ?? null,
        finishedAt: operation?.finishedAt ?? null,
        passed
      };
    });
    const evidenceComplete = (
      !evidence.operationsTruncated
      && !evidence.activityTruncated
    );
    const sessionOperationsComplete = operations.every(
      (operation) => (
        operation.occurrenceCount === 1
        && operation.status === "succeeded"
        && operation.receiptRecorded
        && !operation.failureRecorded
      )
    );
    const legalTransitions = operations.every((operation) => operation.passed);
    const chronological = legalTransitions && operations.every(
      (operation, index) => {
        if (index === 0) return true;
        const previous = operations[index - 1];
        return Boolean(
          previous?.finishedAt
          && operation.startedAt
          && Date.parse(operation.startedAt) >= Date.parse(previous.finishedAt)
        );
      }
    );
    const countActivity = (type: string) => evidence.activity.filter(
      (event) => event.type === type
    ).length;
    const activityCounts = {
      requested: countActivity("vm.lifecycle_requested"),
      succeeded: countActivity("vm.lifecycle_succeeded"),
      failed: countActivity("vm.lifecycle_failed"),
      observed: countActivity("vm.lifecycle_observed")
    };
    const activityMinimumsPresent = (
      activityCounts.requested >= smokeSequence.length
      && activityCounts.succeeded >= smokeSequence.length
      && activityCounts.observed >= smokeSequence.length + 1
    );
    const checks = {
      evidenceComplete,
      sessionOperationsComplete,
      legalTransitions,
      chronological,
      activityMinimumsPresent
    };
    const failureCodes: string[] = [];
    if (!evidenceComplete) failureCodes.push("EVIDENCE_TRUNCATED");
    if (!sessionOperationsComplete) {
      failureCodes.push("SESSION_OPERATIONS_INCOMPLETE");
    }
    if (!legalTransitions) failureCodes.push("SESSION_TRANSITION_INVALID");
    if (!chronological) failureCodes.push("SESSION_TIMELINE_INVALID");
    if (!activityMinimumsPresent) {
      failureCodes.push("ACTIVITY_MINIMUMS_MISSING");
    }
    return {
      studioId,
      studioInstanceId,
      sessionPrefix: normalizedPrefix,
      automatedChecksPassed: Object.values(checks).every(Boolean),
      checks,
      operations,
      activityCounts,
      failureCodes,
      manualRequirements: smokeManualRequirements.map((requirement) => ({
        ...requirement
      }))
    };
  }
}
