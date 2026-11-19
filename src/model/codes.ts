// Known physical key codes (KeyboardEvent.code values), used to catch typos in
// hand-edited YAML. Generic modifiers match either side of that modifier.

import { isModifierCode, modifierOf, type Modifier } from '../input/keys';

export const GENERIC_MODIFIERS: readonly Modifier[] = ['Control', 'Shift', 'Alt', 'Meta'];

const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `Key${c}`);
const digits = '0123456789'.split('').map((d) => `Digit${d}`);
const numpad = [
  ...'0123456789'.split('').map((d) => `Numpad${d}`),
  'NumpadAdd',
  'NumpadSubtract',
  'NumpadMultiply',
  'NumpadDivide',
  'NumpadDecimal',
  'NumpadEnter',
  'NumpadEqual',
  'NumLock',
];
const functionKeys = Array.from({ length: 24 }, (_, i) => `F${i + 1}`);

export const KNOWN_CODES: ReadonlySet<string> = new Set([
  ...letters,
  ...digits,
  ...numpad,
  ...functionKeys,
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'Backquote',
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'Semicolon',
  'Quote',
  'Comma',
  'Period',
  'Slash',
  'IntlBackslash',
  'Space',
  'Tab',
  'Enter',
  'Backspace',
  'Escape',
  'CapsLock',
  'ContextMenu',
  'Insert',
  'Delete',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PrintScreen',
  'ScrollLock',
  'Pause',
]);

export function isGenericModifier(code: string): code is Modifier {
  return (GENERIC_MODIFIERS as readonly string[]).includes(code);
}

export function isKnownCode(code: string): boolean {
  return KNOWN_CODES.has(code) || isGenericModifier(code);
}

/** Logical modifier for a specific or generic modifier code. */
export function modifierOfAny(code: string): Modifier | undefined {
  return isGenericModifier(code) ? code : modifierOf(code);
}

export function isAnyModifier(code: string): boolean {
  return isGenericModifier(code) || isModifierCode(code);
}
