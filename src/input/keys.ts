// Pure helpers for working with physical key codes (KeyboardEvent.code).
// No DOM access here so everything can be unit tested.

export type Modifier = 'Control' | 'Shift' | 'Alt' | 'Meta';

export const MODIFIERS: readonly Modifier[] = ['Control', 'Shift', 'Alt', 'Meta'];

const MODIFIER_BY_CODE: Record<string, Modifier> = {
  ControlLeft: 'Control',
  ControlRight: 'Control',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  AltLeft: 'Alt',
  AltRight: 'Alt',
  MetaLeft: 'Meta',
  MetaRight: 'Meta',
};

export function modifierOf(code: string): Modifier | undefined {
  return MODIFIER_BY_CODE[code];
}

export function isModifierCode(code: string): boolean {
  return code in MODIFIER_BY_CODE;
}

/** Which side a modifier code is on, or undefined for non-modifiers. */
export function sideOf(code: string): 'left' | 'right' | undefined {
  if (!isModifierCode(code)) return undefined;
  return code.endsWith('Left') ? 'left' : 'right';
}

/** Set of logical modifiers held, given the physical codes held. */
export function modifiersHeld(held: Iterable<string>): Set<Modifier> {
  const out = new Set<Modifier>();
  for (const code of held) {
    const m = modifierOf(code);
    if (m) out.add(m);
  }
  return out;
}

export interface ModifierFlags {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

const FLAG_FOR: Record<Modifier, keyof ModifierFlags> = {
  Control: 'ctrl',
  Shift: 'shift',
  Alt: 'alt',
  Meta: 'meta',
};

/**
 * Drop held modifier codes that the browser says are no longer down.
 * Keyups can be lost (e.g. focus moved away mid-press), and the event's own
 * modifier flags are the authoritative source for modifier state.
 */
export function reconcileHeld(held: ReadonlySet<string>, flags: ModifierFlags): Set<string> {
  const out = new Set<string>();
  for (const code of held) {
    const m = modifierOf(code);
    if (m && !flags[FLAG_FOR[m]]) continue;
    out.add(code);
  }
  return out;
}

const MODIFIER_SHORT: Record<Modifier, string> = {
  Control: 'Ctrl',
  Shift: 'Shift',
  Alt: 'Alt',
  Meta: 'Win',
};

/** Human label for a single code: Digit1 → "1", KeyQ → "Q", ControlLeft → "LCtrl". */
export function codeLabel(code: string): string {
  const m = modifierOf(code);
  if (m) return (sideOf(code) === 'left' ? 'L' : 'R') + MODIFIER_SHORT[m];
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Numpad\d$/.test(code)) return 'Num' + code.slice(6);
  const named: Record<string, string> = {
    Minus: '-',
    Equal: '=',
    Backquote: '`',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Space: 'Space',
    Escape: 'Esc',
  };
  return named[code] ?? code;
}

/** Label for a combination: modifiers first in a fixed order, then the rest. */
export function comboLabel(codes: Iterable<string>): string {
  const list = [...codes];
  const order = (c: string) => {
    const m = modifierOf(c);
    return m ? MODIFIERS.indexOf(m) : MODIFIERS.length;
  };
  list.sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  return list.map(codeLabel).join(' + ');
}

export type BarModifier = 'none' | 'Control' | 'Shift' | 'Alt';

/** Logical modifiers according to the event's own flags. */
export function modifiersFromFlags(flags: ModifierFlags): Set<Modifier> {
  const out = new Set<Modifier>();
  for (const m of MODIFIERS) if (flags[FLAG_FOR[m]]) out.add(m);
  return out;
}

/**
 * For the WoW-style coverage grid: if `code` is a digit and at most one of
 * Ctrl/Shift/Alt is down (and no Win key or other key), return its slot.
 *
 * Which modifiers are down comes from the event flags, which are reliable
 * even if the modifier's own keydown never reached the page. The held codes
 * are only used to tell which side (left/right) was used.
 */
export function digitSlot(
  code: string,
  held: Iterable<string>,
  flags: ModifierFlags,
): { digit: number; mod: BarModifier; side?: 'left' | 'right' } | null {
  const match = /^Digit(\d)$/.exec(code);
  if (!match) return null;
  const others = [...held].filter((c) => c !== code);
  if (others.some((c) => !isModifierCode(c))) return null;
  const mods = modifiersFromFlags(flags);
  if (mods.has('Meta') || mods.size > 1) return null;
  const digit = Number(match[1]);
  if (mods.size === 0) return { digit, mod: 'none' };
  const [mod] = [...mods] as Exclude<BarModifier, 'none'>[];
  // Side is known only if exactly one physical key of that modifier is held.
  const sides = new Set(others.filter((c) => modifierOf(c) === mod).map(sideOf));
  return { digit, mod, side: sides.size === 1 ? [...sides][0] : undefined };
}
