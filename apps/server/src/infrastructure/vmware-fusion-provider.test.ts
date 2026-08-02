import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { VmLifecycleStatus } from "@private-ai-org/core";
import {
  VmProviderError,
  type VmTarget
} from "../application/vm-provider-port.js";
import type {
  ProcessRunRequest,
  ProcessRunResult,
  ProcessRunner
} from "./process-runner.js";
import {
  VmwareFusionProvider,
  type VmwareFileSystem
} from "./vmware-fusion-provider.js";

const vmrunPath = "/Applications/VMware Fusion.app/Contents/Library/vmrun";
const vmxPath = "/Users/test/Virtual Machines/Research Studio/Research Studio.vmx";
const target: VmTarget = {
  studioInstanceId: "instance-research-1",
  providerInstanceId: vmxPath
};

class FakeVmwareEnvironment implements ProcessRunner, VmwareFileSystem {
  readonly requests: ProcessRunRequest[] = [];
  readonly fileChecks: Array<{
    filePath: string;
    accessMode: "read" | "execute";
  }> = [];
  state: VmLifecycleStatus;
  failAction: string | null = null;
  failureDiagnostic = "simulated vmrun failure";
  failureTimedOut = false;
  failureOutputLimitExceeded = false;
  failureTerminationSignal: string | null = null;
  rejectAction: string | null = null;
  rejectionDiagnostic = "simulated process runner rejection";
  observationFailure: string | null = null;
  observationFailureAfterAction: string | null = null;
  ignoreSuccessfulAction = false;
  actionExecuted = false;
  checkpoint = "managed";
  vmrunReady = true;
  vmxReady = true;

  constructor(state: VmLifecycleStatus = "stopped") {
    this.state = state;
  }

  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    this.requests.push(request);
    assert.equal(request.executable, vmrunPath);
    assert.deepEqual(request.args.slice(0, 2), ["-T", "fusion"]);
    const command = request.args[2];
    if (this.rejectAction === command) {
      throw new Error(this.rejectionDiagnostic);
    }
    if (this.failAction === command) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: this.failureDiagnostic,
        timedOut: this.failureTimedOut,
        outputLimitExceeded: this.failureOutputLimitExceeded,
        terminationSignal: this.failureTerminationSignal
      };
    }

    assert.equal(request.args[3], vmxPath);
    this.actionExecuted = true;
    if (!this.ignoreSuccessfulAction) {
      if (command === "start") this.state = "running";
      else if (command === "stop") this.state = "stopped";
      else if (command === "suspend") this.state = "suspended";
      else throw new Error(`Unexpected fake vmrun command: ${command}`);
    }
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      outputLimitExceeded: false,
      terminationSignal: null
    };
  }

  async readText(filePath: string): Promise<string> {
    assert.equal(filePath, vmxPath);
    const observationFailure = this.actionExecuted
      ? this.observationFailureAfterAction ?? this.observationFailure
      : this.observationFailure;
    if (observationFailure) {
      throw new Error(observationFailure);
    }
    if (this.checkpoint === "escape") {
      return 'checkpoint.vmState = "../../outside.vmss"\n';
    }
    return this.state === "suspended"
      ? 'checkpoint.vmState = "Research Studio.vmss"\n'
      : 'checkpoint.vmState = ""\n';
  }

  async exists(filePath: string): Promise<boolean> {
    if (filePath === `${vmxPath}.lck`) return this.state === "running";
    return this.state === "suspended"
      && filePath === path.join(path.dirname(vmxPath), "Research Studio.vmss");
  }

  async isRegularFileAccessible(
    filePath: string,
    accessMode: "read" | "execute"
  ): Promise<boolean> {
    this.fileChecks.push({ filePath, accessMode });
    if (filePath === vmrunPath && accessMode === "execute") {
      return this.vmrunReady;
    }
    if (filePath === vmxPath && accessMode === "read") {
      return this.vmxReady;
    }
    return false;
  }
}

function provider(environment: FakeVmwareEnvironment) {
  let clock = 0;
  return new VmwareFusionProvider({
    vmrunExecutablePath: vmrunPath,
    target,
    runner: environment,
    fileSystem: environment,
    now: () => `2026-07-31T13:00:0${clock++}.000Z`,
    sleep: async () => {},
    observationAttempts: 1,
    observationDelayMs: 0
  });
}

