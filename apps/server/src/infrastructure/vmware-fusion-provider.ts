import { constants } from "node:fs";
import { access, lstat, readFile } from "node:fs/promises";
import path from "node:path";
import type { VmLifecycleStatus } from "@private-ai-org/core";
import {
  VmProviderError,
  type VmLifecycleAction,
  type VmLifecycleRequest,
  type VmObservation,
  type VmOperationReceipt,
  type VmProviderPort,
  type VmTarget
} from "../application/vm-provider-port.js";
import {
  NodeProcessRunner,
  type ProcessRunResult,
  type ProcessRunner
} from "./process-runner.js";

export interface VmwareFileSystem {
  readText(filePath: string): Promise<string>;
  exists(filePath: string): Promise<boolean>;
  isRegularFileAccessible(
    filePath: string,
    accessMode: "read" | "execute"
  ): Promise<boolean>;
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ENOENT"
  );
}

const nodeFileSystem: VmwareFileSystem = {
  async readText(filePath) {
    const metadata = await lstat(filePath);
    if (!metadata.isFile()) {
      throw new Error(
        `VMware text path is not a direct regular file: ${filePath}`
      );
    }
    await access(filePath, constants.R_OK);
    return readFile(filePath, "utf8");
  },
  async exists(filePath) {
    try {
      const metadata = await lstat(filePath);
      if (metadata.isSymbolicLink()) {
        throw new Error(
          `VMware state path must not be a symbolic link: ${filePath}`
        );
      }
      await access(filePath);
      return true;
    } catch (error) {
      if (isMissingPathError(error)) return false;
      throw error;
    }
  },
  async isRegularFileAccessible(filePath, accessMode) {
    try {
      // lstat deliberately rejects a symbolic-link final component. Northstar
      // must not silently redirect its one configured executable or VM target.
      const metadata = await lstat(filePath);
      if (!metadata.isFile()) return false;
      await access(
        filePath,
        accessMode === "execute" ? constants.X_OK : constants.R_OK
      );
      return true;
    } catch {
      return false;
    }
  }
};

export interface VmwareFusionPreflightResult {
  studioInstanceId: string;
  checkedAt: string;
  vmrunExecutableReady: true;
  vmxFileReady: true;
}

