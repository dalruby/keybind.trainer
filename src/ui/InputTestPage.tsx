import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardCapture,
  enterLockedFullscreen,
  exitLockedFullscreen,
  keyboardLockSupported,
  type CapturedKeyEvent,
} from '../input/capture';
import {
  altTapStep,
  arm,
  focusLost,
  initialAltTap,
  newCheck,
  settle,
  type AltTapState,
  type FocusCheck,
} from '../input/checks';
import { codeLabel, comboLabel, digitSlot, type BarModifier } from '../input/keys';

interface LogRow extends CapturedKeyEvent {
  id: number;
  delta?: number;
  holdMs?: number;
}

const LOG_LIMIT = 60;
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
const BAR_ROWS: { mod: BarModifier; label: string }[] = [
  { mod: 'none', label: 'Bar 1 (no modifier)' },
  { mod: 'Control', label: 'Bar 2 (Ctrl)' },
  { mod: 'Shift', label: 'Bar 3 (Shift)' },
  { mod: 'Alt', label: 'Bar 4 (Alt)' },
];

type Coverage = Record<string, { count: number; sides: Set<string> }>;

function slotKey(mod: BarModifier, digit: number) {
  return `${mod}:${digit}`;
}

export function InputTestPage() {
  const [log, setLog] = useState<LogRow[]>([]);
  const [held, setHeld] = useState<string[]>([]);
  const [hasFocus, setHasFocus] = useState(() => document.hasFocus());
  const [ctrlCheck, setCtrlCheck] = useState<FocusCheck>(newCheck);
  const [altCheck, setAltCheck] = useState<FocusCheck>(newCheck);
  const [coverage, setCoverage] = useState<Coverage>({});
  const [minDelta, setMinDelta] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [bounces, setBounces] = useState<{ code: string; type: 'down' | 'up'; t: number }[]>([]);
  const [altGr, setAltGr] = useState(false);

  const idRef = useRef(0);
  const lastDownRef = useRef<number | null>(null);
  const downAtRef = useRef(new Map<string, number>());
  const altRef = useRef<AltTapState>(initialAltTap);

  const handleKey = useCallback((ev: CapturedKeyEvent) => {
    const row: LogRow = { ...ev, id: ++idRef.current };
    if (ev.type === 'down' && !ev.repeat) {
      if (lastDownRef.current !== null) {
        row.delta = ev.timeStamp - lastDownRef.current;
        const d = row.delta;
        if (d > 0) setMinDelta((m) => (m === null || d < m ? d : m));
      }
      lastDownRef.current = ev.timeStamp;
      downAtRef.current.set(ev.code, ev.timeStamp);
    }
    if (ev.type === 'up') {
      const at = downAtRef.current.get(ev.code);
      if (at !== undefined) row.holdMs = ev.timeStamp - at;
      downAtRef.current.delete(ev.code);
    }
    setLog((l) => [row, ...l].slice(0, LOG_LIMIT));
    setHeld(ev.held);
    setAltGr(ev.flags.altGraph);

    const now = performance.now();
    if (ev.type === 'down' && !ev.repeat && /^Digit[1-9]$/.test(ev.code) && ev.flags.ctrl) {
      setCtrlCheck((c) => arm(c, now));
    }
    const alt = altTapStep(altRef.current, ev);
    altRef.current = alt.state;
    if (alt.tapped) setAltCheck((c) => arm(c, now));

    if (ev.type === 'down' && !ev.repeat) {
      const slot = digitSlot(ev.code, ev.held, ev.flags);
      if (slot) {
        setCoverage((cov) => {
          const k = slotKey(slot.mod, slot.digit);
          const prev = cov[k] ?? { count: 0, sides: new Set<string>() };
          const sides = new Set(prev.sides);
          if (slot.side) sides.add(slot.side);
          return { ...cov, [k]: { count: prev.count + 1, sides } };
        });
      }
    }
  }, []);

  useEffect(() => {
    const capture = new KeyboardCapture();
    const offKey = capture.onKey(handleKey);
    const offBounce = capture.onBounce((code, type, t) => setBounces((b) => [...b, { code, type, t }]));
    const offReset = capture.onReset(() => {
      const now = performance.now();
      setHeld([]);
      setAltGr(false);
      altRef.current = initialAltTap;
      setCtrlCheck((c) => focusLost(c, now));
      setAltCheck((c) => focusLost(c, now));
    });
    capture.start();

    const onFocus = () => setHasFocus(true);
    const onBlur = () => setHasFocus(false);
    const onFs = () => {
      if (!document.fullscreenElement) setLocked(false);
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFs);

    // Settle waiting checks, and catch focus loss that fires no blur event.
    const timer = window.setInterval(() => {
      const now = performance.now();
      const focused = document.hasFocus();
      setHasFocus(focused);
      if (!focused) {
        setCtrlCheck((c) => focusLost(c, now));
        setAltCheck((c) => focusLost(c, now));
      } else {
        setCtrlCheck((c) => settle(c, now));
        setAltCheck((c) => settle(c, now));
      }
    }, 100);

    return () => {
      offKey();
      offReset();
      offBounce();
      capture.stop();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFs);
      window.clearInterval(timer);
    };
  }, [handleKey]);

  const toggleLock = async () => {
    setLockError(null);
    try {
      if (locked) {
        await exitLockedFullscreen();
        setLocked(false);
      } else {
        const ok = await enterLockedFullscreen();
        setLocked(ok);
        if (!ok) setLockError('Fullscreen worked, but this browser has no Keyboard Lock API.');
      }
    } catch (err) {
      setLockError(String(err));
    }
  };

  const reset = () => {
    setLog([]);
    setCoverage({});
    setMinDelta(null);
    setBounces([]);
    setCtrlCheck(newCheck());
    setAltCheck(newCheck());
    lastDownRef.current = null;
  };

  const coveredCount = Object.keys(coverage).length;

  const copyReport = async () => {
    const report = buildReport({ ctrlCheck, altCheck, coverage, minDelta, log, bounces });
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this report:', report);
    }
  };

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Input test</h1>
          <p className="muted">
            Checks that this browser passes your key combinations to the page. Keys only reach the page while it has
            focus.
          </p>
        </div>
        <div className={`focus-pill ${hasFocus ? 'ok' : 'bad'}`} role="status">
          {hasFocus ? 'Page has focus' : 'Page lost focus. Click here.'}
        </div>
      </header>

      <section className="card">
        <h2>Browser checks</h2>
        <div className="checks">
          <CheckRow
            title="Ctrl + 1…9 stays on this tab"
            how="Open a second tab first, come back, then press Ctrl + 1, Ctrl + 2, …"
            check={ctrlCheck}
          />
          <CheckRow
            title="Tapping Alt alone keeps focus"
            how="Press and release Alt (left, and right if you use it) without any other key."
            check={altCheck}
          />
          <div className="check">
            <div className="check-main">
              <strong>Timestamp resolution</strong>
              <span className="muted">Press keys quickly. Shows the smallest gap seen between two keydowns.</span>
            </div>
            <span className="badge neutral">{minDelta === null ? '—' : `${minDelta.toFixed(3)} ms`}</span>
          </div>
          <div className="check">
            <div className="check-main">
              <strong>Key bounce ignored</strong>
              <span className="muted">
                A key released and pressed again within 10 ms counts once.
                {bounces.length > 0 && ` Last: ${codeLabel(bounces[bounces.length - 1].code)}.`}
              </span>
            </div>
            <span className={`badge ${bounces.length ? 'bad' : 'neutral'}`}>{bounces.length}</span>
          </div>
        </div>
        <div className="row-actions">
          <button onClick={toggleLock}>{locked ? 'Exit fullscreen' : 'Fullscreen + Keyboard Lock'}</button>
          <span className="muted small">
            {keyboardLockSupported()
              ? 'Fallback if a check fails. Hold Esc to leave fullscreen.'
              : 'Keyboard Lock is not available in this browser (needs Chrome or Edge).'}
          </span>
        </div>
        {lockError && <p className="error">{lockError}</p>}
      </section>

      <section className="card">
        <div className="card-title">
          <h2>WoW bar coverage</h2>
          <span className="muted">{coveredCount} / 40 combinations seen</span>
        </div>
        <p className="muted small">Press each slot on the Azeron. A cell lights up when the page receives exactly that combination.</p>
        <div className="grid-scroll">
          <table className="coverage">
            <thead>
              <tr>
                <th />
                {DIGITS.map((d) => (
                  <th key={d}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {BAR_ROWS.map((row) => (
                <tr key={row.mod}>
                  <th scope="row">{row.label}</th>
                  {DIGITS.map((d) => {
                    const c = coverage[slotKey(row.mod, d)];
                    const sides = c ? [...c.sides].map((s) => (s === 'left' ? 'L' : 'R')).join('') : '';
                    return (
                      <td key={d} className={c ? 'hit' : ''} title={c ? `${c.count}×` : 'not seen'}>
                        {c ? sides || '✓' : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-title">
          <h2>Live events</h2>
          <div className="row-actions">
            <button onClick={copyReport}>{copied ? 'Copied' : 'Copy report'}</button>
            <button className="secondary" onClick={reset}>
              Clear
            </button>
          </div>
        </div>
        <p className="held">
          <span className="muted">Held:</span> {held.length ? comboLabel(held) : <span className="muted">nothing</span>}
          {altGr && <span className="badge neutral altgr">AltGr</span>}
        </p>
        <div className="log-scroll">
          <table className="log">
            <thead>
              <tr>
                <th>Type</th>
                <th>code</th>
                <th>key</th>
                <th>Held after</th>
                <th className="num">Since last down</th>
                <th className="num">Hold</th>
                <th className="num">timeStamp</th>
              </tr>
            </thead>
            <tbody>
              {log.map((r) => (
                <tr key={r.id} className={r.repeat ? 'repeat' : r.type}>
                  <td>
                    {r.type}
                    {r.repeat ? ' (repeat)' : ''}
                  </td>
                  <td>
                    {r.code ? (
                      <>
                        <code>{r.code}</code> <span className="muted">{codeLabel(r.code)}</span>
                      </>
                    ) : (
                      <span className="muted">(empty)</span>
                    )}
                  </td>
                  <td>
                    <code>{JSON.stringify(r.key)}</code>
                  </td>
                  <td>
                    {r.held.length ? comboLabel(r.held) : '—'}
                    {r.flags.altGraph && <span className="muted"> (AltGr)</span>}
                  </td>
                  <td className="num">{r.delta !== undefined ? r.delta.toFixed(1) : ''}</td>
                  <td className="num">{r.holdMs !== undefined ? r.holdMs.toFixed(1) : ''}</td>
                  <td className="num">{r.timeStamp.toFixed(2)}</td>
                </tr>
              ))}
              {log.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted empty">
                    Press any key.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function CheckRow({ title, how, check }: { title: string; how: string; check: FocusCheck }) {
  const label = {
    untested: 'Not tested',
    waiting: 'Checking…',
    pass: 'Pass',
    fail: 'Fail',
  }[check.status];
  const cls = { untested: 'neutral', waiting: 'neutral', pass: 'ok', fail: 'bad' }[check.status];
  return (
    <div className="check">
      <div className="check-main">
        <strong>{title}</strong>
        <span className="muted">{how}</span>
      </div>
      <div className="check-result">
        <span className={`badge ${cls}`}>{label}</span>
        {(check.passes > 0 || check.failures > 0) && (
          <span className="muted small">
            {check.passes} pass · {check.failures} fail
          </span>
        )}
      </div>
    </div>
  );
}

function buildReport(args: {
  ctrlCheck: FocusCheck;
  altCheck: FocusCheck;
  coverage: Coverage;
  minDelta: number | null;
  log: LogRow[];
  bounces: { code: string; type: 'down' | 'up'; t: number }[];
}): string {
  const missing: string[] = [];
  for (const row of BAR_ROWS) {
    for (const d of DIGITS) {
      if (!args.coverage[slotKey(row.mod, d)]) missing.push(row.mod === 'none' ? `${d}` : `${row.mod}+${d}`);
    }
  }
  const lines = [
    `# keybind.trainer input test report`,
    `userAgent: ${JSON.stringify(navigator.userAgent)}`,
    `keyboardLock: ${keyboardLockSupported()}`,
    `ctrlDigitCheck: { status: ${args.ctrlCheck.status}, pass: ${args.ctrlCheck.passes}, fail: ${args.ctrlCheck.failures} }`,
    `altTapCheck: { status: ${args.altCheck.status}, pass: ${args.altCheck.passes}, fail: ${args.altCheck.failures} }`,
    `minKeydownGapMs: ${args.minDelta === null ? 'null' : args.minDelta.toFixed(3)}`,
    `bouncesIgnored: ${args.bounces.length}`,
    ...args.bounces.slice(-10).map((b) => `  - { type: ${b.type}, code: ${b.code}, t: ${b.t.toFixed(2)} }`),
    `coverage: ${40 - missing.length}/40`,
    `missing: [${missing.join(', ')}]`,
    `recentEvents:`,
    ...args.log
      .slice(0, 30)
      .reverse()
      .map(
        (r) =>
          `  - { type: ${r.type}, code: ${r.code}, key: ${JSON.stringify(r.key)}, repeat: ${r.repeat}, held: [${r.held.join(', ')}],${r.flags.altGraph ? ' altGr: true,' : ''} t: ${r.timeStamp.toFixed(2)} }`,
      ),
  ];
  return lines.join('\n');
}
