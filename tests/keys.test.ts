import { describe, expect, it } from 'vitest';
import { codeLabel, comboLabel, digitSlot, modifiersHeld, reconcileHeld, sideOf } from '../src/input/keys';

const noFlags = { ctrl: false, shift: false, alt: false, meta: false, altGraph: false };

describe('codeLabel / comboLabel', () => {
  it('labels common codes', () => {
    expect(codeLabel('Digit1')).toBe('1');
    expect(codeLabel('KeyQ')).toBe('Q');
    expect(codeLabel('ControlLeft')).toBe('LCtrl');
    expect(codeLabel('AltRight')).toBe('RAlt');
    expect(codeLabel('MetaLeft')).toBe('LWin');
  });
  it('orders modifiers before the trigger key', () => {
    expect(comboLabel(['Digit1', 'ShiftLeft', 'ControlLeft'])).toBe('LCtrl + LShift + 1');
  });
});

describe('sideOf / modifiersHeld', () => {
  it('distinguishes left and right modifiers', () => {
    expect(sideOf('ShiftLeft')).toBe('left');
    expect(sideOf('ShiftRight')).toBe('right');
    expect(sideOf('Digit1')).toBeUndefined();
  });
  it('collapses sides into logical modifiers', () => {
    expect([...modifiersHeld(['ControlLeft', 'ControlRight', 'Digit2'])]).toEqual(['Control']);
  });
});

describe('reconcileHeld', () => {
  it('drops modifiers the browser reports as released', () => {
    const held = new Set(['ControlLeft', 'Digit1']);
    expect([...reconcileHeld(held, noFlags)]).toEqual(['Digit1']);
  });
  it('keeps the AltGr keys held while AltGr is down (ctrl/alt flags are false then)', () => {
    const held = new Set(['ControlLeft', 'AltRight', 'Digit1']);
    expect([...reconcileHeld(held, { ...noFlags, altGraph: true })].sort()).toEqual(['AltRight', 'ControlLeft', 'Digit1']);
  });
  it('keeps modifiers that are still down', () => {
    const held = new Set(['AltLeft', 'Digit3']);
    expect([...reconcileHeld(held, { ...noFlags, alt: true })].sort()).toEqual(['AltLeft', 'Digit3']);
  });
});

describe('digitSlot', () => {
  const ctrl = { ...noFlags, ctrl: true };
  const alt = { ...noFlags, alt: true };
  it('maps plain digits to bar 1', () => {
    expect(digitSlot('Digit0', ['Digit0'], noFlags)).toEqual({ digit: 0, mod: 'none' });
  });
  it('maps a single modifier with its side', () => {
    expect(digitSlot('Digit5', ['ControlLeft', 'Digit5'], ctrl)).toEqual({ digit: 5, mod: 'Control', side: 'left' });
    expect(digitSlot('Digit5', ['AltRight', 'Digit5'], alt)).toEqual({ digit: 5, mod: 'Alt', side: 'right' });
  });
  it('trusts the flags when the modifier keydown was never seen', () => {
    expect(digitSlot('Digit2', ['Digit2'], ctrl)).toEqual({ digit: 2, mod: 'Control', side: undefined });
  });
  it('reports no side when both sides are held', () => {
    expect(digitSlot('Digit2', ['ShiftLeft', 'ShiftRight', 'Digit2'], { ...noFlags, shift: true })).toMatchObject({
      mod: 'Shift',
      side: undefined,
    });
  });
  it('never treats AltGr + digit as the plain digit', () => {
    expect(digitSlot('Digit1', ['ControlLeft', 'AltRight', 'Digit1'], { ...noFlags, altGraph: true })).toBeNull();
  });
  it('rejects multiple modifiers, Win, other keys and non-digits', () => {
    expect(digitSlot('Digit1', ['ControlLeft', 'ShiftLeft', 'Digit1'], { ...ctrl, shift: true })).toBeNull();
    expect(digitSlot('Digit1', ['MetaLeft', 'Digit1'], { ...noFlags, meta: true })).toBeNull();
    expect(digitSlot('Digit1', ['KeyW', 'Digit1'], noFlags)).toBeNull();
    expect(digitSlot('KeyQ', ['KeyQ'], noFlags)).toBeNull();
  });
});
