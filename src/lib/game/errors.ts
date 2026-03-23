export class FetchSynchronizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchSynchronizationError";
  }
}
