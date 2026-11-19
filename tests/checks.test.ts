import { describe, expect, it } from 'vitest';
import { altTapStep, arm, focusLost, initialAltTap, newCheck, settle, type AltTapState } from '../src/input/checks';

describe('focus checks', () => {
  it('passes when focus is kept for the whole window', () => {
    let c = arm(newCheck(), 0);
    c = settle(c, 500);
    expect(c.status).toBe('waiting');
    c = settle(c, 1000);
    expect(c).toMatchObject({ status: 'pass', passes: 1, failures: 0 });
  });
  it('fails when focus is lost inside the window', () => {
    const c = focusLost(arm(newCheck(), 0), 300);
    expect(c).toMatchObject({ status: 'fail', passes: 0, failures: 1 });
  });
  it('ignores focus loss after the window elapsed', () => {
    const c = focusLost(arm(newCheck(), 0), 5000);
    expect(c).toMatchObject({ status: 'pass', failures: 0 });
  });
  it('ignores focus loss when not armed', () => {
    expect(focusLost(newCheck(), 10).status).toBe('untested');
  });
});

describe('altTapStep', () => {
  type Ev = { type: 'down' | 'up'; code: string; repeat?: boolean };
  const run = (events: Ev[]) => {
    let s: AltTapState = initialAltTap;
    const taps: boolean[] = [];
    for (const e of events) {
      const r = altTapStep(s, { repeat: false, ...e });
      s = r.state;
      taps.push(r.tapped);
    }
    return taps;
  };

  it('detects a lone Alt tap', () => {
    expect(run([{ type: 'down', code: 'AltLeft' }, { type: 'up', code: 'AltLeft' }])).toEqual([false, true]);
  });
  it('ignores auto-repeat while holding Alt', () => {
    expect(
      run([
        { type: 'down', code: 'AltLeft' },
        { type: 'down', code: 'AltLeft', repeat: true },
        { type: 'up', code: 'AltLeft' },
      ]).at(-1),
    ).toBe(true);
  });
  it('does not count Alt used as a modifier', () => {
    expect(
      run([
        { type: 'down', code: 'AltLeft' },
        { type: 'down', code: 'Digit4' },
        { type: 'up', code: 'Digit4' },
        { type: 'up', code: 'AltLeft' },
      ]).at(-1),
    ).toBe(false);
  });
});
