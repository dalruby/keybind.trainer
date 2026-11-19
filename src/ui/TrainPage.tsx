import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { KeyboardCapture } from '../input/capture';
import { codeLabel, comboLabel } from '../input/keys';
import { PROMPT_STYLES, handOf, type Binding, type Profile, type PromptStyle, type Session } from '../model/types';
import { SessionEngine } from '../session/engine';
import { summarizeSession } from '../stats/basic';
import { setNavGuard } from './nav';
import { useStorage } from './storageContext';

interface Settings {
  minutes: number;
  prompt: PromptStyle;
  showFingers: boolean;
  gapMs: number;
  warmup: number;
}

const PRESETS = [2, 5, 10, 20];
const DEFAULTS: Settings = { minutes: 5, prompt: 'keys', showFingers: true, gapMs: 250, warmup: 0 };
const SETTINGS_KEY = 'keybind-trainer.train-settings';

function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}
function storeSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* settings are a convenience only */
  }
}

type Phase =
  | { kind: 'setup' }
  | { kind: 'running'; profile: Profile; settings: Settings; run: number }
  | { kind: 'done'; profile: Profile; settings: Settings; session: Session; path?: string; error?: string };

export function TrainPage({ profileId }: { profileId?: string }) {
  const { data, repo, reload } = useStorage();
  const profiles = useMemo(() => data?.profiles.flatMap((p) => (p.profile ? [p.profile] : [])) ?? [], [data]);
  const [selected, setSelected] = useState<string | undefined>(profileId);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });

  useEffect(() => {
    if (!selected && profiles.length) setSelected(profiles[0].id);
  }, [profiles, selected]);

  const profile = profiles.find((p) => p.id === selected);

  const start = (p: Profile, s: Settings) => {
    storeSettings(s);
    setPhase({ kind: 'running', profile: p, settings: s, run: Date.now() });
  };

  const save = useCallback(
    async (p: Profile, s: Settings, session: Session) => {
      try {
        const path = await repo!.saveSession(session);
        await reload();
        setPhase({ kind: 'done', profile: p, settings: s, session, path });
      } catch (e) {
        setPhase({ kind: 'done', profile: p, settings: s, session, error: e instanceof Error ? e.message : String(e) });
      }
    },
    [repo, reload],
  );

  if (phase.kind === 'running') {
    return (
      <Runner
        key={phase.run}
        profile={phase.profile}
        settings={phase.settings}
        onEnd={(session) => (session ? void save(phase.profile, phase.settings, session) : setPhase({ kind: 'setup' }))}
      />
    );
  }

  if (phase.kind === 'done') {
    return (
      <Summary
        phase={phase}
        onAgain={() => start(phase.profile, phase.settings)}
        onSetup={() => setPhase({ kind: 'setup' })}
        onRetrySave={() => void save(phase.profile, phase.settings, phase.session)}
      />
    );
  }

  if (!data) return <main className="page"><p className="muted">Loading…</p></main>;

  const minutesValid = settings.minutes > 0 && settings.minutes <= 120;
  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Train</h1>
          <p className="muted">Bindings come up in random order. Press each one as fast and accurately as you can.</p>
        </div>
      </header>

      {profiles.length === 0 ? (
        <section className="card">
          <p>
            No profiles yet. <a href="#/profile/new">Create one</a> or add the example on the <a href="#/data">Data</a> page.
          </p>
        </section>
      ) : (
        <section className="card">
          <div className="form-grid">
            <label>
              <span>Profile</span>
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.bindings.length} bindings)
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <span>Length (minutes)</span>
              <div className="segmented">
                {PRESETS.map((m) => (
                  <button
                    key={m}
                    className={settings.minutes === m ? '' : 'secondary'}
                    onClick={() => setSettings((s) => ({ ...s, minutes: m }))}
                  >
                    {m}
                  </button>
                ))}
                <input
                  type="number"
                  min={0.5}
                  max={120}
                  step={0.5}
                  value={settings.minutes}
                  onChange={(e) => setSettings((s) => ({ ...s, minutes: Number(e.target.value) }))}
                  aria-label="Custom length in minutes"
                  className="minutes-input"
                />
              </div>
            </div>
            <label>
              <span>Prompt shows</span>
              <select value={settings.prompt} onChange={(e) => setSettings((s) => ({ ...s, prompt: e.target.value as PromptStyle }))}>
                {PROMPT_STYLES.map((p) => (
                  <option key={p} value={p}>
                    {p === 'keys' ? 'the keys to press' : p === 'label' ? 'the label (recall the keys)' : 'label and keys'}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.showFingers}
                onChange={(e) => setSettings((s) => ({ ...s, showFingers: e.target.checked }))}
              />
              <span>Show which finger presses each key</span>
            </label>
          </div>
          <details className="advanced">
            <summary>More settings</summary>
            <div className="form-grid">
              <label>
                <span>Pause between prompts (ms)</span>
                <input
                  type="number"
                  min={0}
                  max={2000}
                  step={50}
                  value={settings.gapMs}
                  onChange={(e) => setSettings((s) => ({ ...s, gapMs: Math.max(0, Number(e.target.value)) }))}
                />
              </label>
              <label>
                <span>Warm-up attempts left out of statistics</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={settings.warmup}
                  onChange={(e) => setSettings((s) => ({ ...s, warmup: Math.max(0, Math.floor(Number(e.target.value))) }))}
                />
              </label>
            </div>
          </details>
          <div className="row-actions">
            <button className="big" disabled={!profile || !minutesValid} onClick={() => profile && start(profile, settings)}>
              Start
            </button>
            {!minutesValid && <span className="bad-text">Choose a length between 0.5 and 120 minutes.</span>}
          </div>
        </section>
      )}
    </main>
  );
}

