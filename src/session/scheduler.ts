// Picks the next binding to prompt: random, never the same one twice in a row.
// Weights are optional so weak-spot mode (milestone 6) can reuse this.

export type Rng = () => number;

export class Scheduler {
  private last: string | null = null;

  constructor(
    private ids: string[],
    private rng: Rng = Math.random,
    private weights?: Map<string, number>,
  ) {
    if (ids.length === 0) throw new Error('Scheduler needs at least one binding');
  }

  next(): string {
    const candidates = this.ids.length > 1 ? this.ids.filter((id) => id !== this.last) : this.ids;
    const weightOf = (id: string) => Math.max(0, this.weights?.get(id) ?? 1);
    const total = candidates.reduce((sum, id) => sum + weightOf(id), 0);
    let pick: string;
    if (total <= 0) {
      pick = candidates[Math.floor(this.rng() * candidates.length)];
    } else {
      let r = this.rng() * total;
      pick = candidates[candidates.length - 1];
      for (const id of candidates) {
        r -= weightOf(id);
        if (r < 0) {
          pick = id;
          break;
        }
      }
    }
    this.last = pick;
    return pick;
  }
}
