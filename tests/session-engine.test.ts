import { describe, expect, it } from 'vitest';
import { matchKeyDown, type KeyDown } from '../src/session/matcher';
import { Scheduler } from '../src/session/scheduler';
import { SessionEngine } from '../src/session/engine';
import { parseSession, serializeSession } from '../src/model/session';
import { wowBarsTemplate } from '../src/model/templates';
import { median, quantile, summarizeSession } from '../src/stats/basic';
import type { Binding, Profile } from '../src/model/types';

const none = { ctrl: false, shift: false, alt: false, meta: false, altGraph: false };
const kd = (code: string, held: string[], flags: Partial<typeof none> = {}, repeat = false): KeyDown => ({
  code,
  held,
  flags: { ...none, ...flags },
  repeat,
});
const binding = (...codes: string[]): Binding => ({ id: 'x', keys: codes.map((code) => ({ code, finger: 'index' as const })) });

describe('matchKeyDown', () => {
  const ctrl1 = binding('ControlLeft', 'Digit1');
  it('accepts the exact combination', () => {
    expect(matchKeyDown(ctrl1, kd('Digit1', ['ControlLeft', 'Digit1'], { ctrl: true }))).toBe('correct');
    expect(matchKeyDown(binding('Digit1'), kd('Digit1', ['Digit1']))).toBe('correct');
  });
  it('ignores modifiers on their own and auto-repeat', () => {
    expect(matchKeyDown(ctrl1, kd('ControlLeft', ['ControlLeft'], { ctrl: true }))).toBe('ignore');
    expect(matchKeyDown(ctrl1, kd('ShiftLeft', ['ShiftLeft'], { shift: true }))).toBe('ignore');
    expect(matchKeyDown(ctrl1, kd('Digit1', ['ControlLeft', 'Digit1'], { ctrl: true }, true))).toBe('ignore');
  });
  it('misses: wrong key, missing/extra/wrong-side modifier, AltGr', () => {
    expect(matchKeyDown(ctrl1, kd('Digit2', ['ControlLeft', 'Digit2'], { ctrl: true }))).toBe('miss');
    expect(matchKeyDown(ctrl1, kd('Digit1', ['Digit1']))).toBe('miss');
    expect(matchKeyDown(ctrl1, kd('Digit1', ['ControlLeft', 'ShiftLeft', 'Digit1'], { ctrl: true, shift: true }))).toBe('miss');
    expect(matchKeyDown(ctrl1, kd('Digit1', ['ControlRight', 'Digit1'], { ctrl: true }))).toBe('miss');
    expect(matchKeyDown(binding('Digit1'), kd('Digit1', ['ControlLeft', 'AltRight', 'Digit1'], { altGraph: true }))).toBe('miss');
    expect(matchKeyDown(ctrl1, kd('Digit1', ['ControlLeft', 'AltRight', 'Digit1'], { altGraph: true }))).toBe('miss');
  });
  it('a modifier held with no keydown seen still counts via flags', () => {
    expect(matchKeyDown(binding('Digit1'), kd('Digit1', ['Digit1'], { shift: true }))).toBe('miss');
  });
  it('generic modifiers accept either side', () => {
    const any = binding('Control', 'Digit1');
    expect(matchKeyDown(any, kd('Digit1', ['ControlRight', 'Digit1'], { ctrl: true }))).toBe('correct');
    expect(matchKeyDown(any, kd('Digit1', ['Digit1'], { ctrl: true }))).toBe('correct');
  });
  it('misses when another key is still held', () => {
    expect(matchKeyDown(binding('Digit1'), kd('Digit1', ['KeyW', 'Digit1']))).toBe('miss');
  });
  it('handles a binding that is a single modifier', () => {
    const shift = binding('ShiftLeft');
    expect(matchKeyDown(shift, kd('ShiftLeft', ['ShiftLeft'], { shift: true }))).toBe('correct');
    expect(matchKeyDown(shift, kd('ControlLeft', ['ControlLeft'], { ctrl: true }))).toBe('ignore');
    expect(matchKeyDown(shift, kd('Digit1', ['Digit1']))).toBe('miss');
  });
});

describe('Scheduler', () => {
  it('never repeats the same binding twice in a row and covers all', () => {
    const s = new Scheduler(['a', 'b', 'c']);
    const seq = Array.from({ length: 300 }, () => s.next());
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    expect(new Set(seq)).toEqual(new Set(['a', 'b', 'c']));
  });
  it('allows repeats when there is only one binding', () => {
    const s = new Scheduler(['only']);
    expect([s.next(), s.next()]).toEqual(['only', 'only']);
  });
  it('respects weights', () => {
    const s = new Scheduler(['a', 'b', 'c', 'd'], seeded(7), new Map([['a', 10], ['b', 1], ['c', 1], ['d', 0]]));
    const counts = { a: 0, b: 0, c: 0, d: 0 } as Record<string, number>;
    for (let i = 0; i < 2000; i++) counts[s.next()]++;
    // a can't follow itself, so it gets just under half; d (weight 0) never comes up
    expect(counts.d).toBe(0);
    expect(counts.a).toBeGreaterThan(800);
    expect(counts.a).toBeGreaterThan(counts.b + counts.c - 100);
  });
});

