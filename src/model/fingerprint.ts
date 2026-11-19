import type { Binding, BindingSnapshot, Profile } from './types';
import { fingerIdOf } from './types';

/** Keys of a binding as sorted "hand.finger:Code" strings. */
export function bindingKeyStrings(binding: Binding, profile: Pick<Profile, 'defaultHand'>): string[] {
  return binding.keys.map((k) => `${fingerIdOf(k, profile)}:${k.code}`).sort();
}

/** 32-bit FNV-1a, as 8 hex characters. Not cryptographic; only detects changes. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Fingerprint of what a binding asks of the user: its keys, hands and fingers.
 * The label and the order keys are listed in do not affect it. Session results
 * whose fingerprint differs from the current binding belong to an earlier
 * version of that binding.
 */
export function bindingFingerprint(binding: Binding, profile: Pick<Profile, 'defaultHand'>): string {
  return fnv1a(bindingKeyStrings(binding, profile).join('+'));
}

export function bindingSnapshot(binding: Binding, profile: Pick<Profile, 'defaultHand'>): BindingSnapshot {
  return { fp: bindingFingerprint(binding, profile), keys: bindingKeyStrings(binding, profile) };
}
