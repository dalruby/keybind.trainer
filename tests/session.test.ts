import { describe, expect, it } from 'vitest';
import { parseSession, serializeSession, sessionFileStem } from '../src/model/session';
import type { Session } from '../src/model/types';
import { formatIssue } from '../src/model/yamlDoc';

const session: Session = {
  schema: 1,
  profile: 'azeron-wow',
  mode: 'normal',
  startedAt: '2026-11-19T20:15:03.120Z',
  durationPlanned: 300,
  durationActual: 300.42,
  bounces: 1,
  bindings: {
    'bar1-1': { fp: '3f9a1c00', keys: ['left.index:Digit1'] },
    'bar2-1': { fp: '81be0400', keys: ['left.index:Digit1', 'left.pinky:ControlLeft'] },
  },
  attempts: [
    { b: 'bar2-1', t: 1.2041, rt: 612.37, miss: [{ k: ['ShiftLeft', 'Digit1'], at: 380.04 }] },
    { b: 'bar1-1', t: 2.051, rt: 344 },
    { b: 'bar1-1', t: 299.9 },
  ],
};

describe('session YAML', () => {
  it('writes one line per attempt and binding', () => {
    const text = serializeSession(session);
    expect(text).toContain('  - { b: bar2-1, t: 1.204, rt: 612.4, miss: [ { k: [ ShiftLeft, Digit1 ], at: 380 } ] }');
    expect(text).toContain('  bar1-1: { fp: 3f9a1c00, keys: [ left.index:Digit1 ] }');
  });

  it('round-trips (with rounding)', () => {
    const r = parseSession(serializeSession(session));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.durationActual).toBe(300.4);
    expect(r.value.attempts[0]).toEqual({ b: 'bar2-1', t: 1.204, rt: 612.4, miss: [{ k: ['ShiftLeft', 'Digit1'], at: 380 }] });
    expect(r.value.attempts[2]).toEqual({ b: 'bar1-1', t: 299.9 });
  });

  it('rejects attempts for bindings not in the snapshot', () => {
    const text = serializeSession({ ...session, attempts: [{ b: 'nope', t: 1, rt: 2 }] });
    const r = parseSession(text);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.map(formatIssue).join('\n')).toContain('binding "nope" is not listed under bindings');
  });

  it('makes Windows-safe file names', () => {
    expect(sessionFileStem('2026-11-19T20:15:03.120Z')).toBe('2026-11-19T20-15-03');
  });
});
