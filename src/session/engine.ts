// Runs one training session: which binding is prompted, timing, misses,
// pauses and the final Session record. No DOM or React; the UI drives it with
// timestamps from the performance.now() clock (the same clock as key events).

import { bindingSnapshot } from '../model/fingerprint';
import { SCHEMA_VERSION, type Attempt, type Binding, type Miss, type Profile, type PromptStyle, type Session, type SessionMode } from '../model/types';
import { matchKeyDown, type KeyDown } from './matcher';
import { Scheduler, type Rng } from './scheduler';

export interface SessionOptions {
  durationSec: number;
  mode?: SessionMode;
  prompt?: PromptStyle;
  gapMs?: number;
  warmup?: number;
  /** Limit to these binding ids (e.g. weak spots). Defaults to all. */
  bindingIds?: string[];
  weights?: Map<string, number>;
  rng?: Rng;
}

export type EngineState = 'ready' | 'waiting' | 'prompting' | 'paused' | 'done';

export type KeyOutcome =
  | { kind: 'ignore' }
  | { kind: 'miss'; miss: Miss }
  | { kind: 'correct'; rt: number; attempt: Attempt };

interface Current {
  binding: Binding;
  /** performance.now() time the prompt became visible; undefined until shown. */
  shownAt?: number;
  attempt: Attempt;
}

export class SessionEngine {
  readonly bindings: Binding[];
  readonly attempts: Attempt[] = [];
  readonly opts: Required<Omit<SessionOptions, 'bindingIds' | 'weights' | 'rng'>>;
  state: EngineState = 'ready';
  current: Current | null = null;
  bounces = 0;

  private scheduler: Scheduler;
  private startedAt: Date | null = null;
  private activeMs = 0;
  /** performance.now() when the current running stretch began. */
  private runningSince: number | null = null;

  constructor(
    readonly profile: Profile,
    options: SessionOptions,
  ) {
    const wanted = options.bindingIds ? new Set(options.bindingIds) : null;
    this.bindings = profile.bindings.filter((b) => !wanted || wanted.has(b.id));
    if (this.bindings.length === 0) throw new Error('No bindings to train');
    this.opts = {
      durationSec: options.durationSec,
      mode: options.mode ?? 'normal',
      prompt: options.prompt ?? 'keys',
      gapMs: options.gapMs ?? 250,
      warmup: options.warmup ?? 0,
    };
    this.scheduler = new Scheduler(
      this.bindings.map((b) => b.id),
      options.rng,
      options.weights,
    );
  }

  /** Begin timing. Call when the first prompt is about to be shown. */
  start(now: number, wallClock = new Date()): void {
    if (this.state !== 'ready') return;
    this.startedAt = wallClock;
    this.runningSince = now;
    this.state = 'waiting';
  }

  /** Active (unpaused) time in ms. */
  elapsedMs(now: number): number {
    return this.activeMs + (this.runningSince !== null ? now - this.runningSince : 0);
  }

  remainingMs(now: number): number {
    return Math.max(0, this.opts.durationSec * 1000 - this.elapsedMs(now));
  }

  isOver(now: number): boolean {
    return this.remainingMs(now) <= 0;
  }

  /** Choose the next binding. The UI renders it, then calls promptShown. */
  nextPrompt(): Binding {
    if (this.state !== 'waiting') throw new Error(`nextPrompt in state ${this.state}`);
    const id = this.scheduler.next();
    const binding = this.bindings.find((b) => b.id === id)!;
    this.current = { binding, attempt: { b: id, t: 0 } };
    this.state = 'prompting';
    return binding;
  }

  /** The prompt is on screen as of `now` (use the animation frame timestamp). */
  promptShown(now: number): void {
    if (!this.current || this.current.shownAt !== undefined) return;
    this.current.shownAt = now;
    this.current.attempt.t = this.elapsedMs(now) / 1000;
  }

  handleKeyDown(ev: KeyDown & { timeStamp: number }): KeyOutcome {
    const cur = this.current;
    if (this.state !== 'prompting' || !cur || cur.shownAt === undefined) return { kind: 'ignore' };
    // A press registered before the prompt was visible can't be a reaction to it.
    if (ev.timeStamp < cur.shownAt) return { kind: 'ignore' };
    const result = matchKeyDown(cur.binding, ev);
    if (result === 'ignore') return { kind: 'ignore' };
    const at = ev.timeStamp - cur.shownAt;
    if (result === 'miss') {
      const miss: Miss = { k: [...ev.held], at };
      (cur.attempt.miss ??= []).push(miss);
      return { kind: 'miss', miss };
    }
    cur.attempt.rt = at;
    this.attempts.push(cur.attempt);
    const attempt = cur.attempt;
    this.current = null;
    this.state = 'waiting';
    return { kind: 'correct', rt: at, attempt };
  }

  /** Pause timing. An unfinished prompt is dropped; its timing is no longer meaningful. */
  pause(now: number): void {
    if (this.state !== 'waiting' && this.state !== 'prompting') return;
    this.activeMs += now - (this.runningSince ?? now);
    this.runningSince = null;
    this.current = null;
    this.state = 'paused';
  }

  resume(now: number): void {
    if (this.state !== 'paused') return;
    this.runningSince = now;
    this.state = 'waiting';
  }

  /**
   * End the session. An unfinished prompt that already had misses is kept
   * (without a reaction time) so those misses count.
   */
  finish(now: number): Session {
    if (this.runningSince !== null) {
      this.activeMs += now - this.runningSince;
      this.runningSince = null;
    }
    const cur = this.current;
    if (cur && cur.shownAt !== undefined && cur.attempt.miss?.length) this.attempts.push(cur.attempt);
    this.current = null;
    this.state = 'done';
    return this.toSession();
  }

  toSession(): Session {
    const used = new Set(this.attempts.map((a) => a.b));
    const bindings: Session['bindings'] = {};
    for (const b of this.bindings) if (used.has(b.id)) bindings[b.id] = bindingSnapshot(b, this.profile);
    return {
      schema: SCHEMA_VERSION,
      profile: this.profile.id,
      mode: this.opts.mode,
      startedAt: (this.startedAt ?? new Date()).toISOString(),
      durationPlanned: this.opts.durationSec,
      durationActual: this.activeMs / 1000,
      prompt: this.opts.prompt,
      gapMs: this.opts.gapMs,
      warmup: this.opts.warmup,
      bounces: this.bounces,
      bindings,
      attempts: this.attempts,
    };
  }
}