export interface VmwareFusionProviderOptions {
  vmrunExecutablePath: string;
  target: VmTarget;
  runner?: ProcessRunner;
  fileSystem?: VmwareFileSystem;
  now?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
  observationAttempts?: number;
  observationDelayMs?: number;
  commandTimeoutMs?: number;
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

function validateAbsoluteFilePath(value: string, label: string, extension?: string): string {
  if (
    !path.isAbsolute(value)
    || value.includes("\0")
    || value.includes("\n")
    || value.includes("\r")
  ) {
    throw new Error(`${label} must be one absolute filesystem path`);
  }
  const normalized = path.normalize(value);
  if (extension && path.extname(normalized).toLowerCase() !== extension) {
    throw new Error(`${label} must end in ${extension}`);
  }
  return normalized;
}

function isInsideDirectory(candidate: string, directory: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function boundedDetail(value: string): string {
  const normalized = value.trim().replaceAll(/\s+/g, " ");
  return normalized.length <= 1_000 ? normalized : `${normalized.slice(0, 999)}…`;
}

export class VmwareFusionProvider implements VmProviderPort {
  private readonly executablePath: string;
  private readonly configuredTarget: VmTarget;
  private readonly runner: ProcessRunner;
  private readonly fileSystem: VmwareFileSystem;
  private readonly now: () => string;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly observationAttempts: number;
  private readonly observationDelayMs: number;
  private readonly commandTimeoutMs: number;
  private readonly receipts = new Map<
    string,
    { fingerprint: string; receipt: VmOperationReceipt }
  >();
  private readonly inFlight = new Map<
    string,
    { fingerprint: string; promise: Promise<VmOperationReceipt> }
  >();

  constructor(options: VmwareFusionProviderOptions) {
    this.executablePath = validateAbsoluteFilePath(
      options.vmrunExecutablePath,
      "vmrun executable path"
    );
    this.configuredTarget = {
      studioInstanceId: options.target.studioInstanceId.trim(),
      providerInstanceId: validateAbsoluteFilePath(
        options.target.providerInstanceId,
        "Configured VMware VMX path",
        ".vmx"
      )
    };
    if (!this.configuredTarget.studioInstanceId) {
      throw new Error("Configured Studio instance ID must not be empty");
    }
    this.runner = options.runner ?? new NodeProcessRunner();
    this.fileSystem = options.fileSystem ?? nodeFileSystem;
    this.now = options.now ?? (() => new Date().toISOString());
    this.sleep = options.sleep ?? (
      (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
    );
    this.observationAttempts = options.observationAttempts ?? 8;
    this.observationDelayMs = options.observationDelayMs ?? 250;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.observationAttempts) || this.observationAttempts < 1) {
      throw new Error("VMware observationAttempts must be a positive integer");
    }
    if (!Number.isSafeInteger(this.observationDelayMs) || this.observationDelayMs < 0) {
      throw new Error("VMware observationDelayMs must be a non-negative integer");
    }
    if (!Number.isSafeInteger(this.commandTimeoutMs) || this.commandTimeoutMs < 1) {
      throw new Error("VMware commandTimeoutMs must be a positive integer");
    }
  }

  /**
   * Checks only the two explicitly configured files. It never invokes vmrun,
   * scans a directory, enumerates VMs, or returns either host path.
   */
  async preflight(): Promise<VmwareFusionPreflightResult> {
    await this.assertConfiguredFilesReady();
    return {
      studioInstanceId: this.configuredTarget.studioInstanceId,
      checkedAt: this.now(),
      vmrunExecutableReady: true,
      vmxFileReady: true
    };
  }

  async observe(target: VmTarget): Promise<VmObservation> {
    const configured = this.requireConfiguredTarget(target);
    try {
      // Observation must also fail closed if the configured VMX final path was
      // replaced after startup, including while the VM appears to be running.
      await this.assertConfiguredVmxReady();
      let status: VmLifecycleStatus;
      if (await this.fileSystem.exists(`${configured.providerInstanceId}.lck`)) {
        status = "running";
      } else {
        status = await this.observeStoppedOrSuspended(configured.providerInstanceId);
      }
      return {
        target: configured,
        status,
        observedAt: this.now()
      };
    } catch (error) {
      throw new VmProviderError(
        `VMware observation failed: ${this.safeDiagnostic(error)}`
      );
    }
  }

  async execute(request: VmLifecycleRequest): Promise<VmOperationReceipt> {
    if (!request.idempotencyKey.trim()) {
      throw new Error("VM lifecycle idempotency key must not be empty");
    }
    if (!["start", "stop", "suspend", "resume"].includes(request.action)) {
      throw new Error(`Unsupported VMware lifecycle action: ${String(request.action)}`);
    }
    this.requireConfiguredTarget(request.target);
    const fingerprint = requestFingerprint(request);
    const existing = this.receipts.get(request.idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new Error("VM lifecycle idempotency key was reused for a different request");
      }
      return existing.receipt;
    }
    const inFlight = this.inFlight.get(request.idempotencyKey);
    if (inFlight) {
      if (inFlight.fingerprint !== fingerprint) {
        throw new Error("VM lifecycle idempotency key was reused for a different request");
      }
      return inFlight.promise;
    }

    const promise = this.executeOnce(request).finally(() => {
      this.inFlight.delete(request.idempotencyKey);
    });
    this.inFlight.set(request.idempotencyKey, { fingerprint, promise });
    const receipt = await promise;
    this.receipts.set(request.idempotencyKey, { fingerprint, receipt });
    return receipt;
  }

  private async executeOnce(request: VmLifecycleRequest): Promise<VmOperationReceipt> {
    // Startup preflight is not permanent proof. Revalidate immediately before
    // every new external action so a replaced executable or VMX path cannot
    // inherit an earlier readiness result. This check invokes no command.
    await this.assertConfiguredFilesReady();
    const statusBefore = (await this.observe(request.target)).status;
    const statusAfter = resultingStatus[request.action][statusBefore];
    if (!statusAfter) {
      throw new Error(
        `Invalid VMware lifecycle action: ${request.action} from ${statusBefore}`
      );
    }
    const startedAt = this.now();
    await this.runVmrun(this.actionArguments(request.action));

    try {
      let observed: VmObservation | null = null;
      for (let attempt = 0; attempt < this.observationAttempts; attempt += 1) {
        if (attempt > 0 && this.observationDelayMs > 0) {
          await this.sleep(this.observationDelayMs);
        }
        observed = await this.observe(request.target);
        if (observed.status === statusAfter) break;
      }
      if (observed?.status !== statusAfter) {
        throw new Error(
          `did not reach ${statusAfter}; observed ${observed?.status ?? "unknown"}`
        );
      }

      return {
        id: `vmware-fusion:${request.idempotencyKey}`,
        idempotencyKey: request.idempotencyKey,
        target: this.configuredTarget,
        action: request.action,
        statusBefore,
        statusAfter,
        startedAt,
        finishedAt: this.now()
      };
    } catch (error) {
      // vmrun already returned success, so an observation/read/clock failure
      // cannot prove that the external action failed. Let the application keep
      // its durable request pending until the VM is reconciled.
      throw new VmProviderError(
        `VMware ${request.action} outcome could not be verified: ${this.safeDiagnostic(error)}`,
        "indeterminate"
      );
    }
  }