function temporaryDefaultFileSystemTarget(t: test.TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), "northstar-vmware-fs-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const vmrunDirectory = path.join(directory, "vmware-app");
  mkdirSync(vmrunDirectory);
  const vmrunExecutablePath = path.join(vmrunDirectory, "vmrun");
  writeFileSync(vmrunExecutablePath, "fake vmrun fixture\n", "utf8");
  chmodSync(vmrunExecutablePath, 0o700);
  const providerInstanceId = path.join(directory, "Research Studio.vmx");
  writeFileSync(providerInstanceId, 'checkpoint.vmState = ""\n', "utf8");
  return {
    directory,
    vmrunExecutablePath,
    target: {
      studioInstanceId: "instance-temporary-fs",
      providerInstanceId
    },
    lockPath: `${providerInstanceId}.lck`
  };
}

function countingRunner(counter: { calls: number }): ProcessRunner {
  return {
    async run(): Promise<ProcessRunResult> {
      counter.calls += 1;
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        outputLimitExceeded: false,
        terminationSignal: null
      };
    }
  };
}

test("preflights only the configured files without invoking vmrun", async () => {
  const environment = new FakeVmwareEnvironment();
  const vmware = provider(environment);

  assert.deepEqual(await vmware.preflight(), {
    studioInstanceId: target.studioInstanceId,
    checkedAt: "2026-07-31T13:00:00.000Z",
    vmrunExecutableReady: true,
    vmxFileReady: true
  });
  assert.equal(environment.requests.length, 0);
  assert.deepEqual(environment.fileChecks, [
    { filePath: vmrunPath, accessMode: "execute" },
    { filePath: vmxPath, accessMode: "read" }
  ]);
});

test("fails preflight closed when either configured file is not ready", async (t) => {
  await t.test("vmrun is not executable", async () => {
    const environment = new FakeVmwareEnvironment();
    environment.vmrunReady = false;

    await assert.rejects(
      provider(environment).preflight(),
      /vmrun path is not an executable regular file/
    );
    assert.equal(environment.requests.length, 0);
  });

  await t.test("VMX is not readable", async () => {
    const environment = new FakeVmwareEnvironment();
    environment.vmxReady = false;

    await assert.rejects(
      provider(environment).preflight(),
      /VMX path is not a readable regular file/
    );
    assert.equal(environment.requests.length, 0);
  });
});

test("default filesystem preflight rejects configured symbolic links", async (t) => {
  await t.test("vmrun final path is a symbolic link", async (subtest) => {
    const temporary = temporaryDefaultFileSystemTarget(subtest);
    const realExecutable = path.join(temporary.directory, "real-vmrun");
    writeFileSync(realExecutable, "replacement executable\n", "utf8");
    chmodSync(realExecutable, 0o700);
    unlinkSync(temporary.vmrunExecutablePath);
    symlinkSync(realExecutable, temporary.vmrunExecutablePath);
    const runnerCounter = { calls: 0 };
    const vmware = new VmwareFusionProvider({
      vmrunExecutablePath: temporary.vmrunExecutablePath,
      target: temporary.target,
      runner: countingRunner(runnerCounter)
    });

    await assert.rejects(
      vmware.preflight(),
      /vmrun path is not an executable regular file/
    );
    assert.equal(runnerCounter.calls, 0);
  });

  await t.test("VMX final path is a symbolic link", async (subtest) => {
    const temporary = temporaryDefaultFileSystemTarget(subtest);
    const realVmx = path.join(temporary.directory, "real.vmx");
    writeFileSync(realVmx, 'checkpoint.vmState = ""\n', "utf8");
    unlinkSync(temporary.target.providerInstanceId);
    symlinkSync(realVmx, temporary.target.providerInstanceId);
    const runnerCounter = { calls: 0 };
    const vmware = new VmwareFusionProvider({
      vmrunExecutablePath: temporary.vmrunExecutablePath,
      target: temporary.target,
      runner: countingRunner(runnerCounter)
    });

    await assert.rejects(
      vmware.preflight(),
      /VMX path is not a readable regular file/
    );
    assert.equal(runnerCounter.calls, 0);
  });
});

