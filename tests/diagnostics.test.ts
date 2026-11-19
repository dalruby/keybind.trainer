import { describe, expect, it } from 'vitest';
import { bindingSnapshot } from '../src/model/fingerprint';
import type { Attempt, Profile, Session } from '../src/model/types';
import {
  bindingStats,
  collectSamples,
  fingerSummaries,
  histogram,
  keyGrid,
  rankBindings,
  trend,
  weakSpots,
} from '../src/stats/diagnostics';

const profile: Profile = {
  schema: 1,
  id: 'p',
  name: 'P',
  defaultHand: 'left',
  bindings: [
    { id: 'one', keys: [{ code: 'Digit1', finger: 'index' }] },
    { id: 'two', keys: [{ code: 'Digit2', finger: 'index' }] },
    { id: 'c1', keys: [{ code: 'ControlLeft', finger: 'pinky' }, { code: 'Digit1', finger: 'index' }] },
    { id: 'q', keys: [{ code: 'KeyQ', finger: 'thumb', hand: 'right' }] },
  ],
};

function session(startedAt: string, attempts: Attempt[], opts: Partial<Session> = {}, p: Profile = profile): Session {
  const bindings: Session['bindings'] = {};
  for (const b of p.bindings) bindings[b.id] = bindingSnapshot(b, p);
  return { schema: 1, profile: 'p', mode: 'normal', startedAt, durationPlanned: 60, durationActual: 60, bindings, attempts, ...opts };
}

const s1 = session('2026-11-01T10:00:00Z', [
  { b: 'one', t: 1, rt: 300 },
  { b: 'one', t: 2, rt: 320 },
  { b: 'one', t: 3, rt: 340 },
  { b: 'two', t: 4, rt: 600, miss: [{ k: ['Digit3'], at: 200 }] },
  { b: 'two', t: 5, rt: 650, miss: [{ k: ['Digit3'], at: 100 }, { k: ['Digit1'], at: 300 }] },
  { b: 'two', t: 6, rt: 700 },
  { b: 'c1', t: 7, rt: 500 },
  { b: 'c1', t: 8, rt: 520 },
  { b: 'c1', t: 9, rt: 540 },
]);
const s2 = session('2026-11-02T10:00:00Z', [{ b: 'one', t: 1, rt: 9999 }, { b: 'one', t: 2, rt: 280 }], { warmup: 1, mode: 'weak-spot' });

describe('collectSamples', () => {
  it('orders sessions, drops warm-up and filters by mode and count', () => {
    const all = collectSamples(profile, [s2, s1]);
    expect(all.sessions.map((s) => s.startedAt)).toEqual([s1.startedAt, s2.startedAt]);
    expect(all.samples).toHaveLength(10);
    expect(collectSamples(profile, [s1, s2], { mode: 'normal' }).samples).toHaveLength(9);
    expect(collectSamples(profile, [s1, s2], { lastSessions: 1 }).samples).toHaveLength(1);
  });

  it('leaves out attempts from earlier versions of a binding and removed bindings', () => {
    const changed: Profile = {
      ...profile,
      bindings: [{ id: 'one', keys: [{ code: 'Digit1', finger: 'middle' }] }, profile.bindings[1]],
    };
    const set = collectSamples(changed, [s1]);
    expect(set.earlierVersion).toBe(3); // "one" now uses another finger
    expect(set.removed).toBe(3); // c1 no longer exists
    expect(set.samples.map((s) => s.attempt.b)).toEqual(['two', 'two', 'two']);
  });
});

describe('statistics', () => {
  const set = collectSamples(profile, [s1]);
  const per = bindingStats(set);
  const two = per.find((b) => b.id === 'two')!;

  it('computes per-binding numbers and confusions', () => {
    expect(two).toMatchObject({ n: 3, timed: 3, median: 650, misses: 3 });
    expect(two.missRate).toBeCloseTo(2 / 3);
    expect(two.confusions).toEqual([{ label: '3', count: 2 }, { label: '1', count: 1 }]);
    expect(two.cost).toBeCloseTo(650 + (2 / 3) * 1000);
    expect(per.find((b) => b.id === 'q')).toMatchObject({ n: 0, timed: 0 });
  });

  it('groups bindings per finger with roles, hand-aware', () => {
    const fingers = fingerSummaries(set, per);
    expect(fingers.map((f) => f.finger)).toEqual(['left.index', 'left.pinky', 'right.thumb']);
    const index = fingers[0];
    expect(index.bindings.map((b) => [b.stats.id, b.role])).toEqual([['one', 'trigger'], ['two', 'trigger'], ['c1', 'trigger']]);
    expect(index.stats.n).toBe(9);
    expect(fingers[1].bindings.map((b) => [b.stats.id, b.role])).toEqual([['c1', 'modifier']]);
  });

  it('ranks bindings best first and puts unranked last', () => {
    const index = fingerSummaries(set, per)[0];
    expect(rankBindings(index.bindings, 'median').map((b) => b.stats.id)).toEqual(['one', 'c1', 'two']);
    expect(rankBindings(index.bindings, 'missRate').map((b) => b.stats.id)).toEqual(['one', 'c1', 'two']);
    const thumb = fingerSummaries(set, per)[2];
    expect(rankBindings(thumb.bindings, 'median').map((b) => b.stats.id)).toEqual(['q']);
  });

  it('builds the trigger × modifier grid', () => {
    const grid = keyGrid(set, per);
    expect(grid.rows).toEqual(['', 'LCtrl']);
    const withMods: Profile = {
      ...profile,
      bindings: ['AltLeft', 'ShiftLeft', 'ControlLeft'].map((m) => ({ id: m, keys: [{ code: m, finger: 'pinky' as const }, { code: 'Digit5', finger: 'index' as const }] })),
    };
    expect(keyGrid(collectSamples(withMods, [])).rows).toEqual(['LCtrl', 'LShift', 'LAlt']);
    expect(grid.cols.map((c) => c.label)).toEqual(['1', '2', 'Q']);
    const c1 = grid.cells.find((c) => c.stats.id === 'c1')!;
    expect([c1.row, c1.col]).toEqual([1, 0]);
  });

  it('lists weak spots worst first, only with enough data', () => {
    expect(weakSpots(per).map((b) => b.id)).toEqual(['two', 'c1', 'one']);
  });

  it('makes one trend point per session', () => {
    const t = trend(collectSamples(profile, [s1, s2]), (a) => a.b === 'one');
    expect(t.map((p) => [p.session, p.stats.median])).toEqual([[0, 320], [1, 280]]);
  });

  it('bins reaction times', () => {
    expect(histogram([310, 320, 360, 455], 50)).toEqual([
      { from: 300, to: 350, count: 2 },
      { from: 350, to: 400, count: 1 },
      { from: 400, to: 450, count: 0 },
      { from: 450, to: 500, count: 1 },
    ]);
    expect(histogram([])).toEqual([]);
  });
});
