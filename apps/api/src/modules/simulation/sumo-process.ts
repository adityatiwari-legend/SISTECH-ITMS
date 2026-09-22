import { spawn } from "node:child_process";
import { createServer as createTcpServer } from "node:net";

export interface SumoProcessOptions {
  /** SUMO executable path or name resolvable via PATH. */
  binary: string;
  /** Path to the .sumocfg to load. */
  configPath: string;
  /** TCP port for the TraCI server (--remote-port). */
  port: number;
  /** Simulation step length in seconds (--step-length). */
  stepLengthSeconds: number;
  /** Optional --end override in seconds. */
  endSeconds?: number;
}

export interface SumoProcessHandle {
  port: number;
  /** Resolves when the process exits (or immediately if spawning failed). */
  exitPromise: Promise<{ code: number | null; signal: string | null; spawnError?: string }>;
  /** Whether the process has exited. */
  hasExited(): boolean;
  /** Spawn failure message, if the process could not be started at all. */
  spawnError(): string | null;
  /** Last stderr lines (ring buffer) for diagnostics. */
  stderrTail(): string[];
  /** Last stdout lines (ring buffer) for diagnostics. */
  stdoutTail(): string[];
  /** Forcibly terminates the process tree. */
  kill(): Promise<void>;
}

const LOG_TAIL_LINES = 50;

/**
 * Starts a headless SUMO process in TraCI remote mode.
 *
 * The simulation is not stepped until commands arrive; the TraCI client
 * drives every step (no --start flag is passed).
 */
export function startSumoProcess(options: SumoProcessOptions): SumoProcessHandle {
  const args = [
    "-c", options.configPath,
    "--remote-port", String(options.port),
    "--step-length", String(options.stepLengthSeconds),
    "--no-step-log", "true",
  ];
  if (options.endSeconds !== undefined) {
    args.push("--end", String(options.endSeconds));
  }

  const child = spawn(options.binary, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  let exited = false;
  let exitInfo: { code: number | null; signal: string | null; spawnError?: string } | null = null;

  const collect = (target: string[], chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line.length > 0) {
        target.push(line);
        if (target.length > LOG_TAIL_LINES) target.shift();
      }
    }
  };
  child.stdout?.on("data", (chunk: Buffer) => collect(stdoutLines, chunk));
  child.stderr?.on("data", (chunk: Buffer) => collect(stderrLines, chunk));

  let resolveExit: (value: { code: number | null; signal: string | null; spawnError?: string }) => void = () => undefined;
  const exitPromise = new Promise<{ code: number | null; signal: string | null; spawnError?: string }>((resolve) => {
    resolveExit = resolve;
  });

  const finish = (value: { code: number | null; signal: string | null; spawnError?: string }) => {
    if (exitInfo === null) {
      exited = true;
      exitInfo = value;
      resolveExit(value);
    }
  };

  child.on("error", (err: Error) => {
    const code = (err as NodeJS.ErrnoException).code ?? "";
    const hint =
      code === "ENOENT"
        ? `SUMO executable "${options.binary}" was not found. Install SUMO (e.g. 'pip install eclipse-sumo'), set SUMO_BINARY, or check PATH.`
        : `SUMO process could not be started: ${err.message}`;
    stderrLines.push(hint);
    finish({ code: null, signal: null, spawnError: hint });
  });
  child.on("exit", (code, signal) => {
    finish({ code, signal });
  });

  return {
    port: options.port,
    exitPromise,
    hasExited: () => exited,
    spawnError: () => exitInfo?.spawnError ?? null,
    stderrTail: () => [...stderrLines],
    stdoutTail: () => [...stdoutLines],
    kill: async () => {
      if (exited) return;
      if (process.platform === "win32") {
        // Tree-kill so wrappers/children of the SUMO launcher cannot survive.
        await new Promise<void>((resolve) => {
          const killer = spawn("taskkill", ["/PID", String(child.pid ?? 0), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
          killer.on("exit", () => resolve());
          killer.on("error", () => {
            child.kill();
            resolve();
          });
        });
      } else {
        child.kill("SIGKILL");
      }
      await Promise.race([
        exitPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
    },
  };
}

/** Finds an available TCP port on localhost (best effort; small race window). */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createTcpServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("Could not determine a free port")));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}
