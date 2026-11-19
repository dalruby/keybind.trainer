// The one place that touches DOM keyboard events. Everything else in the app
// consumes CapturedKeyEvent, so this module can be swapped (e.g. for a Tauri
// native hook) without changing the rest.

import { Debouncer } from './debounce';
import { reconcileHeld, type ModifierFlags } from './keys';

export interface CapturedKeyEvent {
  type: 'down' | 'up';
  code: string;
  key: string;
  repeat: boolean;
  /** High-resolution timestamp (same clock as performance.now()). */
  timeStamp: number;
  flags: ModifierFlags;
  /** Physical codes held after this event was applied. */
  held: string[];
  /** Whether the browser's default action was suppressed. */
  suppressed: boolean;
}

export type CaptureListener = (ev: CapturedKeyEvent) => void;
export type ResetListener = (reason: 'blur' | 'hidden') => void;
export type BounceListener = (code: string, type: 'down' | 'up', timeStamp: number) => void;

/** Keys we never suppress, so the developer tools and reload keep working. */
const PASSTHROUGH = new Set(['F5', 'F11', 'F12']);

export class KeyboardCapture {
  private held = new Set<string>();
  private listeners = new Set<CaptureListener>();
  private resetListeners = new Set<ResetListener>();
  private bounceListeners = new Set<BounceListener>();
  private debouncer = new Debouncer();
  private running = false;

  /** Fires for each keydown/keyup dropped as switch bounce. */
  onBounce(fn: BounceListener): () => void {
    this.bounceListeners.add(fn);
    return () => this.bounceListeners.delete(fn);
  }

  onKey(fn: CaptureListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Fires when the page loses focus or becomes hidden; held keys are cleared. */
  onReset(fn: ResetListener): () => void {
    this.resetListeners.add(fn);
    return () => this.resetListeners.delete(fn);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // Capture phase on window so nothing in the page can swallow events first.
    window.addEventListener('keydown', this.handleKey, { capture: true });
    window.addEventListener('keyup', this.handleKey, { capture: true });
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('visibilitychange', this.handleVisibility);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    window.removeEventListener('keydown', this.handleKey, { capture: true });
    window.removeEventListener('keyup', this.handleKey, { capture: true });
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.held.clear();
    this.debouncer.reset();
  }

  private handleKey = (e: KeyboardEvent): void => {
    const suppressed = !PASSTHROUGH.has(e.code);
    if (suppressed) {
      e.preventDefault();
      e.stopPropagation();
    }
    const flags: ModifierFlags = {
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey,
      meta: e.metaKey,
      altGraph: e.getModifierState('AltGraph'),
    };
    const type = e.type === 'keydown' ? 'down' : 'up';
    if (this.debouncer.filter(type, e.code, e.repeat, e.timeStamp)) {
      for (const fn of this.bounceListeners) fn(e.code, type, e.timeStamp);
      return;
    }
    if (type === 'down') this.held.add(e.code);
    else this.held.delete(e.code);
    // On keyup of a modifier its own flag is already false; on keydown it is true.
    this.held = reconcileHeld(this.held, flags);
    if (type === 'down') this.held.add(e.code);

    const ev: CapturedKeyEvent = {
      type,
      code: e.code,
      key: e.key,
      repeat: e.repeat,
      timeStamp: e.timeStamp,
      flags,
      held: [...this.held],
      suppressed,
    };
    for (const fn of this.listeners) fn(ev);
  };

  private handleBlur = (): void => {
    this.held.clear();
    this.debouncer.reset();
    for (const fn of this.resetListeners) fn('blur');
  };

  private handleVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      this.held.clear();
      this.debouncer.reset();
      for (const fn of this.resetListeners) fn('hidden');
    }
  };
}

// --- Fullscreen + Keyboard Lock (Chromium only) -------------------------------

interface KeyboardLockApi {
  lock(keyCodes?: string[]): Promise<void>;
  unlock(): void;
}

function keyboardApi(): KeyboardLockApi | undefined {
  return (navigator as Navigator & { keyboard?: KeyboardLockApi }).keyboard;
}

export function keyboardLockSupported(): boolean {
  return typeof keyboardApi()?.lock === 'function';
}

/** Enter fullscreen and lock the keyboard so browser/system shortcuts reach the page. */
export async function enterLockedFullscreen(el: HTMLElement = document.documentElement): Promise<boolean> {
  if (!document.fullscreenElement) await el.requestFullscreen();
  const kb = keyboardApi();
  if (!kb) return false;
  await kb.lock();
  return true;
}

export async function exitLockedFullscreen(): Promise<void> {
  keyboardApi()?.unlock();
  if (document.fullscreenElement) await document.exitFullscreen();
}
