/** Minimal structured JSON logger (no external dependency). */
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type LevelName = keyof typeof LEVELS;

export function createLogger(scope: string, level: LevelName = "info"): Logger {
  const write = (name: LevelName, message: string, data?: Record<string, unknown>): void => {
    if (LEVELS[name] < LEVELS[level]) return;
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level: name,
      scope,
      message,
    };
    if (data !== undefined) {
      entry.data = data;
    }
    const line = JSON.stringify(entry, (_, value) => (value instanceof Error ? { name: value.name, message: value.message } : value));
    if (name === "error") {
      console.error(line);
    } else if (name === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  };

  return {
    debug: (message, data) => write("debug", message, data),
    info: (message, data) => write("info", message, data),
    warn: (message, data) => write("warn", message, data),
    error: (message, data) => write("error", message, data),
  };
}

export function parseLogLevel(value: string | undefined): LevelName {
  if (value === undefined || value === "") return "info";
  const normalized = value.toLowerCase();
  if (normalized in LEVELS) return normalized as LevelName;
  throw new Error(`Invalid LOG_LEVEL "${value}". Allowed: debug, info, warn, error.`);
}