test("revalidates configured files before every new lifecycle action", async (t) => {
  await t.test("rejects a vmrun path replaced after startup", async (subtest) => {
    const temporary = temporaryDefaultFileSystemTarget(subtest);
    const replacement = path.join(temporary.directory, "replacement-vmrun");
    writeFileSync(replacement, "replacement executable\n", "utf8");
    chmodSync(replacement, 0o700);
    const runnerCounter = { calls: 0 };
    const vmware = new VmwareFusionProvider({
      vmrunExecutablePath: temporary.vmrunExecutablePath,
      target: temporary.target,
      runner: countingRunner(runnerCounter),
      observationAttempts: 1,
      observationDelayMs: 0
    });

    await vmware.preflight();
    unlinkSync(temporary.vmrunExecutablePath);
    symlinkSync(replacement, temporary.vmrunExecutablePath);

    await assert.rejects(
      vmware.execute({
        idempotencyKey: "revalidate-replaced-vmrun",
        target: temporary.target,
        action: "start"
      }),
      /vmrun path is not an executable regular file/
    );
    assert.equal(runnerCounter.calls, 0);
  });

  await t.test("rejects a VMX path replaced after startup", async (subtest) => {
    const temporary = temporaryDefaultFileSystemTarget(subtest);
    const replacement = path.join(temporary.directory, "replacement.vmx");
    writeFileSync(replacement, 'checkpoint.vmState = ""\n', "utf8");
    const runnerCounter = { calls: 0 };
    const vmware = new VmwareFusionProvider({
      vmrunExecutablePath: temporary.vmrunExecutablePath,
      target: temporary.target,
      runner: countingRunner(runnerCounter),
      observationAttempts: 1,
      observationDelayMs: 0
    });

    await vmware.preflight();
    unlinkSync(temporary.target.providerInstanceId);
    symlinkSync(replacement, temporary.target.providerInstanceId);

    await assert.rejects(
      vmware.execute({
        idempotencyKey: "revalidate-replaced-vmx",
        target: temporary.target,
        action: "start"
      }),
      /VMX path is not a readable regular file/
    );
    assert.equal(runnerCounter.calls, 0);
  });
});

test("read-only observation rejects a VMX path replaced after startup", async (t) => {
  const temporary = temporaryDefaultFileSystemTarget(t);
  const replacement = path.join(temporary.directory, "replacement.vmx");
  writeFileSync(replacement, 'checkpoint.vmState = ""\n', "utf8");
  const runnerCounter = { calls: 0 };
  const vmware = new VmwareFusionProvider({
    vmrunExecutablePath: temporary.vmrunExecutablePath,
    target: temporary.target,
    runner: countingRunner(runnerCounter)
  });

  await vmware.preflight();
  unlinkSync(temporary.target.providerInstanceId);
  symlinkSync(replacement, temporary.target.providerInstanceId);

  await assert.rejects(
    vmware.observe(temporary.target),
    (error) => (
      error instanceof VmProviderError
      && error.outcome === "failed"
      && error.message.includes("VMX path is not a readable regular file")
    )
  );
  assert.equal(runnerCounter.calls, 0);
});

test("observes and controls only one configured VMware Fusion VM", async () => {
  const environment = new FakeVmwareEnvironment("stopped");
  const vmware = provider(environment);

  assert.equal((await vmware.observe(target)).status, "stopped");
  assert.equal((await vmware.execute({
    idempotencyKey: "start-1",
    target,
    action: "start"
  })).statusAfter, "running");
  assert.equal((await vmware.execute({
    idempotencyKey: "suspend-1",
    target,
    action: "suspend"
  })).statusAfter, "suspended");
  assert.equal((await vmware.execute({
    idempotencyKey: "resume-1",
    target,
    action: "resume"
  })).statusAfter, "running");
  assert.equal((await vmware.execute({
    idempotencyKey: "stop-1",
    target,
    action: "stop"
  })).statusAfter, "stopped");

  const actionRequests = environment.requests;
  assert.deepEqual(actionRequests.map((request) => request.args), [
    ["-T", "fusion", "start", vmxPath, "nogui"],
    ["-T", "fusion", "suspend", vmxPath, "soft"],
    ["-T", "fusion", "start", vmxPath, "nogui"],
    ["-T", "fusion", "stop", vmxPath, "soft"]
  ]);
  assert.ok(actionRequests.every((request) => request.args.includes(vmxPath)));
});

