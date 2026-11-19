import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardCapture } from '../input/capture';
import { codeLabel, comboLabel } from '../input/keys';
import { initialRecorder, recorderStep, type RecorderState } from '../input/recorder';
import { modifierOfAny } from '../model/codes';
import { bindingFingerprint } from '../model/fingerprint';
import { bindingsOverlap, validateProfile } from '../model/profile';
import {
  assignKeyEverywhere,
  bindingIdFor,
  changeDefaultHand,
  keyUsage,
  slugify,
  suggestFinger,
  uniqueId,
} from '../model/profileEdit';
import { wowBarsTemplate } from '../model/templates';
import { FINGERS, HANDS, SCHEMA_VERSION, type Binding, type Finger, type Hand, type KeyAssignment, type Profile } from '../model/types';
import { ID_PATTERN } from '../model/yamlDoc';
import { navigate, setNavGuard } from './nav';
import { useStorage } from './storageContext';

interface Props {
  /** Profile id to edit, or undefined for a new profile. */
  editId?: string;
  /** For a new profile: id of a profile to copy. */
  copyFrom?: string;
}

type Notice = { kind: 'ok' | 'error'; text: string };

const emptyProfile = (): Profile => ({ schema: SCHEMA_VERSION, id: '', name: '', defaultHand: 'left', bindings: [] });

