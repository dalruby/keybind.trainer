import { describe, expect, it } from 'vitest';
import { initialRecorder, recorderStep, type RecordedCombo, type RecorderState } from '../src/input/recorder';

const none = { ctrl: false, shift: false, alt: false, meta: false, altGraph: false };
type Ev = { type: 'down' | 'up'; code: string; held: string[]; flags?: Partial<typeof none>; repeat?: boolean };

function record(events: Ev[]): RecordedCombo[] {
  let s: RecorderState = initialRecorder;
  const out: RecordedCombo[] = [];
  for (const e of events) {
    const r = recorderStep(s, { repeat: false, ...e, flags: { ...none, ...e.flags } });
    s = r.state;
    if (r.combo) out.push(r.combo);
  }
  return out;
}

describe('recorderStep', () => {
  it('records a plain key', () => {
    expect(record([{ type: 'down', code: 'Digit1', held: ['Digit1'] }])).toEqual([{ codes: ['Digit1'], altGraph: false }]);
  });

  it('records modifiers held when the key goes down, keeping their side', () => {
    const combos = record([
      { type: 'down', code: 'ShiftRight', held: ['ShiftRight'], flags: { shift: true } },
      { type: 'down', code: 'Digit4', held: ['ShiftRight', 'Digit4'], flags: { shift: true } },
    ]);
    expect(combos).toEqual([{ codes: ['ShiftRight', 'Digit4'], altGraph: false }]);
  });

  it('records a generic modifier when only the flag shows it', () => {
    expect(record([{ type: 'down', code: 'Digit2', held: ['Digit2'], flags: { ctrl: true } }])[0].codes).toEqual(['Control', 'Digit2']);
  });

  it('records a lone modifier tap', () => {
    const combos = record([
      { type: 'down', code: 'AltLeft', held: ['AltLeft'], flags: { alt: true } },
      { type: 'down', code: 'AltLeft', held: ['AltLeft'], flags: { alt: true }, repeat: true },
      { type: 'up', code: 'AltLeft', held: [] },
    ]);
    expect(combos).toEqual([{ codes: ['AltLeft'], altGraph: false }]);
  });

  it('does not record the modifier again after it was used in a combo', () => {
    const combos = record([
      { type: 'down', code: 'ControlLeft', held: ['ControlLeft'], flags: { ctrl: true } },
      { type: 'down', code: 'Digit1', held: ['ControlLeft', 'Digit1'], flags: { ctrl: true } },
      { type: 'up', code: 'Digit1', held: ['ControlLeft'], flags: { ctrl: true } },
      { type: 'up', code: 'ControlLeft', held: [] },
    ]);
    expect(combos.map((c) => c.codes)).toEqual([['ControlLeft', 'Digit1']]);
  });

  it('flags AltGr combos', () => {
    const combos = record([
      { type: 'down', code: 'Digit1', held: ['ControlLeft', 'AltRight', 'Digit1'], flags: { altGraph: true } },
    ]);
    expect(combos).toEqual([{ codes: ['ControlLeft', 'AltRight', 'Digit1'], altGraph: true }]);
  });
});