  private actionArguments(action: VmLifecycleAction): string[] {
    const vmx = this.configuredTarget.providerInstanceId;
    switch (action) {
      case "start":
      case "resume":
        return ["start", vmx, "nogui"];
      case "stop":
        return ["stop", vmx, "soft"];
      case "suspend":
        return ["suspend", vmx, "soft"];
    }
  }

  private async assertConfiguredFilesReady(): Promise<void> {
    if (
      !await this.fileSystem.isRegularFileAccessible(
        this.executablePath,
        "execute"
      )
    ) {
      throw new Error(
        "Configured vmrun path is not an executable regular file"
      );
    }
    await this.assertConfiguredVmxReady();
  }

  private async assertConfiguredVmxReady(): Promise<void> {
    if (
      !await this.fileSystem.isRegularFileAccessible(
        this.configuredTarget.providerInstanceId,
        "read"
      )
    ) {
      throw new Error(
        "Configured VMware VMX path is not a readable regular file"
      );
    }
  }

  private async observeStoppedOrSuspended(vmxPath: string): Promise<VmLifecycleStatus> {
    const vmx = await this.fileSystem.readText(vmxPath);
    const match = vmx.match(/^\s*checkpoint\.vmState\s*=\s*"([^"]*)"\s*$/m);
    if (!match || !match[1]) return "stopped";

    const vmDirectory = path.dirname(vmxPath);
    const statePath = path.normalize(
      path.isAbsolute(match[1]) ? match[1] : path.resolve(vmDirectory, match[1])
    );
    if (!isInsideDirectory(statePath, vmDirectory)) {
      throw new Error("VMware checkpoint state path escapes the configured VM directory");
    }
    return await this.fileSystem.exists(statePath) ? "suspended" : "unknown";
  }

  private requireConfiguredTarget(target: VmTarget): VmTarget {
    const providerInstanceId = path.normalize(target.providerInstanceId);
    if (
      target.studioInstanceId !== this.configuredTarget.studioInstanceId
      || providerInstanceId !== this.configuredTarget.providerInstanceId
    ) {
      throw new Error("VM target is not the explicitly configured VMware target");
    }
    return this.configuredTarget;
  }

  private async runVmrun(args: string[]): Promise<{ stdout: string }> {
    let result: ProcessRunResult;
    try {
      result = await this.runner.run({
        executable: this.executablePath,
        args: ["-T", "fusion", ...args],
        timeoutMs: this.commandTimeoutMs,
        maxOutputBytes: 64 * 1024
      });
    } catch (error) {
      // Once control crosses the process-runner boundary, a rejected Promise
      // cannot prove that the child was never spawned or that the VM remained
      // unchanged. Preserve the durable request for explicit reconciliation.
      throw new VmProviderError(
        `vmrun execution boundary did not return a result: ${this.safeDiagnostic(error)}`,
        "indeterminate"
      );
    }
    if (
      result.timedOut
      || result.outputLimitExceeded
      || result.terminationSignal !== null
    ) {
      const signal = result.terminationSignal
        && /^SIG[A-Z0-9]+$/.test(result.terminationSignal)
        ? result.terminationSignal
        : "an operating-system signal";
      const termination = result.timedOut
        ? "timed out"
        : result.outputLimitExceeded
          ? "exceeded the output limit"
          : `was terminated by ${signal}`;
      const detail = this.safeDiagnostic(
        result.stderr || result.stdout || "no diagnostic output"
      );
      throw new VmProviderError(
        `vmrun ${termination}: ${detail}`,
        "indeterminate"
      );
    }
    if (result.exitCode !== 0) {
      const detail = this.safeDiagnostic(
        result.stderr || result.stdout || "no diagnostic output"
      );
      throw new VmProviderError(
        `vmrun failed with exit ${result.exitCode}: ${detail}`
      );
    }
    return { stdout: result.stdout };
  }

  private safeDiagnostic(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    const executableDirectory = path.dirname(this.executablePath);
    const vmDirectory = path.dirname(
      this.configuredTarget.providerInstanceId
    );
    const replacements: Array<[string, string]> = [
      [this.executablePath, "[configured-vmrun]"],
      [this.configuredTarget.providerInstanceId, "[configured-vmx]"]
    ];
    if (executableDirectory !== path.parse(executableDirectory).root) {
      replacements.push([
        executableDirectory,
        "[configured-vmrun-directory]"
      ]);
    }
    if (vmDirectory !== path.parse(vmDirectory).root) {
      replacements.push([vmDirectory, "[configured-vm-directory]"]);
    }
    replacements.sort(([left], [right]) => right.length - left.length);
    let redacted = raw;
    for (const [configuredPath, replacement] of replacements) {
      redacted = redacted.replaceAll(configuredPath, replacement);
    }
    return boundedDetail(redacted || "no diagnostic output");
  }
}
