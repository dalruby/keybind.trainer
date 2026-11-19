import { describe, expect, it } from 'vitest';
import {
  assignKeyEverywhere,
  bindingIdFor,
  changeDefaultHand,
  keyUsage,
  slugify,
  suggestFinger,
  uniqueId,
  updateProfileText,
} from '../src/model/profileEdit';
import { parseProfile } from '../src/model/profile';
import { wowBarsTemplate } from '../src/model/templates';
import type { Profile } from '../src/model/types';

const original = `# My Azeron setup, tuned 2026-11
schema: 1
id: azeron
name: Azeron # main profile
defaultHand: left
bindings:
  - id: bar1-1
    keys:
      - { code: Digit1, finger: index } # top row
  # modifier bar
  - id: bar2-1
    label: Bar 2 slot 1
    keys:
      - { code: ControlLeft, finger: pinky }
      - { code: Digit1, finger: index }
`;

function parse(text: string): Profile {
  const r = parseProfile(text);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

describe('updateProfileText', () => {
  it('returns the text unchanged when nothing changed', () => {
    expect(updateProfileText(original, parse(original))).toBe(original);
  });

  it('keeps comments while changing fields, fingers and adding bindings', () => {
    const p = parse(original);
    const edited: Profile = {
      ...p,
      name: 'Azeron v2',
      device: 'Azeron Cyborg 2',
      bindings: [
        { ...p.bindings[0], keys: [{ code: 'Digit1', finger: 'middle' }] },
        p.bindings[1],
        { id: 'bar1-2', keys: [{ code: 'Digit2', finger: 'ring' }] },
      ],
    };
    const text = updateProfileText(original, edited);
    expect(text).toContain('# My Azeron setup, tuned 2026-11');
    expect(text).toContain('name: Azeron v2 # main profile');
    expect(text).toContain('- { code: Digit1, finger: middle } # top row');
    expect(text).toContain('# modifier bar');
    expect(text).toContain('- { code: Digit2, finger: ring }');
    // device is inserted near the top, not appended after bindings
    expect(text.indexOf('device:')).toBeLessThan(text.indexOf('bindings:'));
    expect(parse(text)).toEqual(edited);
  });

  it('removes deleted bindings and fields', () => {
    const p = parse(original);
    const edited: Profile = { ...p, bindings: [{ ...p.bindings[1], label: undefined }] };
    const text = updateProfileText(original, edited);
    expect(text).not.toContain('bar1-1');
    expect(text).not.toContain('label:');
    expect(parse(text)).toEqual({ ...edited, bindings: [{ id: 'bar2-1', keys: p.bindings[1].keys }] });
  });

  it('writes a fresh file when there is no valid current text', () => {
    const p = wowBarsTemplate();
    expect(parse(updateProfileText(null, p))).toEqual(p);
    expect(parse(updateProfileText('not: [valid', p))).toEqual(p);
  });
});

describe('ids', () => {
  it('slugifies names', () => {
    expect(slugify('Azeron – WoW (main)')).toBe('azeron-wow-main');
    expect(slugify('Ünïcödé')).toBe('unicode');
    expect(slugify('!!!')).toBe('item');
  });
  it('finds a free id', () => {
    expect(uniqueId('a', [])).toBe('a');
    expect(uniqueId('a', ['a', 'a-2'])).toBe('a-3');
  });
  it('builds binding ids from keys', () => {
    expect(bindingIdFor(['Digit1', 'ControlLeft'], [])).toBe('lctrl-1');
    expect(bindingIdFor(['Digit1'], ['1'])).toBe('1-2');
  });
});

describe('fingers', () => {
  const p = parse(original);
  it('suggests the finger already used for a key, else a default', () => {
    expect(suggestFinger('Digit1', p)).toEqual({ finger: 'index' });
    expect(suggestFinger('ShiftLeft', p)).toEqual({ finger: 'pinky' });
    expect(suggestFinger('KeyQ', p)).toEqual({ finger: 'index' });
  });

  it('summarises key usage and detects mixed fingers', () => {
    expect(keyUsage(p)).toEqual([
      { code: 'Digit1', bindings: 2, finger: 'index', hand: 'left', mixed: false },
      { code: 'ControlLeft', bindings: 1, finger: 'pinky', hand: 'left', mixed: false },
    ]);
    const mixed = { ...p, bindings: [{ ...p.bindings[0], keys: [{ code: 'Digit1', finger: 'ring' as const }] }, p.bindings[1]] };
    expect(keyUsage(mixed)[0]).toMatchObject({ code: 'Digit1', mixed: true, finger: undefined });
  });

  it('assigns a finger to a key in every binding', () => {
    const next = assignKeyEverywhere(p, 'Digit1', 'middle', 'right');
    expect(next.bindings.map((b) => b.keys.find((k) => k.code === 'Digit1'))).toEqual([
      { code: 'Digit1', finger: 'middle', hand: 'right' },
      { code: 'Digit1', finger: 'middle', hand: 'right' },
    ]);
  });

  it('changing the default hand keeps every key on its actual hand', () => {
    const withRight = assignKeyEverywhere(p, 'ControlLeft', 'pinky', 'right');
    const next = changeDefaultHand(withRight, 'right');
    expect(next.bindings[1].keys).toEqual([
      { code: 'ControlLeft', finger: 'pinky' },
      { code: 'Digit1', finger: 'index', hand: 'left' },
    ]);
  });
});