test("rejects any VM target other than the configured Studio instance", async () => {
  const environment = new FakeVmwareEnvironment("running");
  const vmware = provider(environment);

  await assert.rejects(
    vmware.observe({
      studioInstanceId: target.studioInstanceId,
      providerInstanceId: "/Users/test/Virtual Machines/Other/Other.vmx"
    }),
    /explicitly configured/
  );
  await assert.rejects(
    vmware.execute({
      idempotencyKey: "wrong-instance",
      target: { ...target, studioInstanceId: "instance-other" },
      action: "stop"
    }),
    /explicitly configured/
  );
  assert.equal(environment.requests.length, 0);
});

test("replays one adapter operation without issuing a second vmrun action", async () => {
  const environment = new FakeVmwareEnvironment("stopped");
  const vmware = provider(environment);
  const request = {
    idempotencyKey: "adapter-replay",
    target,
    action: "start" as const
  };

  const first = await vmware.execute(request);
  const actionCount = environment.requests.length;
  const replay = await vmware.execute(request);

  assert.deepEqual(replay, first);
  assert.equal(
    environment.requests.length,
    actionCount
  );
  await assert.rejects(
    vmware.execute({ ...request, action: "stop" }),
    /reused for a different request/
  );
});

test("surfaces bounded vmrun failure without claiming the state changed", async () => {
  const environment = new FakeVmwareEnvironment("running");
  environment.failAction = "suspend";
  environment.failureDiagnostic = [
    "permission denied while executing",
    vmrunPath,
    "for",
    vmxPath
  ].join(" ");
  const vmware = provider(environment);

  await assert.rejects(
    vmware.execute({
      idempotencyKey: "failing-suspend",
      target,
      action: "suspend"
    }),
    (error) => (
      error instanceof Error
      && error.message.includes("[configured-vmrun]")
      && error.message.includes("[configured-vmx]")
      && !error.message.includes(vmrunPath)
      && !error.message.includes(vmxPath)
    )
  );
  assert.equal(environment.state, "running");
});

test("classifies forced vmrun termination as indeterminate", async (t) => {
  for (const forcedTermination of [
    "timeout",
    "output-limit",
    "signal"
  ] as const) {
    await t.test(forcedTermination, async () => {
      const environment = new FakeVmwareEnvironment("running");
      environment.failAction = "suspend";
      environment.failureDiagnostic = [
        "forced termination while executing",
        vmrunPath,
        "for",
        vmxPath
      ].join(" ");
      environment.failureTimedOut = forcedTermination === "timeout";
      environment.failureOutputLimitExceeded =
        forcedTermination === "output-limit";
      environment.failureTerminationSignal = forcedTermination === "signal"
        ? "SIGTERM"
        : null;

      await assert.rejects(
        provider(environment).execute({
          idempotencyKey: `forced-${forcedTermination}`,
          target,
          action: "suspend"
        }),
        (error) => (
          error instanceof VmProviderError
          && error.outcome === "indeterminate"
          && !error.message.includes(vmrunPath)
          && !error.message.includes(vmxPath)
        )
      );
      assert.equal(environment.state, "running");
    });
  }
});

test("classifies a rejected process-runner boundary as indeterminate", async () => {
  const environment = new FakeVmwareEnvironment("running");
  environment.rejectAction = "suspend";
  environment.rejectionDiagnostic = [
    "runner disconnected while executing",
    vmrunPath,
    "for",
    vmxPath
  ].join(" ");

  await assert.rejects(
    provider(environment).execute({
      idempotencyKey: "rejected-runner-boundary",
      target,
      action: "suspend"
    }),
    (error) => (
      error instanceof VmProviderError
      && error.outcome === "indeterminate"
      && error.message.includes("execution boundary did not return a result")
      && error.message.includes("[configured-vmrun]")
      && error.message.includes("[configured-vmx]")
      && !error.message.includes(vmrunPath)
      && !error.message.includes(vmxPath)
    )
  );
  assert.equal(environment.requests.length, 1);
  assert.equal(environment.state, "running");
});

