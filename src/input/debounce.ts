// Filters out switch bounce: a key that is released and pressed again within
// a few milliseconds. No finger can re-press a key that fast, so the extra
// down/up pair is noise from the hardware.
//
// Release bounce (down … up, down, up) and press bounce (down, up, down … up)
// both come out as a single press timed at the first keydown.

export const BOUNCE_MS = 10;

export class Debouncer {
  private lastUpAt = new Map<string, number>();
  /** Codes whose bounced keydown was swallowed; their next keyup is swallowed too. */
  private swallowing = new Set<string>();

  constructor(private windowMs = BOUNCE_MS) {}

  /** Returns true if the event should be dropped. */
  filter(type: 'down' | 'up', code: string, repeat: boolean, t: number): boolean {
    if (type === 'down') {
      if (repeat) return this.swallowing.has(code);
      const upAt = this.lastUpAt.get(code);
      if (upAt !== undefined && t - upAt < this.windowMs) {
        this.swallowing.add(code);
        return true;
      }
      return false;
    }
    if (this.swallowing.has(code)) {
      // This keyup belongs to the swallowed keydown. The key was already
      // reported as released, so drop it but remember when it happened.
      this.swallowing.delete(code);
      this.lastUpAt.set(code, t);
      return true;
    }
    this.lastUpAt.set(code, t);
    return false;
  }

  reset(): void {
    this.lastUpAt.clear();
    this.swallowing.clear();
  }
}
