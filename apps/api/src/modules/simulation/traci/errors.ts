/** Error raised when SUMO rejects a TraCI command (non-OK status). */
export class TraCIError extends Error {
  readonly commandId: number;

  constructor(message: string, commandId = -1) {
    super(message);
    this.name = "TraCIError";
    this.commandId = commandId;
  }
}

/**
 * Error raised for protocol-level failures (connection lost, malformed
 * messages, timeouts). The connection cannot be trusted afterwards.
 */
export class FatalTraCIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalTraCIError";
  }
}