// --- running a session -------------------------------------------------------------

type Feedback = { kind: 'miss' | 'correct'; text: string; n: number } | null;

function Runner({ profile, settings, onEnd }: { profile: Profile; settings: Settings; onEnd: (s: Session | null) => void }) {
  const engine = useMemo(
    () =>
      new SessionEngine(profile, {
        durationSec: Math.round(settings.minutes * 60),
        prompt: settings.prompt,
        gapMs: settings.gapMs,
        warmup: settings.warmup,
      }),
    [profile, settings],
  );
  const [countdown, setCountdown] = useState(3);
  const [paused, setPaused] = useState(false);
  const [prompt, setPrompt] = useState<{ binding: Binding; n: number } | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [remaining, setRemaining] = useState(settings.minutes * 60 * 1000);
  const [counts, setCounts] = useState({ done: 0, misses: 0 });
  const nextTimer = useRef<number | undefined>(undefined);
  const ended = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  useEffect(() => setNavGuard(() => ended.current || window.confirm('Leave and discard this session?')), []);

  const finish = useCallback(() => {
    if (ended.current) return;
    ended.current = true;
    window.clearTimeout(nextTimer.current);
    onEndRef.current(engine.finish(performance.now()));
  }, [engine]);

  const showNext = useCallback(() => {
    if (ended.current || engine.state !== 'waiting') return;
    if (engine.isOver(performance.now())) return finish();
    const binding = engine.nextPrompt();
    setPrompt((p) => ({ binding, n: (p?.n ?? 0) + 1 }));
  }, [engine, finish]);

  // Tell the engine when the prompt is actually on screen.
  useLayoutEffect(() => {
    if (!prompt) return;
    const id = requestAnimationFrame((ts) => engine.promptShown(ts));
    return () => cancelAnimationFrame(id);
  }, [prompt, engine]);

  // Countdown, then start.
  useEffect(() => {
    if (countdown <= 0) return;
    const t = window.setTimeout(() => {
      if (countdown === 1) {
        engine.start(performance.now());
        showNext();
      }
      setCountdown((c) => c - 1);
    }, 700);
    return () => window.clearTimeout(t);
  }, [countdown, engine, showNext]);

  const pause = useCallback(() => {
    if (engine.state !== 'waiting' && engine.state !== 'prompting') return;
    window.clearTimeout(nextTimer.current);
    engine.pause(performance.now());
    setPrompt(null);
    setFeedback(null);
    setPaused(true);
  }, [engine]);

  const resume = () => {
    engine.resume(performance.now());
    setPaused(false);
    nextTimer.current = window.setTimeout(showNext, 600);
  };

  // Keyboard capture for the whole run.
  useEffect(() => {
    const capture = new KeyboardCapture();
    capture.onKey((ev) => {
      if (ev.type !== 'down') return;
      const out = engine.handleKeyDown(ev);
      if (out.kind === 'miss') {
        setCounts((c) => ({ ...c, misses: c.misses + 1 }));
        setFeedback((f) => ({ kind: 'miss', text: comboLabel(out.miss.k), n: (f?.n ?? 0) + 1 }));
      } else if (out.kind === 'correct') {
        setCounts((c) => ({ ...c, done: c.done + 1 }));
        setFeedback((f) => ({ kind: 'correct', text: `${Math.round(out.rt)} ms`, n: (f?.n ?? 0) + 1 }));
        setPrompt(null);
        nextTimer.current = window.setTimeout(showNext, engine.opts.gapMs);
      }
    });
    capture.onBounce(() => engine.bounces++);
    capture.onReset(() => pause());
    capture.start();
    return () => {
      capture.stop();
      window.clearTimeout(nextTimer.current);
    };
  }, [engine, showNext, pause]);

  // Clock.
  useEffect(() => {
    const t = window.setInterval(() => {
      if (engine.state === 'ready' || engine.state === 'done') return;
      const now = performance.now();
      setRemaining(engine.remainingMs(now));
      if (engine.isOver(now) && engine.state !== 'paused') finish();
    }, 100);
    return () => window.clearInterval(t);
  }, [engine, finish]);

  const endEarly = () => {
    pause();
    if (engine.attempts.length === 0) {
      ended.current = true;
      onEnd(null);
    } else if (window.confirm(`End now and save the ${engine.attempts.length} attempts so far?`)) {
      finish();
    }
  };
  const discard = () => {
    pause();
    if (window.confirm('Discard this session? Nothing will be saved.')) {
      ended.current = true;
      onEnd(null);
    }
  };

  const total = settings.minutes * 60 * 1000;
  return (
    <main className="trainer">
      <div className="trainer-top">
        <div className="muted small">
          {profile.name} · {counts.done} done · {counts.misses} misses
        </div>
        <div className="clock" aria-label="Time remaining">{formatClock(remaining)}</div>
        <div className="row-actions compact">
          {paused ? <button onClick={resume}>Resume</button> : <button className="secondary" onClick={pause} disabled={countdown > 0}>Pause</button>}
          <button className="secondary" onClick={endEarly}>End</button>
          <button className="secondary danger" onClick={discard}>Discard</button>
        </div>
      </div>
      <div className="progress"><div style={{ width: `${(1 - remaining / total) * 100}%` }} /></div>

      <div className="stage">
        {countdown > 0 ? (
          <div className="countdown">{countdown}</div>
        ) : paused ? (
          <div className="paused">
            <h2>Paused</h2>
            <p className="muted">The clock stopped. The prompt you were on is not counted.</p>
            <button className="big" onClick={resume}>Resume</button>
          </div>
        ) : prompt ? (
          <PromptCard key={`prompt-${prompt.n}`} binding={prompt.binding} profile={profile} settings={settings} />
        ) : (
          <div className="prompt-gap" />
        )}
        <div className={`feedback ${feedback?.kind ?? ''}`} key={`feedback-${feedback?.n ?? 0}`}>
          {feedback && (feedback.kind === 'miss' ? `✕ ${feedback.text}` : `✓ ${feedback.text}`)}
        </div>
      </div>
      <p className="muted small center">Keys are captured while training. Use the buttons, or switch windows, to pause.</p>
    </main>
  );
}

