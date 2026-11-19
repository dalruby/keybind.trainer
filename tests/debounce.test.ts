import { describe, expect, it } from 'vitest';
import { Debouncer } from '../src/input/debounce';

type Ev = [type: 'down' | 'up', code: string, t: number, repeat?: boolean];

/** Returns the events that survive filtering. */
function run(events: Ev[]): Ev[] {
  const d = new Debouncer(10);
  return events.filter(([type, code, t, repeat]) => !d.filter(type, code, repeat ?? false, t));
}

describe('Debouncer', () => {
  it('drops a release bounce (sequence seen on Digit4 during the Windows test)', () => {
    const events: Ev[] = [
      ['down', 'Digit4', 95955.9],
      ['up', 'Digit4', 96001.6],
      ['down', 'Digit4', 96001.9],
      ['up', 'Digit4', 96002.3],
    ];
    expect(run(events)).toEqual(events.slice(0, 2));
  });

  it('collapses a press bounce into one press at the first keydown', () => {
    const events: Ev[] = [
      ['down', 'Digit1', 0],
      ['up', 'Digit1', 1],
      ['down', 'Digit1', 2],
      ['down', 'Digit1', 500, true],
      ['up', 'Digit1', 600],
    ];
    expect(run(events)).toEqual(events.slice(0, 2));
  });

  it('keeps fast but human re-presses', () => {
    const events: Ev[] = [
      ['down', 'Digit2', 0],
      ['up', 'Digit2', 40],
      ['down', 'Digit2', 75],
      ['up', 'Digit2', 120],
    ];
    expect(run(events)).toEqual(events);
  });

  it('tracks each key separately', () => {
    const events: Ev[] = [
      ['down', 'Digit1', 0],
      ['up', 'Digit1', 50],
      ['down', 'Digit2', 52],
      ['up', 'Digit2', 90],
    ];
    expect(run(events)).toEqual(events);
  });

  it('lets the next press through after a swallowed bounce', () => {
    const events: Ev[] = [
      ['down', 'Digit4', 0],
      ['up', 'Digit4', 50],
      ['down', 'Digit4', 51],
      ['up', 'Digit4', 52],
      ['down', 'Digit4', 300],
      ['up', 'Digit4', 350],
    ];
    expect(run(events)).toEqual([events[0], events[1], events[4], events[5]]);
  });
});
