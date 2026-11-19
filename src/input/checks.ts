// Pure state machines for the browser-behaviour checks on the input test page.
//
// Each check is "armed" by a key action that might make the browser steal
// focus (Ctrl+digit switching tabs, a lone Alt tap focusing the browser menu).
// If the page loses focus within the window, that attempt fails; if it keeps
// focus for the whole window, it passes.

export type CheckStatus = 'untested' | 'waiting' | 'pass' | 'fail';

export interface FocusCheck {
  status: CheckStatus;
  armedAt?: number;
  passes: number;
  failures: number;
}

export const DEFAULT_WINDOW_MS = 1000;

export function newCheck(): FocusCheck {
  return { status: 'untested', passes: 0, failures: 0 };
}

export function arm(check: FocusCheck, t: number): FocusCheck {
  return { ...check, status: 'waiting', armedAt: t };
}

export function focusLost(check: FocusCheck, t: number, windowMs = DEFAULT_WINDOW_MS): FocusCheck {
  if (check.status !== 'waiting' || check.armedAt === undefined) return check;
  if (t - check.armedAt > windowMs) return settle(check, t, windowMs);
  return { status: 'fail', passes: check.passes, failures: check.failures + 1 };
}

/** Call periodically; passes a waiting check once its window has elapsed. */
export function settle(check: FocusCheck, t: number, windowMs = DEFAULT_WINDOW_MS): FocusCheck {
  if (check.status !== 'waiting' || check.armedAt === undefined) return check;
  if (t - check.armedAt < windowMs) return check;
  return { status: 'pass', passes: check.passes + 1, failures: check.failures };
}

/**
 * Detects a "lone Alt tap": Alt pressed and released with no other key
 * pressed in between. That is what makes Windows browsers focus their menu.
 */
export interface AltTapState {
  altDown: boolean;
  dirty: boolean;
}

export const initialAltTap: AltTapState = { altDown: false, dirty: false };

export function altTapStep(
  state: AltTapState,
  ev: { type: 'down' | 'up'; code: string; repeat: boolean },
): { state: AltTapState; tapped: boolean } {
  const isAlt = ev.code === 'AltLeft' || ev.code === 'AltRight';
  if (ev.type === 'down') {
    if (isAlt) {
      if (ev.repeat) return { state, tapped: false };
      return { state: { altDown: true, dirty: state.altDown ? state.dirty : false }, tapped: false };
    }
    return { state: { ...state, dirty: true }, tapped: false };
  }
  if (isAlt && state.altDown) {
    return { state: initialAltTap, tapped: !state.dirty };
  }
  return { state, tapped: false };
}
