// Weights for weak-spot mode: bindings that are slow or error-prone come up
// more often, but every binding keeps a minimum share so strengths don't fade.

import type { Profile, Session } from '../model/types';
import { MIN_TIMED, bindingStats, collectSamples } from './diagnostics';

export const WEIGHT_MIN = 0.25;
export const WEIGHT_MAX = 4;
/** Bindings without enough data yet get this weight, so they collect some. */
export const WEIGHT_UNKNOWN = 1.5;
/** Weights are based on this many recent sessions (all modes). */
export const WEIGHT_SESSIONS = 10;

export interface WeightInfo {
  weights: Map<string, number>;
  /** Bindings that had enough data to be weighted by their results. */
  measured: number;
  /** Share of prompts each binding can expect (weights normalised to 1). */
  share: Map<string, number>;
}

/**
 * weight = (cost / median cost)², clamped to [0.25, 4]. A binding twice as
 * costly as the typical one comes up about four times as often.
 */
export function weakSpotWeights(profile: Profile, sessions: Session[], bindingIds?: string[]): WeightInfo {
  const set = collectSamples(profile, sessions, { lastSessions: WEIGHT_SESSIONS });
  const wanted = bindingIds ? new Set(bindingIds) : null;
  const stats = bindingStats(set).filter((b) => !wanted || wanted.has(b.id));
  const measured = stats.filter((b) => b.timed >= MIN_TIMED && !Number.isNaN(b.cost));
  const costs = measured.map((b) => b.cost).sort((a, b) => a - b);
  const typical = costs.length ? costs[Math.floor((costs.length - 1) / 2)] : NaN;

  const weights = new Map<string, number>();
  for (const b of stats) {
    const known = measured.includes(b) && typical > 0;
    const w = known ? Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, (b.cost / typical) ** 2)) : WEIGHT_UNKNOWN;
    weights.set(b.id, w);
  }
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  const share = new Map([...weights].map(([id, w]) => [id, total ? w / total : 0]));
  return { weights, measured: measured.length, share };
}