test("classifies unverifiable post-command outcomes as indeterminate", async (t) => {
  await t.test("state observation fails after vmrun success", async () => {
    const environment = new FakeVmwareEnvironment("running");
    environment.observationFailureAfterAction =
      `cannot read checkpoint under ${path.dirname(vmxPath)}`;

    await assert.rejects(
      provider(environment).execute({
        idempotencyKey: "post-command-observation-failed",
        target,
        action: "suspend"
      }),
      (error) => (
        error instanceof VmProviderError
        && error.outcome === "indeterminate"
        && error.message.includes("outcome could not be verified")
        && error.message.includes("[configured-vm-directory]")
        && !error.message.includes(path.dirname(vmxPath))
      )
    );
    assert.equal(environment.requests.length, 1);
    assert.equal(environment.state, "suspended");
  });

  await t.test("observed state does not converge after vmrun success", async () => {
    const environment = new FakeVmwareEnvironment("running");
    environment.ignoreSuccessfulAction = true;

    await assert.rejects(
      provider(environment).execute({
        idempotencyKey: "post-command-state-not-converged",
        target,
        action: "suspend"
      }),
      (error) => (
        error instanceof VmProviderError
        && error.outcome === "indeterminate"
        && error.message.includes("did not reach suspended; observed running")
      )
    );
    assert.equal(environment.requests.length, 1);
    assert.equal(environment.state, "running");
  });
});

test("default filesystem fails closed on a non-missing lock lookup error", async (t) => {
  const temporary = temporaryDefaultFileSystemTarget(t);
  let runnerCalls = 0;
  const vmware = new VmwareFusionProvider({
    vmrunExecutablePath: temporary.vmrunExecutablePath,
    target: temporary.target,
    runner: {
      async run(): Promise<ProcessRunResult> {
        runnerCalls += 1;
        throw new Error("runner must not be called during observation");
      }
    },
    now: () => "2026-08-01T13:00:00.000Z"
  });

  assert.equal((await vmware.observe(temporary.target)).status, "stopped");
  symlinkSync(temporary.lockPath, temporary.lockPath);

  await assert.rejects(
    vmware.observe(temporary.target),
    (error) => (
      error instanceof VmProviderError
      && error.outcome === "failed"
      && error.message.includes("VMware observation failed")
      && error.message.includes("[configured-vmx].lck")
      && !error.message.includes(path.dirname(temporary.lockPath))
    )
  );
  assert.equal(runnerCalls, 0);
});

test("default filesystem makes a post-command lock lookup error indeterminate", async (t) => {
  const temporary = temporaryDefaultFileSystemTarget(t);
  let runnerCalls = 0;
  const vmware = new VmwareFusionProvider({
    vmrunExecutablePath: temporary.vmrunExecutablePath,
    target: temporary.target,
    runner: {
      async run(): Promise<ProcessRunResult> {
        runnerCalls += 1;
        symlinkSync(temporary.lockPath, temporary.lockPath);
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          timedOut: false,
          outputLimitExceeded: false,
          terminationSignal: null
        };
      }
    },
    now: () => "2026-08-01T13:00:00.000Z",
    observationAttempts: 1,
    observationDelayMs: 0
  });

  await assert.rejects(
    vmware.execute({
      idempotencyKey: "post-command-lock-lookup-error",
      target: temporary.target,
      action: "start"
    }),
    (error) => (
      error instanceof VmProviderError
      && error.outcome === "indeterminate"
      && error.message.includes("outcome could not be verified")
      && error.message.includes("[configured-vmx].lck")
      && !error.message.includes(path.dirname(temporary.lockPath))
    )
  );
  assert.equal(runnerCalls, 1);
});

