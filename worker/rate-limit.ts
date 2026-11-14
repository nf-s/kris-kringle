interface Window {
  misses: number;
  startedAt: number;
}

/**
 * Counts failed link lookups per client so link passphrases cannot be guessed by brute force.
 * Held in memory, so it resets if the Durable Object restarts; that only shortens a lockout.
 */
export class MissLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly maxMisses: number,
    private readonly windowMs: number,
  ) {}

  isBlocked(client: string, now: number): boolean {
    const window = this.windows.get(client);
    return (
      window !== undefined &&
      now - window.startedAt < this.windowMs &&
      window.misses >= this.maxMisses
    );
  }

  recordMiss(client: string, now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= this.windowMs) this.windows.delete(key);
    }
    const window = this.windows.get(client);
    if (window) window.misses += 1;
    else this.windows.set(client, { misses: 1, startedAt: now });
  }
}
