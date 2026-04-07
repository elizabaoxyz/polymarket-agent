/**
 * Simple async mutex to prevent concurrent access to shared resources.
 * Used to serialize runtime message handling and autonomy loop operations.
 */

export class AsyncMutex {
  private _locked = false;
  private readonly _queue: Array<() => void> = [];

  get isLocked(): boolean {
    return this._locked;
  }

  /**
   * Acquire the lock. If already locked, waits until released.
   * Returns a release function.
   */
  async acquire(): Promise<() => void> {
    if (!this._locked) {
      this._locked = true;
      return this._createRelease();
    }

    return new Promise<() => void>((resolve) => {
      this._queue.push(() => {
        resolve(this._createRelease());
      });
    });
  }

  /**
   * Execute a function while holding the lock.
   * Automatically releases after completion or error.
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private _createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      const next = this._queue.shift();
      if (next) {
        // Keep lock held, pass to next waiter
        next();
      } else {
        this._locked = false;
      }
    };
  }
}