test("default filesystem never follows VMware state symbolic links", async (t) => {
  await t.test("running lock path", async (subtest) => {
    const temporary = temporaryDefaultFileSystemTarget(subtest);
    const actualLockDirectory = path.join(temporary.directory, "actual-lock");
    mkdirSync(actualLockDirectory);
    symlinkSync(actualLockDirectory, temporary.lockPath);
    const runnerCounter = { calls: 0 };
    const vmware = new VmwareFusionProvider({
      vmrunExecutablePath: temporary.vmrunExecutablePath,
      target: temporary.target,
      runner: countingRunner(runnerCounter)
    });

    await assert.rejects(
      vmware.observe(temporary.target),
      (error) => (
        error instanceof VmProviderError
        && error.outcome === "failed"
        && error.message.includes("[configured-vmx].lck")
        && error.message.includes("must not be a symbolic link")
        && !error.message.includes(temporary.directory)
      )
    );
    assert.equal(runnerCounter.calls, 0);
  });

  await t.test("checkpoint state path", async (subtest) => {
    const temporary = temporaryDefaultFileSystemTarget(subtest);
    const checkpointPath = path.join(
      temporary.directory,
      "Research Studio.vmss"
    );
    const actualCheckpoint = path.join(temporary.directory, "actual.vmss");
    writeFileSync(actualCheckpoint, "checkpoint fixture\n", "utf8");
    writeFileSync(
      temporary.target.providerInstanceId,
      'checkpoint.vmState = "Research Studio.vmss"\n',
      "utf8"
    );
    symlinkSync(actualCheckpoint, checkpointPath);
    const runnerCounter = { calls: 0 };
    const vmware = new VmwareFusionProvider({
      vmrunExecutablePath: temporary.vmrunExecutablePath,
      target: temporary.target,
      runner: countingRunner(runnerCounter)
    });

    await assert.rejects(
      vmware.observe(temporary.target),
      (error) => (
        error instanceof VmProviderError
        && error.outcome === "failed"
        && error.message.includes("[configured-vm-directory]")
        && error.message.includes("must not be a symbolic link")
        && !error.message.includes(temporary.directory)
      )
    );
    assert.equal(runnerCounter.calls, 0);
  });
});

test("redacts the configured VMX path from observation failures", async () => {
  const environment = new FakeVmwareEnvironment("stopped");
  environment.observationFailure = `ENOENT while opening ${vmxPath}`;

  await assert.rejects(
    provider(environment).observe(target),
    (error) => (
      error instanceof Error
      && error.message.includes("[configured-vmx]")
      && !error.message.includes(vmxPath)
    )
  );
  assert.equal(environment.requests.length, 0);
});

test("redacts configured parent directories and in-bundle state paths", async () => {
  const vmDirectory = path.dirname(vmxPath);
  const vmrunDirectory = path.dirname(vmrunPath);
  const statePath = path.join(vmDirectory, "Research Studio.vmss");
  const environment = new FakeVmwareEnvironment("running");
  environment.failAction = "suspend";
  environment.failureDiagnostic = [
    `vmrun directory ${vmrunDirectory}`,
    `could not access state ${statePath}`
  ].join("; ");

  await assert.rejects(
    provider(environment).execute({
      idempotencyKey: "redact-parent-directories",
      target,
      action: "suspend"
    }),
    (error) => (
      error instanceof Error
      && error.message.includes("[configured-vmrun-directory]")
      && error.message.includes("[configured-vm-directory]")
      && !error.message.includes(vmrunDirectory)
      && !error.message.includes(vmDirectory)
      && !error.message.includes(statePath)
    )
  );
  assert.equal(environment.state, "running");

  environment.state = "stopped";
  environment.observationFailure = `cannot read state under ${statePath}`;
  await assert.rejects(
    provider(environment).observe(target),
    (error) => (
      error instanceof Error
      && error.message.includes("[configured-vm-directory]")
      && !error.message.includes(vmDirectory)
      && !error.message.includes(statePath)
    )
  );
});

test("rejects a checkpoint state file that escapes the configured VM directory", async () => {
  const environment = new FakeVmwareEnvironment("stopped");
  environment.checkpoint = "escape";
  const vmware = provider(environment);

  await assert.rejects(vmware.observe(target), /escapes the configured VM directory/);
});

test("requires absolute executable and VMX paths at configuration time", () => {
  assert.throws(
    () => new VmwareFusionProvider({
      vmrunExecutablePath: "vmrun",
      target
    }),
    /absolute filesystem path/
  );
  assert.throws(
    () => new VmwareFusionProvider({
      vmrunExecutablePath: vmrunPath,
      target: { ...target, providerInstanceId: "/VMs/not-a-vmx.txt" }
    }),
    /must end in \.vmx/
  );
});
