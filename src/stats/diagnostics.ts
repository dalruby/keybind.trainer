// Diagnostics over a profile's sessions (PLAN.md section 5). Pure functions.
//
// Only attempts whose binding still matches the profile (same fingerprint)
// count; results from an earlier version of a binding are counted separately
// so the UI can say how many were left out.

import { comboLabel, codeLabel } from '../input/keys';
import { modifierOfAny } from '../model/codes';
import { bindingFingerprint } from '../model/fingerprint';
import { FINGERS, HANDS, fingerIdOf, type Attempt, type Binding, type FingerId, type Profile, type Session, type SessionMode } from '../model/types';
import { quantile } from './basic';

export interface SessionFilter {
  /** Only the most recent N sessions (after the mode filter). */
  lastSessions?: number;
  mode?: SessionMode | 'all';
}

export interface Sample {
  attempt: Attempt;
  /** Index into SampleSet.sessions. */
  session: number;
}

export interface SampleSet {
  profile: Profile;
  /** Sessions used, oldest first. */
  sessions: Session[];
  samples: Sample[];
  /** Attempts left out because their binding has changed since. */
  earlierVersion: number;
  /** Attempts for bindings no longer in the profile. */
  removed: number;
}

export function collectSamples(profile: Profile, all: Session[], filter: SessionFilter = {}): SampleSet {
  const mode = filter.mode ?? 'all';
  let sessions = all
    .filter((s) => s.profile === profile.id && (mode === 'all' || s.mode === mode))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (filter.lastSessions) sessions = sessions.slice(-filter.lastSessions);

  const current = new Map(profile.bindings.map((b) => [b.id, bindingFingerprint(b, profile)]));
  const samples: Sample[] = [];
  let earlierVersion = 0;
  let removed = 0;
  sessions.forEach((s, i) => {
    for (const attempt of s.attempts.slice(s.warmup ?? 0)) {
      const fp = current.get(attempt.b);
      if (fp === undefined) removed++;
      else if (s.bindings[attempt.b]?.fp !== fp) earlierVersion++;
      else samples.push({ attempt, session: i });
    }
  });
  return { profile, sessions, samples, earlierVersion, removed };
}

export interface Stats {
  /** Attempts. */
  n: number;
  /** Attempts with a reaction time. */
  timed: number;
  median: number;
  p90: number;
  /** Share of attempts with at least one misclick. */
  missRate: number;
  misses: number;
}

export function statsOf(attempts: Attempt[]): Stats {
  const times = attempts.flatMap((a) => (a.rt !== undefined ? [a.rt] : [])).sort((a, b) => a - b);
  const withMiss = attempts.filter((a) => a.miss?.length).length;
  return {
    n: attempts.length,
    timed: times.length,
    median: quantile(times, 0.5),
    p90: quantile(times, 0.9),
    missRate: attempts.length ? withMiss / attempts.length : NaN,
    misses: attempts.reduce((n, a) => n + (a.miss?.length ?? 0), 0),
  };
}

export interface BindingStats extends Stats {
  id: string;
  binding: Binding;
  /** Wrong inputs for this binding, most frequent first. */
  confusions: { label: string; count: number }[];
  /** "Cost" used to rank weak spots: median ms + miss rate × 1000 ms. */
  cost: number;
}

/** Penalty per misclick-rate unit in the weak-spot cost, in ms. */
export const MISS_PENALTY_MS = 1000;
/** Bindings need this many timed attempts before they're ranked. */
export const MIN_TIMED = 3;

export function bindingStats(set: SampleSet): BindingStats[] {
  const byId = new Map<string, Attempt[]>();
  for (const s of set.samples) byId.set(s.attempt.b, [...(byId.get(s.attempt.b) ?? []), s.attempt]);
  return set.profile.bindings.map((binding) => {
    const attempts = byId.get(binding.id) ?? [];
    const stats = statsOf(attempts);
    const confusions = new Map<string, number>();
    for (const a of attempts) for (const m of a.miss ?? []) {
      const label = comboLabel(m.k);
      confusions.set(label, (confusions.get(label) ?? 0) + 1);
    }
    return {
      id: binding.id,
      binding,
      ...stats,
      confusions: [...confusions].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
      cost: stats.median + (Number.isNaN(stats.missRate) ? 0 : stats.missRate) * MISS_PENALTY_MS,
    };
  });
}

export type Role = 'trigger' | 'modifier';

export interface FingerBinding {
  stats: BindingStats;
  role: Role;
  code: string;
}

export interface FingerSummary {
  finger: FingerId;
  /** Over every attempt of every binding this finger takes part in. */
  stats: Stats;
  bindings: FingerBinding[];
}