function PromptCard({ binding, profile, settings }: { binding: Binding; profile: Profile; settings: Settings }) {
  const showLabel = settings.prompt !== 'keys' && binding.label;
  const showKeys = settings.prompt !== 'label' || !binding.label;
  const order = (code: string) => (/^(Control|Shift|Alt|Meta)/.test(code) ? 0 : 1);
  const keys = [...binding.keys].sort((a, b) => order(a.code) - order(b.code));
  return (
    <div className="prompt">
      {showLabel && <div className="prompt-label">{binding.label}</div>}
      {showKeys && (
        <div className="keycaps">
          {keys.map((k, i) => (
            <div key={k.code} className="keycap-wrap">
              {i > 0 && <span className="plus">+</span>}
              <div className="keycap">
                <span className="cap">{codeLabel(k.code)}</span>
                {settings.showFingers && (
                  <span className="finger">
                    {handOf(k, profile) === 'left' ? 'L' : 'R'} {k.finger}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatClock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// --- after the session ---------------------------------------------------------------

function Summary({
  phase,
  onAgain,
  onSetup,
  onRetrySave,
}: {
  phase: Extract<Phase, { kind: 'done' }>;
  onAgain: () => void;
  onSetup: () => void;
  onRetrySave: () => void;
}) {
  const { session, profile } = phase;
  const { total, perBinding } = summarizeSession(session);
  const byId = new Map(profile.bindings.map((b) => [b.id, b]));
  const rows = perBinding
    .filter((r) => !Number.isNaN(r.medianRt) || r.misses > 0)
    .sort((a, b) => (Number.isNaN(b.medianRt) ? Infinity : b.medianRt) - (Number.isNaN(a.medianRt) ? Infinity : a.medianRt));
  const accuracy = total.attempts ? 1 - total.attemptsWithMiss / total.attempts : NaN;

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Session done</h1>
          <p className="muted">
            {profile.name} · {(session.durationActual / 60).toFixed(1)} min
            {session.warmup ? ` · first ${session.warmup} attempts left out as warm-up` : ''}
          </p>
        </div>
        <div className="row-actions">
          <a className="button secondary" href={`#/stats/${encodeURIComponent(profile.id)}`}>Diagnostics</a>
          <button className="secondary" onClick={onSetup}>Change settings</button>
          <button onClick={onAgain}>Train again</button>
        </div>
      </header>

      {phase.path && <p className="notice ok">Saved {phase.path}</p>}
      {phase.error && (
        <p className="notice error">
          Could not save the session: {phase.error}{' '}
          <button className="secondary" onClick={onRetrySave}>Try again</button>
        </p>
      )}

      <section className="stats-row">
        <Stat label="Attempts" value={String(total.attempts)} />
        <Stat label="Median time" value={Number.isNaN(total.medianRt) ? '—' : `${Math.round(total.medianRt)} ms`} />
        <Stat label="Clean (no misclick)" value={Number.isNaN(accuracy) ? '—' : `${Math.round(accuracy * 100)}%`} />
        <Stat label="Misclicks" value={String(total.misses)} />
        {session.bounces ? <Stat label="Key bounces ignored" value={String(session.bounces)} /> : null}
      </section>

      <section className="card">
        <h2>Per binding, slowest first</h2>
        <p className="muted small">
          This session only. <a href={`#/stats/${encodeURIComponent(profile.id)}`}>Diagnostics</a> shows every finger across all sessions.
        </p>
        <div className="table-scroll">
          <table className="summary">
            <thead>
              <tr>
                <th>Binding</th>
                <th>Keys</th>
                <th className="num">Attempts</th>
                <th className="num">Median</th>
                <th className="num">Misclicks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const b = byId.get(r.id);
                return (
                  <tr key={r.id}>
                    <td>{b?.label ?? r.id}</td>
                    <td>{b ? comboLabel(b.keys.map((k) => k.code)) : ''}</td>
                    <td className="num">{r.attempts}</td>
                    <td className="num">{Number.isNaN(r.medianRt) ? '—' : `${Math.round(r.medianRt)} ms`}</td>
                    <td className="num">{r.misses || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="muted small">{label}</div>
    </div>
  );
}
