import { Document, isMap, isSeq } from 'yaml';
import { isAnyModifier, isKnownCode, modifierOfAny } from './codes';
import { FINGERS, HANDS, SCHEMA_VERSION, type Binding, type Finger, type Hand, type KeyAssignment, type Profile } from './types';
import { ID_PATTERN, TO_STRING, isRecord, parseYaml, type Checker, type Parsed } from './yamlDoc';

/** Parse and validate a profile YAML file. */
export function parseProfile(text: string): Parsed<Profile> {
  const parsed = parseYaml(text);
  if (!parsed.ok) return parsed;
  const { value, checker } = parsed;
  const profile = readProfile(value, checker);
  if (checker.issues.length || !profile) return { ok: false, issues: checker.issues };
  return { ok: true, value: profile };
}

/** Validate a profile object (e.g. one built by the editor) without YAML positions. */
export function validateProfile(profile: Profile): string[] {
  const parsed = parseProfile(serializeProfile(profile));
  return parsed.ok ? [] : parsed.issues.map((i) => i.message);
}

function readProfile(v: unknown, c: Checker): Profile | null {
  if (!isRecord(v)) {
    c.add([], 'a profile must be a mapping with id, name and bindings');
    return null;
  }
  const schema = v.schema ?? SCHEMA_VERSION;
  if (schema !== SCHEMA_VERSION) c.add(['schema'], `unsupported schema version ${String(schema)} (expected ${SCHEMA_VERSION})`);

  if (typeof v.id !== 'string' || !ID_PATTERN.test(v.id)) {
    c.add(['id'], 'id is required: letters, digits, ".", "_" or "-", starting with a letter or digit');
  }
  if (typeof v.name !== 'string' || !v.name.trim()) c.add(['name'], 'name is required');
  if (v.device !== undefined && typeof v.device !== 'string') c.add(['device'], 'device must be text');

  const defaultHand = (v.defaultHand ?? 'left') as Hand;
  if (!HANDS.includes(defaultHand)) c.add(['defaultHand'], `defaultHand must be one of: ${HANDS.join(', ')}`);

  const bindings: Binding[] = [];
  if (!Array.isArray(v.bindings)) {
    c.add(['bindings'], 'bindings must be a list');
  } else {
    const seenIds = new Map<string, number>();
    const accepted: { b: Binding; i: number }[] = [];
    v.bindings.forEach((raw, i) => {
      const b = readBinding(raw, ['bindings', i], c);
      if (!b) return;
      const prevId = seenIds.get(b.id);
      if (prevId !== undefined) c.add(['bindings', i, 'id'], `duplicate binding id "${b.id}" (also bindings[${prevId}])`);
      else seenIds.set(b.id, i);

      const clash = accepted.find((other) => bindingsOverlap(other.b, b));
      if (clash) c.add(['bindings', i, 'keys'], `accepts the same input as bindings[${clash.i}], so the two can't be told apart`);
      else accepted.push({ b, i });
      bindings.push(b);
    });
  }

  if (c.issues.length) return null;
  const profile: Profile = {
    schema: SCHEMA_VERSION,
    id: v.id as string,
    name: (v.name as string).trim(),
    defaultHand,
    bindings,
  };
  if (typeof v.device === 'string' && v.device.trim()) profile.device = v.device.trim();
  return profile;
}

function readBinding(raw: unknown, path: (string | number)[], c: Checker): Binding | null {
  if (!isRecord(raw)) {
    c.add(path, 'a binding must be a mapping with id and keys');
    return null;
  }
  const before = c.issues.length;
  if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) {
    c.add([...path, 'id'], 'binding id is required: letters, digits, ".", "_" or "-"');
  }
  if (raw.label !== undefined && typeof raw.label !== 'string') c.add([...path, 'label'], 'label must be text');

  const keys: KeyAssignment[] = [];
  if (!Array.isArray(raw.keys) || raw.keys.length === 0) {
    c.add([...path, 'keys'], 'keys must be a list with at least one key');
  } else {
    raw.keys.forEach((k, j) => {
      const key = readKey(k, [...path, 'keys', j], c);
      if (key) keys.push(key);
    });
    checkKeyCombination(keys, [...path, 'keys'], c);
  }
  if (c.issues.length > before) return null;
  const binding: Binding = { id: raw.id as string, keys };
  if (typeof raw.label === 'string' && raw.label.trim()) binding.label = raw.label.trim();
  return binding;
}

