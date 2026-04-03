export class FetchSynchronizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchSynchronizationError";
  }
}

export class StateConflictError extends Error {
  latestStateVersion: number;

  constructor(message: string, latestStateVersion: number) {
    super(message);
    this.name = "StateConflictError";
    this.latestStateVersion = latestStateVersion;
  }
}

export class TurnLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TurnLockedError";
  }
}

export class TurnAbandonedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TurnAbandonedError";
  }
}

export class InvalidExpectedStateVersionError extends Error {
  latestStateVersion: number;

  constructor(message: string, latestStateVersion: number) {
    super(message);
    this.name = "InvalidExpectedStateVersionError";
    this.latestStateVersion = latestStateVersion;
  }
}

export class StalePromptContextError extends Error {
  constructor(message = "stale_prompt_context") {
    super(message);
    this.name = "StalePromptContextError";
  }
}