/** Deterministic RNG for engine tests. */
function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function correctEvent(profile: Profile, id: string, timeStamp: number) {
  const b = profile.bindings.find((x) => x.id === id)!;
  const codes = b.keys.map((k) => k.code);
  const trigger = codes[codes.length - 1];
  return {
    code: trigger,
    held: codes,
    repeat: false,
    timeStamp,
    flags: { ...none, ctrl: codes.includes('ControlLeft'), shift: codes.includes('ShiftLeft'), alt: codes.includes('AltLeft') },
  };
}

describe('SessionEngine', () => {
  const profile = wowBarsTemplate('wow');

  it('runs prompts, times reactions, records misses and finishes', () => {
    const e = new SessionEngine(profile, { durationSec: 60, rng: seeded(), gapMs: 200 });
    e.start(1000, new Date('2026-11-19T20:00:00Z'));
    let b = e.nextPrompt();
    e.promptShown(1016);
    // a press before the prompt was shown is ignored
    expect(e.handleKeyDown({ ...correctEvent(profile, b.id, 1010) }).kind).toBe('ignore');
    const wrong = profile.bindings.find((x) => x.id !== b.id && x.keys.length === b.keys.length)!;
    const miss = e.handleKeyDown(correctEvent(profile, wrong.id, 1300));
    expect(miss).toMatchObject({ kind: 'miss', miss: { at: 284 } });
    const ok = e.handleKeyDown(correctEvent(profile, b.id, 1516));
    expect(ok).toMatchObject({ kind: 'correct', rt: 500 });
    expect(e.state).toBe('waiting');

    b = e.nextPrompt();
    e.promptShown(1800);
    expect(e.current?.attempt.t).toBeCloseTo(0.8);
    e.handleKeyDown(correctEvent(profile, b.id, 2150));

    const session = e.finish(3000);
    expect(session.attempts).toHaveLength(2);
    expect(session.attempts[0]).toMatchObject({ rt: 500, t: 0.016, miss: [{ at: 284 }] });
    expect(session.durationActual).toBe(2);
    expect(session.startedAt).toBe('2026-11-19T20:00:00.000Z');
    expect(Object.keys(session.bindings).sort()).toEqual([...new Set(session.attempts.map((a) => a.b))].sort());
    // the result is a valid session file
    expect(parseSession(serializeSession(session)).ok).toBe(true);
  });

  it('excludes paused time and drops the prompt that was interrupted', () => {
    const e = new SessionEngine(profile, { durationSec: 10, rng: seeded(2) });
    e.start(0);
    e.nextPrompt();
    e.promptShown(0);
    e.pause(4000);
    expect(e.current).toBeNull();
    expect(e.elapsedMs(9000)).toBe(4000);
    e.resume(9000);
    expect(e.remainingMs(12000)).toBe(3000);
    expect(e.isOver(15000)).toBe(true);
    expect(e.finish(15000).durationActual).toBe(10);
  });

  it('keeps an unfinished prompt with misses at the end, drops one without', () => {
    const e = new SessionEngine(profile, { durationSec: 5, rng: seeded(3) });
    e.start(0);
    const b = e.nextPrompt();
    e.promptShown(0);
    const other = profile.bindings.find((x) => x.id !== b.id && x.keys.length === 1 && b.keys.length === 1) ??
      profile.bindings.find((x) => x.id !== b.id)!;
    e.handleKeyDown(correctEvent(profile, other.id, 100));
    expect(e.finish(5000).attempts).toEqual([{ b: b.id, t: 0, miss: [expect.objectContaining({ at: 100 })] }]);

    const e2 = new SessionEngine(profile, { durationSec: 5, rng: seeded(3) });
    e2.start(0);
    e2.nextPrompt();
    e2.promptShown(0);
    expect(e2.finish(5000).attempts).toEqual([]);
  });

  it('limits to chosen bindings', () => {
    const e = new SessionEngine(profile, { durationSec: 5, bindingIds: ['bar1-1', 'bar1-2'] });
    expect(e.bindings.map((b) => b.id)).toEqual(['bar1-1', 'bar1-2']);
    expect(() => new SessionEngine(profile, { durationSec: 5, bindingIds: [] })).toThrow();
  });
});

describe('basic stats', () => {
  it('computes quantiles and medians', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(quantile([1, 2, 3, 4, 5], 0.9)).toBeCloseTo(4.6);
    expect(Number.isNaN(median([]))).toBe(true);
  });
  it('summarises a session after the warm-up', () => {
    const s = summarizeSession({
      schema: 1, profile: 'p', mode: 'normal', startedAt: '2026-01-01T00:00:00Z', durationPlanned: 1, durationActual: 1,
      warmup: 1,
      bindings: { a: { fp: 'x', keys: [] }, b: { fp: 'y', keys: [] } },
      attempts: [
        { b: 'a', t: 0, rt: 9999 },
        { b: 'a', t: 1, rt: 300 },
        { b: 'b', t: 2, rt: 500, miss: [{ k: [], at: 1 }, { k: [], at: 2 }] },
      ],
    });
    expect(s.total).toMatchObject({ attempts: 2, misses: 2, attemptsWithMiss: 1, medianRt: 400 });
    expect(s.perBinding.find((p) => p.id === 'a')).toMatchObject({ attempts: 1, medianRt: 300 });
  });
});
