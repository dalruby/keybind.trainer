// Data model shared by storage, sessions and statistics.
// Mirrors the YAML formats described in PLAN.md section 3.

export const SCHEMA_VERSION = 1;

export const HANDS = ['left', 'right'] as const;
export type Hand = (typeof HANDS)[number];

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
export type Finger = (typeof FINGERS)[number];

/** A finger on a specific hand, written as "left.index". */
export type FingerId = `${Hand}.${Finger}`;

export interface KeyAssignment {
  /**
   * Physical key (KeyboardEvent.code), e.g. "Digit1" or "ControlLeft".
   * May also be a generic modifier ("Control", "Shift", "Alt", "Meta"),
   * which matches either side.
   */
  code: string;
  finger: Finger;
  /** Omitted means the profile's defaultHand. */
  hand?: Hand;
}

export interface Binding {
  id: string;
  label?: string;
  keys: KeyAssignment[];
}

export interface Profile {
  schema: number;
  id: string;
  name: string;
  device?: string;
  defaultHand: Hand;
  bindings: Binding[];
}

export type SessionMode = 'normal' | 'weak-spot';

/** What the prompt shows: the keys to press, the binding's label, or both. */
export type PromptStyle = 'keys' | 'label' | 'both';
export const PROMPT_STYLES: PromptStyle[] = ['keys', 'label', 'both'];

/** Snapshot of a binding as it was trained, stored in the session file. */
export interface BindingSnapshot {
  /** Fingerprint of keys + hands + fingers; see fingerprint.ts. */
  fp: string;
  /** Keys as "hand.finger:Code", e.g. "left.pinky:ControlLeft". */
  keys: string[];
}

export interface Miss {
  /** All physical keys held when the wrong input happened. */
  k: string[];
  /** ms after the prompt appeared. */
  at: number;
}

export interface Attempt {
  /** Binding id. */
  b: string;
  /** Seconds since session start when the prompt appeared. */
  t: number;
  /** ms from prompt to the correct input. Missing if the session ended first. */
  rt?: number;
  miss?: Miss[];
}

export interface Session {
  schema: number;
  profile: string;
  mode: SessionMode;
  /** ISO timestamp. */
  startedAt: string;
  /** Seconds. */
  durationPlanned: number;
  /** Seconds, excluding pauses. */
  durationActual: number;
  /** What the prompt showed. */
  prompt?: PromptStyle;
  /** Pause between a correct input and the next prompt, in ms. */
  gapMs?: number;
  /** Number of leading attempts to leave out of statistics. */
  warmup?: number;
  /** Key bounces dropped by the debouncer during the session. */
  bounces?: number;
  bindings: Record<string, BindingSnapshot>;
  attempts: Attempt[];
}

export function handOf(key: KeyAssignment, profile: Pick<Profile, 'defaultHand'>): Hand {
  return key.hand ?? profile.defaultHand;
}

export function fingerIdOf(key: KeyAssignment, profile: Pick<Profile, 'defaultHand'>): FingerId {
  return `${handOf(key, profile)}.${key.finger}`;
}