/** Every finger used in the profile, in hand/finger order, with its bindings. */
export function fingerSummaries(set: SampleSet, perBinding = bindingStats(set)): FingerSummary[] {
  const byBinding = new Map(perBinding.map((b) => [b.id, b]));
  const attemptsById = new Map<string, Attempt[]>();
  for (const s of set.samples) attemptsById.set(s.attempt.b, [...(attemptsById.get(s.attempt.b) ?? []), s.attempt]);

  const map = new Map<FingerId, FingerBinding[]>();
  for (const b of set.profile.bindings) {
    for (const k of b.keys) {
      const f = fingerIdOf(k, set.profile);
      const role: Role = modifierOfAny(k.code) && b.keys.length > 1 ? 'modifier' : 'trigger';
      map.set(f, [...(map.get(f) ?? []), { stats: byBinding.get(b.id)!, role, code: k.code }]);
    }
  }
  const order = (f: FingerId) => {
    const [hand, finger] = f.split('.');
    return HANDS.indexOf(hand as never) * 10 + FINGERS.indexOf(finger as never);
  };
  return [...map]
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([finger, bindings]) => ({
      finger,
      stats: statsOf([...new Set(bindings.map((x) => x.stats.id))].flatMap((id) => attemptsById.get(id) ?? [])),
      bindings,
    }));
}

/** Bindings ranked for one finger: ranked ones fastest first, then those without enough data. */
export function rankBindings(list: FingerBinding[], by: 'median' | 'p90' | 'missRate'): FingerBinding[] {
  const value = (x: FingerBinding) => x.stats[by];
  const ranked = list.filter((x) => x.stats.timed >= MIN_TIMED && !Number.isNaN(value(x)));
  const rest = list.filter((x) => !ranked.includes(x));
  return [...ranked.sort((a, b) => value(a) - value(b)), ...rest];
}

export interface KeyGrid {
  /** Modifier combinations, "" for none, e.g. "LCtrl". */
  rows: string[];
  /** Trigger keys with the finger that presses them. */
  cols: { code: string; label: string; finger: FingerId }[];
  cells: { row: number; col: number; stats: BindingStats }[];
}

/** Trigger key × modifier grid, e.g. digits × (none, Ctrl, Shift, Alt). */
export function keyGrid(set: SampleSet, perBinding = bindingStats(set)): KeyGrid {
  const rows: string[] = [];
  const cols: KeyGrid['cols'] = [];
  const cells: KeyGrid['cells'] = [];
  for (const b of perBinding) {
    const keys = b.binding.keys;
    const trigger = keys.find((k) => !modifierOfAny(k.code)) ?? keys[0];
    const mods = keys.filter((k) => k !== trigger).map((k) => k.code);
    const row = mods.length ? comboLabel(mods) : '';
    let r = rows.indexOf(row);
    if (r < 0) r = rows.push(row) - 1;
    const finger = fingerIdOf(trigger, set.profile);
    let c = cols.findIndex((x) => x.code === trigger.code && x.finger === finger);
    if (c < 0) c = cols.push({ code: trigger.code, label: codeLabel(trigger.code), finger }) - 1;
    cells.push({ row: r, col: c, stats: b });
  }
  // Plain keys first, then Ctrl, Shift, Alt, Win (like action bars); keys in keyboard-ish order.
  const modRank = (row: string) => {
    if (row === '') return -1;
    const i = ['Ctrl', 'Shift', 'Alt', 'Win'].findIndex((m) => row.split(' + ')[0].endsWith(m));
    return (i < 0 ? 9 : i) * 10 + row.split(' + ').length;
  };
  const rowOrder = rows
    .map((_, i) => i)
    .sort((a, b) => modRank(rows[a]) - modRank(rows[b]) || rows[a].localeCompare(rows[b]));
  const keyRank = (code: string) => {
    const d = /^Digit(\d)$/.exec(code);
    if (d) return d[1] === '0' ? 10 : Number(d[1]);
    return 100 + code.charCodeAt(code.length - 1);
  };
  const colOrder = cols.map((_, i) => i).sort((a, b) => keyRank(cols[a].code) - keyRank(cols[b].code));
  return {
    rows: rowOrder.map((i) => rows[i]),
    cols: colOrder.map((i) => cols[i]),
    cells: cells.map((cell) => ({ ...cell, row: rowOrder.indexOf(cell.row), col: colOrder.indexOf(cell.col) })),
  };
}

/** Bindings with the highest cost (slow and/or error-prone), worst first. */
export function weakSpots(perBinding: BindingStats[], count = 8): BindingStats[] {
  return perBinding
    .filter((b) => b.timed >= MIN_TIMED)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, count);
}

export interface TrendPoint {
  session: number;
  startedAt: string;
  stats: Stats;
}

/** One point per session for the attempts selected by `include`. */
export function trend(set: SampleSet, include: (a: Attempt) => boolean = () => true): TrendPoint[] {
  return set.sessions
    .map((s, i) => ({
      session: i,
      startedAt: s.startedAt,
      stats: statsOf(set.samples.filter((x) => x.session === i && include(x.attempt)).map((x) => x.attempt)),
    }))
    .filter((p) => p.stats.n > 0);
}

/** Histogram of reaction times in fixed-width bins. */
export function histogram(times: number[], binMs = 50): { from: number; to: number; count: number }[] {
  if (!times.length) return [];
  const lo = Math.floor(Math.min(...times) / binMs) * binMs;
  const hi = Math.floor(Math.max(...times) / binMs) * binMs;
  const bins = [];
  for (let from = lo; from <= hi; from += binMs) bins.push({ from, to: from + binMs, count: 0 });
  for (const t of times) bins[Math.floor((t - lo) / binMs)].count++;
  return bins;
}

export function fingerLabel(f: FingerId): string {
  const [hand, finger] = f.split('.');
  return `${hand === 'left' ? 'Left' : 'Right'} ${finger}`;
}
