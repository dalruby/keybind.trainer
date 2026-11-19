import { describe, expect, it } from 'vitest';
import { bindingSnapshot } from '../src/model/fingerprint';
import type { Attempt, Profile, Session } from '../src/model/types';
import { WEIGHT_MAX, WEIGHT_MIN, WEIGHT_UNKNOWN, weakSpotWeights } from '../src/stats/weights';
import { Scheduler } from '../src/session/scheduler';

const ids = ['fast', 'mid', 'slow', 'wild', 'new'];
const profile: Profile = {
  schema: 1,
  id: 'p',
  name: 'P',
  defaultHand: 'left',
  bindings: ids.map((id, i) => ({ id, keys: [{ code: `Digit${i + 1}`, finger: 'index' as const }] })),
};

function session(attempts: Attempt[]): Session {
  const bindings: Session['bindings'] = {};
  for (const b of profile.bindings) bindings[b.id] = bindingSnapshot(b, profile);
  return { schema: 1, profile: 'p', mode: 'normal', startedAt: '2026-11-01T10:00:00Z', durationPlanned: 60, durationActual: 60, bindings, attempts };
}

const many = (b: string, rt: number, n = 5, miss = 0): Attempt[] =>
  Array.from({ length: n }, (_, i) => ({ b, t: i, rt, ...(i < miss ? { miss: [{ k: ['Digit9'], at: 10 }] } : {}) }));

const s = session([...many('fast', 200), ...many('mid', 400), ...many('slow', 800), ...many('wild', 400, 5, 5)]);

describe('weakSpotWeights', () => {
  const info = weakSpotWeights(profile, [s]);

  it('weights by cost relative to the typical binding, clamped', () => {
    // costs: fast 200, mid 400, slow 800, wild 400 + 1.0 × 1000 = 1400; typical (lower median) = 400
    expect(info.weights.get('mid')).toBeCloseTo(1);
    expect(info.weights.get('fast')).toBe(WEIGHT_MIN); // (0.5)² = 0.25
    expect(info.weights.get('slow')).toBeCloseTo(4);
    expect(info.weights.get('wild')).toBe(WEIGHT_MAX); // (3.5)² clamped
    expect(info.measured).toBe(4);
  });

  it('gives bindings without enough data a moderate weight', () => {
    expect(info.weights.get('new')).toBe(WEIGHT_UNKNOWN);
  });

  it('shares sum to 1', () => {
    expect([...info.share.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it('is uniform without any data', () => {
    const empty = weakSpotWeights(profile, []);
    expect(new Set(empty.weights.values())).toEqual(new Set([WEIGHT_UNKNOWN]));
    expect(empty.measured).toBe(0);
  });

  it('can be limited to chosen bindings', () => {
    expect([...weakSpotWeights(profile, [s], ['slow', 'wild']).weights.keys()]).toEqual(['slow', 'wild']);
  });

  it('makes the scheduler favour weak spots while keeping strong ones', () => {
    let seed = 5;
    const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const sched = new Scheduler(ids, rng, info.weights);
    const counts = new Map<string, number>();
    for (let i = 0; i < 5000; i++) {
      const id = sched.next();
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect(counts.get('wild')!).toBeGreaterThan(counts.get('mid')! * 2);
    expect(counts.get('fast')!).toBeGreaterThan(100);
  });
});