function readKey(raw: unknown, path: (string | number)[], c: Checker): KeyAssignment | null {
  if (!isRecord(raw)) {
    c.add(path, 'a key must be a mapping like { code: Digit1, finger: index }');
    return null;
  }
  const before = c.issues.length;
  if (typeof raw.code !== 'string' || !raw.code) c.add([...path, 'code'], 'code is required, e.g. Digit1 or ControlLeft');
  else if (!isKnownCode(raw.code)) c.add([...path, 'code'], `unknown key code "${raw.code}"`);
  if (!FINGERS.includes(raw.finger as Finger)) c.add([...path, 'finger'], `finger must be one of: ${FINGERS.join(', ')}`);
  if (raw.hand !== undefined && !HANDS.includes(raw.hand as Hand)) {
    c.add([...path, 'hand'], `hand must be one of: ${HANDS.join(', ')}`);
  }
  if (c.issues.length > before) return null;
  const key: KeyAssignment = { code: raw.code as string, finger: raw.finger as Finger };
  if (raw.hand !== undefined) key.hand = raw.hand as Hand;
  return key;
}

function checkKeyCombination(keys: KeyAssignment[], path: (string | number)[], c: Checker): void {
  const codes = keys.map((k) => k.code);
  const dupes = codes.filter((code, i) => codes.indexOf(code) !== i);
  if (dupes.length) c.add(path, `key ${dupes[0]} is listed twice`);

  // "Control" and "ControlLeft" in one binding overlap.
  const byModifier = new Map<string, string[]>();
  for (const code of codes) {
    const m = modifierOfAny(code);
    if (!m) continue;
    byModifier.set(m, [...(byModifier.get(m) ?? []), code]);
  }
  for (const [m, list] of byModifier) {
    if (list.length > 1 && list.includes(m)) c.add(path, `${m} overlaps with ${list.filter((x) => x !== m).join(', ')}`);
  }

  const triggers = codes.filter((code) => !isAnyModifier(code));
  if (triggers.length > 1) c.add(path, `only one non-modifier key per binding (found ${triggers.join(', ')})`);
  if (triggers.length === 0 && codes.length > 1) {
    c.add(path, 'a binding of only modifiers must be a single key');
  }
}

/**
 * True if some key press would satisfy both bindings. Fingers don't matter;
 * a generic modifier ("Control") overlaps with either side ("ControlLeft").
 */
export function bindingsOverlap(a: Binding, b: Binding): boolean {
  const split = (x: Binding) => {
    const mods = new Map<string, string>();
    const rest: string[] = [];
    for (const { code } of x.keys) {
      const m = modifierOfAny(code);
      if (m) mods.set(m, code);
      else rest.push(code);
    }
    return { mods, rest: rest.sort().join('+') };
  };
  const sa = split(a);
  const sb = split(b);
  if (sa.rest !== sb.rest || sa.mods.size !== sb.mods.size) return false;
  for (const [m, codeA] of sa.mods) {
    const codeB = sb.mods.get(m);
    if (codeB === undefined) return false;
    if (codeA !== codeB && codeA !== m && codeB !== m) return false; // ControlLeft vs ControlRight
  }
  return true;
}

/** Serialize a profile to YAML, in a stable field order with one key per line. */
export function serializeProfile(profile: Profile): string {
  const obj: Record<string, unknown> = {
    schema: profile.schema,
    id: profile.id,
    name: profile.name,
  };
  if (profile.device) obj.device = profile.device;
  obj.defaultHand = profile.defaultHand;
  obj.bindings = profile.bindings.map((b) => {
    const out: Record<string, unknown> = { id: b.id };
    if (b.label) out.label = b.label;
    out.keys = b.keys.map((k) => {
      const key: Record<string, unknown> = { code: k.code };
      if (k.hand) key.hand = k.hand;
      key.finger = k.finger;
      return key;
    });
    return out;
  });

  const doc = new Document(obj);
  doc.commentBefore =
    ' keybind.trainer profile. Safe to edit by hand.\n' +
    ' Fingers: thumb, index, middle, ring, pinky. Hands: left, right (defaults to defaultHand).';
  // Each key on one line: { code: Digit1, finger: index }
  const bindingsNode = doc.get('bindings', true);
  if (isSeq(bindingsNode)) {
    for (const b of bindingsNode.items) {
      const keys = isMap(b) ? b.get('keys', true) : undefined;
      if (isSeq(keys)) for (const key of keys.items) if (isMap(key)) key.flow = true;
    }
  }
  return doc.toString(TO_STRING);
}
