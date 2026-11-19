import { SCHEMA_VERSION, type Binding, type Finger, type Profile } from './types';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/**
 * Placeholder finger per digit. The real assignment depends on how the keys
 * are laid out on the device; the profile editor (milestone 3) changes it.
 */
const DIGIT_FINGER: Record<string, Finger> = {
  '1': 'ring',
  '2': 'ring',
  '3': 'middle',
  '4': 'middle',
  '5': 'index',
  '6': 'index',
  '7': 'index',
  '8': 'index',
  '9': 'index',
  '0': 'index',
};

const BARS: { bar: number; modifier?: string }[] = [
  { bar: 1 },
  { bar: 2, modifier: 'ControlLeft' },
  { bar: 3, modifier: 'ShiftLeft' },
  { bar: 4, modifier: 'AltLeft' },
];

/** WoW action bars 1–4: digits 0–9 plain, then with Ctrl, Shift and Alt on the pinky. */
export function wowBarsTemplate(id = 'wow-bars', name = 'WoW action bars 1–4'): Profile {
  const bindings: Binding[] = [];
  for (const { bar, modifier } of BARS) {
    for (const d of DIGITS) {
      const keys: Binding['keys'] = [];
      if (modifier) keys.push({ code: modifier, finger: 'pinky' });
      keys.push({ code: `Digit${d}`, finger: DIGIT_FINGER[d] });
      bindings.push({ id: `bar${bar}-${d}`, label: `Bar ${bar} – slot ${d === '0' ? 10 : d}`, keys });
    }
  }
  return { schema: SCHEMA_VERSION, id, name, defaultHand: 'left', bindings };
}
