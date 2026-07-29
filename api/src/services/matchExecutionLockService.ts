type Release = () => void;

/**
 * Serializes execution-changing work for a single match inside this API process.
 *
 * Server preparation spans several asynchronous DB/RCON operations, so a plain
 * read-then-update guard is not sufficient: Hold/Postpone could otherwise race
 * with allocation and leave a parked match loaded on a reserved server.
 */
class MatchExecutionLockService {
  private static readonly CONTROL_TRANSITION_KEY = '\u0000operator-control-transition';
  private readonly tails = new Map<string, Promise<void>>();

  runControlTransitionExclusive<T>(operation: () => Promise<T>): Promise<T> {
    return this.runExclusive(MatchExecutionLockService.CONTROL_TRANSITION_KEY, operation);
  }

  async runExclusive<T>(matchSlug: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(matchSlug) ?? Promise.resolve();
    let release: Release = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.tails.set(matchSlug, tail);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(matchSlug) === tail) {
        this.tails.delete(matchSlug);
      }
    }
  }
}

export const matchExecutionLockService = new MatchExecutionLockService();
