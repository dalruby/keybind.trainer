import { describe, expect, it } from 'vitest';
import { bindingsOverlap, parseProfile, serializeProfile, validateProfile } from '../src/model/profile';
import { bindingFingerprint } from '../src/model/fingerprint';
import { wowBarsTemplate } from '../src/model/templates';
import { formatIssue } from '../src/model/yamlDoc';

const minimal = `
schema: 1
id: azeron-wow
name: Azeron – WoW
defaultHand: left
bindings:
  - id: bar1-1
    keys:
      - { code: Digit1, finger: index }
  - id: bar2-1
    label: Bar 2 – slot 1
    keys:
      - { code: ControlLeft, finger: pinky }
      - { code: Digit1, finger: index }
`;

function issuesOf(text: string): string[] {
  const r = parseProfile(text);
  if (r.ok) return [];
  return r.issues.map(formatIssue);
}

describe('parseProfile', () => {
  it('parses a valid profile', () => {
    const r = parseProfile(minimal);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.bindings).toHaveLength(2);
    expect(r.value.bindings[1]).toEqual({
      id: 'bar2-1',
      label: 'Bar 2 – slot 1',
      keys: [
        { code: 'ControlLeft', finger: 'pinky' },
        { code: 'Digit1', finger: 'index' },
      ],
    });
  });

  it('defaults defaultHand to left and keeps per-key hand overrides', () => {
    const r = parseProfile(`id: split\nname: Split\nbindings:\n  - id: jump\n    keys: [{ code: Space, hand: right, finger: thumb }]\n`);
    expect(r.ok && r.value.defaultHand).toBe('left');
    expect(r.ok && r.value.bindings[0].keys[0].hand).toBe('right');
  });

  it('reports YAML syntax errors with a line number', () => {
    const issues = issuesOf('id: x\nname: [oops\nbindings: []\n');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toMatch(/^line \d+:/);
  });

  it('reports field errors with the line of the offending value', () => {
    const text = minimal.replace('finger: pinky', 'finger: pinkie');
    const issues = issuesOf(text);
    expect(issues).toEqual([expect.stringMatching(/^line 13: bindings\[1\]\.keys\[0\]\.finger: finger must be one of/)]);
  });

  it('rejects unknown key codes, bad hands and missing names', () => {
    const issues = issuesOf(
      `id: p\nbindings:\n  - id: a\n    keys: [{ code: Digti1, finger: index, hand: middle }]\n`,
    ).join('\n');
    expect(issues).toContain('name is required');
    expect(issues).toContain('unknown key code "Digti1"');
    expect(issues).toContain('hand must be one of');
  });

  it('rejects duplicate ids and duplicate codes', () => {
    const dupId = minimal.replace('id: bar2-1', 'id: bar1-1');
    expect(issuesOf(dupId).join('\n')).toContain('duplicate binding id "bar1-1"');
    const dupCode = minimal.replace('code: ControlLeft', 'code: Digit1');
    expect(issuesOf(dupCode).join('\n')).toContain('key Digit1 is listed twice');
  });

  it('rejects two trigger keys and mixed generic/specific modifiers', () => {
    const two = minimal.replace('code: ControlLeft, finger: pinky', 'code: Digit2, finger: pinky');
    expect(issuesOf(two).join('\n')).toContain('only one non-modifier key');
    const mixed = minimal.replace(
      '      - { code: ControlLeft, finger: pinky }',
      '      - { code: ControlLeft, finger: pinky }\n      - { code: Control, finger: ring }',
    );
    expect(issuesOf(mixed).join('\n')).toContain('Control overlaps with ControlLeft');
  });

  it('rejects bindings that accept the same input', () => {
    const text = minimal + `  - id: other\n    keys:\n      - { code: Digit1, finger: middle }\n`;
    expect(issuesOf(text).join('\n')).toContain('accepts the same input as bindings[0]');
  });
});

describe('bindingsOverlap', () => {
  const b = (...codes: string[]) => ({ id: 'x', keys: codes.map((code) => ({ code, finger: 'index' as const })) });
  it('treats generic modifiers as overlapping either side', () => {
    expect(bindingsOverlap(b('Control', 'Digit1'), b('ControlLeft', 'Digit1'))).toBe(true);
  });
  it('keeps left and right modifiers apart', () => {
    expect(bindingsOverlap(b('ControlLeft', 'Digit1'), b('ControlRight', 'Digit1'))).toBe(false);
  });
  it('differs by modifier count or trigger', () => {
    expect(bindingsOverlap(b('Digit1'), b('ShiftLeft', 'Digit1'))).toBe(false);
    expect(bindingsOverlap(b('Digit1'), b('Digit2'))).toBe(false);
  });
});

describe('serializeProfile', () => {
  it('round-trips the WoW template and writes one key per line', () => {
    const profile = wowBarsTemplate();
    const text = serializeProfile(profile);
    expect(text).toContain('- { code: ControlLeft, finger: pinky }');
    expect(text.startsWith('# keybind.trainer profile')).toBe(true);
    const r = parseProfile(text);
    expect(r.ok && r.value).toEqual(profile);
  });

  it('template has 40 valid, distinct bindings', () => {
    const profile = wowBarsTemplate();
    expect(profile.bindings).toHaveLength(40);
    expect(validateProfile(profile)).toEqual([]);
  });
});

describe('bindingFingerprint', () => {
  const profile = { defaultHand: 'left' as const };
  const base = { id: 'a', keys: [{ code: 'ControlLeft', finger: 'pinky' as const }, { code: 'Digit1', finger: 'index' as const }] };
  it('ignores label and key order', () => {
    const reordered = { id: 'a', label: 'x', keys: [...base.keys].reverse() };
    expect(bindingFingerprint(reordered, profile)).toBe(bindingFingerprint(base, profile));
  });
  it('changes when a finger or hand changes', () => {
    const fp = bindingFingerprint(base, profile);
    expect(bindingFingerprint({ ...base, keys: [base.keys[0], { code: 'Digit1', finger: 'middle' }] }, profile)).not.toBe(fp);
    expect(bindingFingerprint(base, { defaultHand: 'right' })).not.toBe(fp);
  });
});
