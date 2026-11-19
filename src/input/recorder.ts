// Records one key combination from live key events, for adding a binding by
// pressing it. Pure state machine; the UI feeds it CapturedKeyEvents.
//
// - A non-modifier keydown completes the combo: that key plus every modifier
//   held at that moment.
// - A modifier pressed and released on its own (nothing else pressed while it
//   was down) records that modifier alone.

import { isModifierCode, modifierOf, type ModifierFlags, type Modifier } from './keys';

export interface RecorderState {
  /** Modifier codes pressed since the last time no keys were held. */
  pressedModifiers: string[];
  /** A non-modifier key was pressed while modifiers were held. */
  dirty: boolean;
}

export const initialRecorder: RecorderState = { pressedModifiers: [], dirty: false };

export interface RecordedCombo {
  codes: string[];
  /** AltGr was down: Right Alt on this layout also sends ControlLeft. */
  altGraph: boolean;
}

const FLAG: Record<Modifier, keyof ModifierFlags> = { Control: 'ctrl', Shift: 'shift', Alt: 'alt', Meta: 'meta' };

export function recorderStep(
  state: RecorderState,
  ev: { type: 'down' | 'up'; code: string; repeat: boolean; held: string[]; flags: ModifierFlags },
): { state: RecorderState; combo?: RecordedCombo } {
  if (ev.repeat || !ev.code) return { state };
  if (ev.type === 'down') {
    if (isModifierCode(ev.code)) {
      return { state: { pressedModifiers: [...new Set([...state.pressedModifiers, ev.code])], dirty: state.dirty } };
    }
    const mods = ev.held.filter((c) => c !== ev.code && isModifierCode(c));
    // A modifier whose own keydown was missed still shows in the flags; record it
    // as the generic modifier (either side).
    const sides = new Set(mods.map((c) => modifierOf(c)));
    const missing = (['Control', 'Shift', 'Alt', 'Meta'] as Modifier[]).filter(
      (m) => ev.flags[FLAG[m]] && !sides.has(m),
    );
    return {
      state: { ...state, dirty: true },
      combo: { codes: [...mods, ...missing, ev.code], altGraph: ev.flags.altGraph },
    };
  }
  // keyup
  if (isModifierCode(ev.code)) {
    const lone = !state.dirty && state.pressedModifiers.length === 1 && state.pressedModifiers[0] === ev.code;
    const stillHeld = ev.held.some(isModifierCode);
    const next = stillHeld ? state : initialRecorder;
    return lone ? { state: initialRecorder, combo: { codes: [ev.code], altGraph: false } } : { state: next };
  }
  return { state: ev.held.length ? state : initialRecorder };
}
