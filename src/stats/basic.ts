// Small statistics helpers. Milestone 5 builds the full diagnostics on these.

import type { Attempt, Session } from '../model/types';

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(values: number[]): number {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

export interface BindingSummary {
  id: string;
  attempts: number;
  /** Attempts with at least one miss. */
  attemptsWithMiss: number;
  misses: number;
  medianRt: number;
}

/** Attempts that count for statistics (after the warm-up). */
export function countedAttempts(session: Session): Attempt[] {
  return session.attempts.slice(session.warmup ?? 0);
}

export function summarizeSession(session: Session): { total: BindingSummary; perBinding: BindingSummary[] } {
  const attempts = countedAttempts(session);
  const summarize = (id: string, list: Attempt[]): BindingSummary => ({
    id,
    attempts: list.length,
    attemptsWithMiss: list.filter((a) => a.miss?.length).length,
    misses: list.reduce((n, a) => n + (a.miss?.length ?? 0), 0),
    medianRt: median(list.flatMap((a) => (a.rt !== undefined ? [a.rt] : []))),
  });
  const byId = new Map<string, Attempt[]>();
  for (const a of attempts) byId.set(a.b, [...(byId.get(a.b) ?? []), a]);
  return {
    total: summarize('all', attempts),
    perBinding: [...byId].map(([id, list]) => summarize(id, list)),
  };
}
