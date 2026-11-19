// Decides whether a keydown satisfies the prompted binding (PLAN.md section 4).

import type { ModifierFlags } from '../input/keys';
import { isModifierCode, modifierOf, type Modifier } from '../input/keys';
import { isGenericModifier, modifierOfAny } from '../model/codes';
import type { Binding } from '../model/types';

export interface KeyDown {
  code: string;
  repeat: boolean;
  /** Physical codes held after this keydown (includes `code`). */
  held: string[];
  flags: ModifierFlags;
}

export type MatchResult = 'correct' | 'miss' | 'ignore';

const FLAG: Record<Modifier, keyof ModifierFlags> = { Control: 'ctrl', Shift: 'shift', Alt: 'alt', Meta: 'meta' };
const ALL: Modifier[] = ['Control', 'Shift', 'Alt', 'Meta'];

/** Logical modifiers down: from held codes, plus flags (AltGr hides ctrl/alt flags). */
function modifiersDown(ev: KeyDown): Set<Modifier> {
  const out = new Set<Modifier>();
  for (const c of ev.held) {
    const m = modifierOf(c);
    if (m) out.add(m);
  }
  for (const m of ALL) if (ev.flags[FLAG[m]]) out.add(m);
  return out;
}

export function matchKeyDown(binding: Binding, ev: KeyDown): MatchResult {
  if (ev.repeat || !ev.code) return 'ignore';
  const codes = binding.keys.map((k) => k.code);
  const trigger = codes.find((c) => modifierOfAny(c) === undefined);
  const required = codes.filter((c) => modifierOfAny(c) !== undefined);

  if (!trigger) {
    // A binding that is a single modifier: correct when exactly that key goes down alone.
    const want = required[0];
    if (!isModifierCode(ev.code)) return 'miss';
    const fits = isGenericModifier(want) ? modifierOf(ev.code) === want : ev.code === want;
    if (!fits) return 'ignore'; // getting ready for something else; not judged
    const others = ev.held.filter((c) => c !== ev.code);
    return others.length === 0 && !ev.flags.altGraph ? 'correct' : 'miss';
  }

  // Modifiers on their own are never judged; only the trigger-type key is.
  if (isModifierCode(ev.code)) return 'ignore';
  if (ev.code !== trigger) return 'miss';
  if (ev.held.some((c) => c !== ev.code && !isModifierCode(c))) return 'miss';
  if (ev.flags.altGraph && !(required.includes('ControlLeft') && required.includes('AltRight'))) return 'miss';

  const down = modifiersDown(ev);
  const wanted = new Set(required.map((c) => modifierOfAny(c)!));
  if (down.size !== wanted.size || [...wanted].some((m) => !down.has(m))) return 'miss';
  // Specific sides must be the held key.
  for (const c of required) {
    if (!isGenericModifier(c) && !ev.held.includes(c)) return 'miss';
  }
  return 'correct';
}
