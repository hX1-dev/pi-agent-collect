import assert from "node:assert/strict";
import test from "node:test";
import { NodeProcessRunner } from "./process-runner.js";

const runner = new NodeProcessRunner();

test("executes a fixed binary with a literal argument vector and no shell", async () => {
  const literalArguments = ["argument with spaces", "$(touch should-not-run)"];
  const result = await runner.run({
    executable: process.execPath,
    args: [
      "-e",
      "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
      ...literalArguments
    ],
    timeoutMs: 1_000,
    maxOutputBytes: 1_024
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), literalArguments);
  assert.equal(result.stderr, "");
  assert.equal(result.timedOut, false);
  assert.equal(result.outputLimitExceeded, false);
  assert.equal(result.terminationSignal, null);
});

test("reports a forced timeout separately from a normal process failure", async () => {
  const result = await runner.run({
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1_000)"],
    timeoutMs: 50,
    maxOutputBytes: 1_024
  });

  assert.notEqual(result.exitCode, 0);
  assert.equal(result.timedOut, true);
  assert.equal(result.outputLimitExceeded, false);
});

test("reports forced output-limit termination without mislabeling it as timeout", async () => {
  const maxOutputBytes = 64;
  const result = await runner.run({
    executable: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(1_024))"],
    timeoutMs: 1_000,
    maxOutputBytes
  });

  assert.notEqual(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.outputLimitExceeded, true);
  assert.ok(Buffer.byteLength(result.stdout, "utf8") <= maxOutputBytes);
});

test("reports an independent operating-system signal termination", async () => {
  const result = await runner.run({
    executable: process.execPath,
    args: ["-e", "process.kill(process.pid, 'SIGTERM')"],
    timeoutMs: 1_000,
    maxOutputBytes: 1_024
  });

  assert.notEqual(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.outputLimitExceeded, false);
  assert.equal(result.terminationSignal, "SIGTERM");
});
