// Helpers for editing profiles: saving without losing hand-written comments,
// generating ids, and picking sensible default fingers.

import { Document, Pair, Scalar, YAMLMap, YAMLSeq, isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { comboLabel, isModifierCode } from '../input/keys';
import { isGenericModifier } from './codes';
import { parseProfile, serializeProfile } from './profile';
import type { Binding, Finger, Hand, KeyAssignment, Profile } from './types';
import { TO_STRING } from './yamlDoc';

/**
 * Produce the new YAML text for `profile`, starting from the file's current
 * text so comments and formatting of unchanged parts survive. Falls back to a
 * fresh serialization if the current text isn't a valid profile.
 */
export function updateProfileText(currentText: string | null, profile: Profile): string {
  if (!currentText || !parseProfile(currentText).ok) return serializeProfile(profile);
  const doc = parseDocument(currentText);
  const root: unknown = doc.contents;
  if (!isMap(root)) return serializeProfile(profile);

  setField(doc, root, 'schema', profile.schema, 0);
  setField(doc, root, 'id', profile.id, 1);
  setField(doc, root, 'name', profile.name, 2);
  setField(doc, root, 'device', profile.device, 3);
  setField(doc, root, 'defaultHand', profile.defaultHand, 4);

  const bindingSeq = ensureSeq(root, 'bindings');
  const existing = new Map<string, YAMLMap>();
  for (const item of bindingSeq.items) {
    if (isMap(item)) existing.set(String(item.get('id')), item);
  }
  bindingSeq.items = profile.bindings.map((b) => {
    const node = existing.get(b.id);
    return node ? updateBindingNode(doc, node, b) : newBindingNode(doc, b);
  });

  return doc.toString(TO_STRING);
}

function ensureSeq(map: YAMLMap, key: string): YAMLSeq {
  const v: unknown = map.get(key, true);
  if (isSeq(v)) return v;
  const seq = new YAMLSeq();
  map.set(key, seq);
  return seq;
}

/** Set a top-level or nested field, keeping its node (and comments) if unchanged. */
function setField(doc: Document, map: YAMLMap, key: string, value: unknown, position: number): void {
  const current: unknown = map.get(key, true);
  if (value === undefined || value === '') {
    if (map.has(key)) map.delete(key);
    return;
  }
  if (isScalar(current)) {
    if (current.value !== value) current.value = value;
    return;
  }
  if (map.has(key)) {
    map.set(key, value);
    return;
  }
  // Insert new fields at a sensible position instead of at the end.
  const pair = new Pair(new Scalar(key), doc.createNode(value));
  map.items.splice(Math.min(position, map.items.length), 0, pair);
}

function updateBindingNode(doc: Document, node: YAMLMap, b: Binding): YAMLMap {
  setField(doc, node, 'id', b.id, 0);
  setField(doc, node, 'label', b.label, 1);
  const keySeq = ensureSeq(node, 'keys');
  keySeq.items = b.keys.map((k, i) => {
    const old = keySeq.items[i];
    if (isMap(old) && old.get('code') === k.code) {
      setField(doc, old, 'hand', k.hand, 1);
      setField(doc, old, 'finger', k.finger, 2);
      return old;
    }
    return keyNode(doc, k);
  });
  return node;
}

function newBindingNode(doc: Document, b: Binding): YAMLMap {
  const obj: Record<string, unknown> = { id: b.id };
  if (b.label) obj.label = b.label;
  obj.keys = [];
  const node = doc.createNode(obj) as YAMLMap;
  ensureSeq(node, 'keys').items = b.keys.map((k) => keyNode(doc, k));
  return node;
}

function keyNode(doc: Document, k: KeyAssignment): YAMLMap {
  const obj: Record<string, unknown> = { code: k.code };
  if (k.hand) obj.hand = k.hand;
  obj.finger = k.finger;
  const node = doc.createNode(obj) as YAMLMap;
  node.flow = true;
  return node;
}

// --- ids -----------------------------------------------------------------------

export function slugify(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  );
}

/** `base`, or `base-2`, `base-3`, … whichever is not taken. */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let n = 2; ; n++) if (!set.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Id for a new binding based on its keys, e.g. "lctrl-1". */
export function bindingIdFor(codes: string[], taken: Iterable<string>): string {
  return uniqueId(slugify(comboLabel(codes)), taken);
}

// --- default fingers -------------------------------------------------------------

/**
 * Finger and hand to suggest for a key: whatever the profile already uses for
 * that key, otherwise pinky for modifiers and index for anything else.
 */
export function suggestFinger(code: string, profile: Profile): { finger: Finger; hand?: Hand } {
  for (const b of profile.bindings) {
    const k = b.keys.find((x) => x.code === code);
    if (k) return k.hand ? { finger: k.finger, hand: k.hand } : { finger: k.finger };
  }
  return { finger: isModifierCode(code) || isGenericModifier(code) ? 'pinky' : 'index' };
}

/** Distinct key codes in a profile, with how each is assigned across bindings. */
export interface KeyUsage {
  code: string;
  bindings: number;
  /** Set when every binding uses the same hand + finger for this key. */
  finger?: Finger;
  hand?: Hand;
  mixed: boolean;
}

export function keyUsage(profile: Profile): KeyUsage[] {
  const map = new Map<string, { bindings: number; ids: Set<string>; first: KeyAssignment }>();
  for (const b of profile.bindings) {
    for (const k of b.keys) {
      const id = `${k.hand ?? profile.defaultHand}.${k.finger}`;
      const entry = map.get(k.code);
      if (entry) {
        entry.bindings++;
        entry.ids.add(id);
      } else map.set(k.code, { bindings: 1, ids: new Set([id]), first: k });
    }
  }
  return [...map].map(([code, e]) => ({
    code,
    bindings: e.bindings,
    mixed: e.ids.size > 1,
    finger: e.ids.size > 1 ? undefined : e.first.finger,
    hand: e.ids.size > 1 ? undefined : (e.first.hand ?? profile.defaultHand),
  }));
}

/** Assign one hand + finger to a key in every binding that uses it. */
export function assignKeyEverywhere(profile: Profile, code: string, finger: Finger, hand: Hand): Profile {
  return {
    ...profile,
    bindings: profile.bindings.map((b) => ({
      ...b,
      keys: b.keys.map((k) => {
        if (k.code !== code) return k;
        const next: KeyAssignment = { code: k.code, finger };
        if (hand !== profile.defaultHand) next.hand = hand;
        return next;
      }),
    })),
  };
}

/** Change the default hand without changing which hand any key actually uses. */
export function changeDefaultHand(profile: Profile, defaultHand: Hand): Profile {
  return {
    ...profile,
    defaultHand,
    bindings: profile.bindings.map((b) => ({
      ...b,
      keys: b.keys.map((k) => {
        const hand = k.hand ?? profile.defaultHand;
        const next: KeyAssignment = { code: k.code, finger: k.finger };
        if (hand !== defaultHand) next.hand = hand;
        return next;
      }),
    })),
  };
}
