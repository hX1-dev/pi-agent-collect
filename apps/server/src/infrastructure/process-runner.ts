import { execFile } from "node:child_process";

export interface ProcessRunRequest {
  executable: string;
  args: string[];
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface ProcessRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputLimitExceeded: boolean;
  terminationSignal: string | null;
}

export interface ProcessRunner {
  run(request: ProcessRunRequest): Promise<ProcessRunResult>;
}

/**
 * Executes one binary directly with an argument vector. No shell is involved,
 * so VM paths and user-controlled identifiers are never re-tokenized.
 */
export class NodeProcessRunner implements ProcessRunner {
  run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    return new Promise((resolve) => {
      execFile(
        request.executable,
        request.args,
        {
          encoding: "utf8",
          timeout: request.timeoutMs,
          maxBuffer: request.maxOutputBytes,
          windowsHide: true
        },
        (error, stdout, stderr) => {
          const outputLimitExceeded =
            error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
          const exitCode = typeof error?.code === "number"
            ? error.code
            : error
              ? 127
              : 0;
          const errorText = error && typeof error.code !== "number"
            ? `${stderr}${stderr ? "\n" : ""}${error.message}`
            : stderr;
          resolve({
            exitCode,
            stdout,
            stderr: errorText,
            timedOut: Boolean(error?.killed) && !outputLimitExceeded,
            outputLimitExceeded,
            terminationSignal: error?.signal ?? null
          });
        }
      );
    });
  }
}