export function ProfileEditor({ editId, copyFrom }: Props) {
  const { data, repo, reload } = useStorage();
  const [draft, setDraft] = useState<Profile | null>(null);
  const [saved, setSaved] = useState<Profile | null>(null);
  const [idTouched, setIdTouched] = useState(false);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const isNew = editId === undefined;

  const entry = useMemo(() => data?.profiles.find((p) => p.fileId === (editId ?? copyFrom)), [data, editId, copyFrom]);
  const sessionCount = isNew ? 0 : (entry?.sessions.length ?? 0);

  // Initialise the draft once the data is loaded.
  useEffect(() => {
    if (draft || !data) return;
    if (isNew) {
      const src = entry?.profile;
      if (src) {
        const name = `${src.name} (copy)`;
        const taken = data.profiles.map((p) => p.fileId);
        setDraft({ ...structuredClone(src), name, id: uniqueId(slugify(name), taken) });
      } else setDraft(emptyProfile());
      setSaved(null);
    } else if (entry?.profile) {
      setDraft(structuredClone(entry.profile));
      setSaved(entry.profile);
      setIdTouched(true);
    }
  }, [data, entry, draft, isNew]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => setNavGuard(() => !dirtyRef.current || window.confirm('Leave without saving your changes?')), []);
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  const otherIds = useMemo(
    () => new Set((data?.profiles ?? []).map((p) => p.fileId).filter((id) => id !== editId)),
    [data, editId],
  );

  const problems = useMemo(() => {
    if (!draft) return [];
    const list: string[] = [];
    if (!draft.name.trim()) list.push('Give the profile a name.');
    if (!ID_PATTERN.test(draft.id)) list.push('The id may only use letters, digits, ".", "_" and "-".');
    else if (otherIds.has(draft.id)) list.push(`Another profile already uses the id "${draft.id}".`);
    if (draft.bindings.length === 0) list.push('Add at least one binding.');
    if (!list.length) list.push(...validateProfile(draft));
    return list;
  }, [draft, otherIds]);

  const savedFingerprints = useMemo(() => {
    const map = new Map<string, string>();
    if (saved) for (const b of saved.bindings) map.set(b.id, bindingFingerprint(b, saved));
    return map;
  }, [saved]);

  if (!data) return <main tabIndex={-1} className="page"><p className="muted">Loading…</p></main>;
  if (!isNew && !entry?.profile) {
    return (
      <main tabIndex={-1} className="page">
        <p className="notice error">
          {entry ? `profiles/${editId}.yaml has errors; fix them in the file first (see the Data page).` : `There is no profile "${editId}".`}
        </p>
        <p>
          <a href="#/data">Back to Data</a>
        </p>
      </main>
    );
  }
  if (!draft) return <main tabIndex={-1} className="page"><p className="muted">Loading…</p></main>;

  const update = (fn: (p: Profile) => Profile) => {
    setNotice(null);
    setDraft((p) => (p ? fn(p) : p));
  };

  const setName = (name: string) =>
    update((p) => ({ ...p, name, id: idTouched ? p.id : uniqueId(slugify(name), otherIds) }));

  const updateBinding = (index: number, fn: (b: Binding) => Binding) =>
    update((p) => ({ ...p, bindings: p.bindings.map((b, i) => (i === index ? fn(b) : b)) }));

  const moveBinding = (index: number, delta: number) =>
    update((p) => {
      const next = [...p.bindings];
      const [b] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, b);
      return { ...p, bindings: next };
    });

  /** Add a recorded combo as a binding; returns a problem message if it can't be added. */
  const addRecorded = (codes: string[]): string | null => {
    const p = draftRef.current;
    if (!p) return null;
    const candidate: Binding = { id: 'new', keys: codes.map((code) => ({ code, finger: 'index' })) };
    const clash = p.bindings.find((b) => bindingsOverlap(b, candidate));
    if (clash) return `${comboLabel(codes)} is already in this profile (${clash.label ?? clash.id}).`;
    const keys: KeyAssignment[] = codes.map((code) => ({ code, ...suggestFinger(code, p) }));
    const id = bindingIdFor(codes, p.bindings.map((b) => b.id));
    const next = { ...p, bindings: [...p.bindings, { id, keys }] };
    draftRef.current = next; // so a quick second combo sees this one
    setNotice(null);
    setDraft(next);
    return null;
  };

  const save = async () => {
    if (!repo || problems.length) return;
    setBusy(true);
    try {
      await repo.saveProfile(draft, isNew ? undefined : editId);
      await reload();
      setSaved(draft);
      dirtyRef.current = false;
      setNotice({ kind: 'ok', text: `Saved profiles/${draft.id}.yaml` });
      if (isNew || draft.id !== editId) navigate(`#/profile/${encodeURIComponent(draft.id)}`);
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const usage = keyUsage(draft);
  const changedBindings = saved && sessionCount
    ? draft.bindings.filter((b) => savedFingerprints.has(b.id) && savedFingerprints.get(b.id) !== bindingFingerprint(b, draft))
    : [];

  return (
    <main tabIndex={-1} className="page">
      <header className="page-header">
        <div>
          <p className="muted small">
            <a href="#/data">Data</a> / {isNew ? 'New profile' : 'Edit profile'}
          </p>
          <h1>{draft.name || (isNew ? 'New profile' : draft.id)}</h1>
          {!isNew && <p className="muted"><code>profiles/{editId}.yaml</code> · {sessionCount} sessions</p>}
        </div>
        <div className="row-actions">
          <a className="button secondary" href="#/data">
            {dirty ? 'Cancel' : 'Close'}
          </a>
          <button onClick={save} disabled={busy || !dirty || problems.length > 0}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      {notice && <p className={`notice ${notice.kind}`}>{notice.text}</p>}
      {dirty && problems.length > 0 && (
        <div className="notice error">
          <strong>Can't save yet:</strong>
          <ul className="plain-list">
            {problems.slice(0, 6).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {changedBindings.length > 0 && (
        <p className="notice warn">
          You changed the keys or fingers of {changedBindings.length} binding(s) that already have results. Their
          statistics will start fresh; the old results stay in the session files.
        </p>
      )}

      <section className="card">
        <h2>Details</h2>
        <div className="form-grid">
          <label>
            <span>Name</span>
            <input value={draft.name} onChange={(e) => setName(e.target.value)} placeholder="Azeron – WoW" autoFocus={isNew} />
          </label>
          <label>
            <span>Id (file name)</span>
            <input
              value={draft.id}
              onChange={(e) => {
                setIdTouched(true);
                update((p) => ({ ...p, id: e.target.value.trim() }));
              }}
              placeholder="azeron-wow"
            />
            {!isNew && draft.id !== editId && sessionCount > 0 && (
              <small className="muted">The session folder moves along with the new id.</small>
            )}
          </label>
          <label>
            <span>Device (optional)</span>
            <input
              value={draft.device ?? ''}
              onChange={(e) => update((p) => ({ ...p, device: e.target.value || undefined }))}
              placeholder="Azeron Cyborg 2"
            />
          </label>
          <label>
            <span>Default hand</span>
            <select value={draft.defaultHand} onChange={(e) => update((p) => changeDefaultHand(p, e.target.value as Hand))}>
              {HANDS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
            <small className="muted">Keys use this hand unless set otherwise.</small>
          </label>
        </div>
      </section>

      <section className="card">
        <div className="card-title">
          <h2>Bindings ({draft.bindings.length})</h2>
          <div className="row-actions">
            {draft.bindings.length === 0 && (
              <button className="secondary" onClick={() => update((p) => ({ ...wowBarsTemplate(p.id, p.name), id: p.id, name: p.name, device: p.device, defaultHand: p.defaultHand }))}>
                Fill with WoW bars 1–4
              </button>
            )}
            <button onClick={() => setRecording(true)} disabled={recording}>
              Record bindings
            </button>
          </div>
        </div>
        {recording && <Recorder onCombo={addRecorded} onDone={() => setRecording(false)} />}
        {draft.bindings.length === 0 && !recording && (
          <p className="muted">No bindings yet. Click "Record bindings" and press the key combinations you want to practise.</p>
        )}
        {draft.bindings.length > 0 && (
          <div className="table-scroll">
            <table className="bindings">
              <thead>
                <tr>
                  <th>Keys and fingers</th>
                  <th>Label</th>
                  <th>Id</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.bindings.map((b, i) => {
                  const changed = sessionCount > 0 && savedFingerprints.has(b.id) && savedFingerprints.get(b.id) !== bindingFingerprint(b, draft);
                  return (
                    <tr key={i}>
                      <td>
                        <div className="key-list">
                          {b.keys.map((k, j) => (
                            <KeyEditor
                              key={j}
                              keyAssignment={k}
                              defaultHand={draft.defaultHand}
                              onChange={(next) => updateBinding(i, (bb) => ({ ...bb, keys: bb.keys.map((x, n) => (n === j ? next : x)) }))}
                            />
                          ))}
                          {changed && <span className="badge warn">stats restart</span>}
                        </div>
                      </td>
                      <td>
                        <input
                          className="label-input"
                          value={b.label ?? ''}
                          placeholder={comboLabel(b.keys.map((k) => k.code))}
                          onChange={(e) => updateBinding(i, (bb) => ({ ...bb, label: e.target.value || undefined }))}
                        />
                      </td>
                      <td>
                        <input
                          className="id-input"
                          value={b.id}
                          onChange={(e) => updateBinding(i, (bb) => ({ ...bb, id: e.target.value.trim() }))}
                          title="Session results refer to this id"
                        />
                      </td>
                      <td>
                        <div className="row-actions compact">
                          <button className="icon secondary" onClick={() => moveBinding(i, -1)} disabled={i === 0} title="Move up" aria-label="Move up">
                            ↑
                          </button>
                          <button className="icon secondary" onClick={() => moveBinding(i, 1)} disabled={i === draft.bindings.length - 1} title="Move down" aria-label="Move down">
                            ↓
                          </button>
                          <button className="icon secondary danger" onClick={() => update((p) => ({ ...p, bindings: p.bindings.filter((_, n) => n !== i) }))} title="Remove" aria-label="Remove binding">
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {usage.length > 0 && (
        <section className="card">
          <h2>Fingers per key</h2>
          <p className="muted small">Set a key's hand and finger once for every binding that uses it.</p>
          <div className="table-scroll">
            <table className="usage">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Used in</th>
                  <th>Hand</th>
                  <th>Finger</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u) => (
                  <tr key={u.code}>
                    <td>
                      <strong>{codeLabel(u.code)}</strong> <code className="muted">{u.code}</code>
                    </td>
                    <td>{u.bindings} binding{u.bindings === 1 ? '' : 's'}</td>
                    <td>
                      <select
                        value={u.mixed ? '' : u.hand}
                        onChange={(e) => update((p) => assignKeyEverywhere(p, u.code, u.finger ?? 'index', e.target.value as Hand))}
                      >
                        {u.mixed && <option value="">mixed</option>}
                        {HANDS.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={u.mixed ? '' : u.finger}
                        onChange={(e) => update((p) => assignKeyEverywhere(p, u.code, e.target.value as Finger, u.hand ?? p.defaultHand))}
                      >
                        {u.mixed && <option value="">mixed</option>}
                        {FINGERS.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

function KeyEditor({
  keyAssignment: k,
  defaultHand,
  onChange,
}: {
  keyAssignment: KeyAssignment;
  defaultHand: Hand;
  onChange: (k: KeyAssignment) => void;
}) {
  const hand = k.hand ?? defaultHand;
  const modifier = modifierOfAny(k.code);
  const set = (patch: Partial<KeyAssignment> & { hand?: Hand }) => {
    const next: KeyAssignment = { code: patch.code ?? k.code, finger: patch.finger ?? k.finger };
    const h = patch.hand ?? hand;
    if (h !== defaultHand) next.hand = h;
    onChange(next);
  };
  // A modifier can be "this side only" (ControlLeft) or "either side" (Control).
  const sideOptions = modifier
    ? [
        { code: `${modifier}Left`, label: `${codeLabel(`${modifier}Left`)} only` },
        { code: `${modifier}Right`, label: `${codeLabel(`${modifier}Right`)} only` },
        { code: modifier, label: `either ${modifier === 'Meta' ? 'Win' : modifier === 'Control' ? 'Ctrl' : modifier}` },
      ]
    : null;
  return (
    <div className="key-chip">
      {sideOptions ? (
        <select className="key-code" value={k.code} onChange={(e) => set({ code: e.target.value })} title="Which physical key counts">
          {sideOptions.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <strong className="key-code">{codeLabel(k.code)}</strong>
      )}
      <select value={hand} onChange={(e) => set({ hand: e.target.value as Hand })} aria-label="Hand">
        {HANDS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <select value={k.finger} onChange={(e) => set({ finger: e.target.value as Finger })} aria-label="Finger">
        {FINGERS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Listens for key combinations and adds each one as a binding. */
function Recorder({ onCombo, onDone }: { onCombo: (codes: string[]) => string | null; onDone: () => void }) {
  const [last, setLast] = useState<{ text: string; ok: boolean } | null>(null);
  const [altGr, setAltGr] = useState(false);
  const onComboRef = useRef(onCombo);
  onComboRef.current = onCombo;

  useEffect(() => {
    const capture = new KeyboardCapture();
    let state: RecorderState = initialRecorder;
    capture.onKey((ev) => {
      const r = recorderStep(state, ev);
      state = r.state;
      if (!r.combo) return;
      setAltGr(r.combo.altGraph);
      const problem = onComboRef.current(r.combo.codes);
      setLast(problem ? { text: problem, ok: false } : { text: `Added ${comboLabel(r.combo.codes)}`, ok: true });
    });
    capture.onReset(() => {
      state = initialRecorder;
    });
    capture.start();
    return () => capture.stop();
  }, []);

  return (
    <div className="recorder" role="status">
      <div>
        <strong>Recording.</strong> Press each key combination you want to practise; each one is added as a binding.
        Modifiers on their own count when pressed and released alone.
        {last && <div className={last.ok ? 'ok-text' : 'bad-text'}>{last.text}</div>}
        {altGr && (
          <div className="muted small">
            That combination included AltGr: on your keyboard layout Right Alt also sends Left Ctrl.
          </div>
        )}
      </div>
      <button onClick={onDone}>Done</button>
    </div>
  );
}
