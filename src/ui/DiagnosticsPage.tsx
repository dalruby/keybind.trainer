import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { comboLabel } from '../input/keys';
import type { Binding, FingerId, Profile, SessionMode } from '../model/types';
import {
  MIN_TIMED,
  MISS_PENALTY_MS,
  bindingStats,
  collectSamples,
  fingerLabel,
  fingerSummaries,
  histogram,
  keyGrid,
  rankBindings,
  statsOf,
  trend,
  weakSpots,
  type BindingStats,
  type FingerBinding,
  type SessionFilter,
  type Stats,
} from '../stats/diagnostics';
import { EChart, axisStyle, baseOption, inkOn, useChartTheme, type ChartTheme } from './charts';
import { useStorage } from './storageContext';

type Measure = 'median' | 'p90' | 'missRate';
const MEASURES: { id: Measure; label: string }[] = [
  { id: 'median', label: 'Median time' },
  { id: 'p90', label: 'Slow end (90th percentile)' },
  { id: 'missRate', label: 'Misclick rate' },
];
const RANGES = [
  { id: 0, label: 'All sessions' },
  { id: 10, label: 'Last 10 sessions' },
  { id: 5, label: 'Last 5 sessions' },
  { id: 1, label: 'Last session' },
];

const ms = (v: number) => (Number.isNaN(v) ? '—' : `${Math.round(v)} ms`);
const pct = (v: number) => (Number.isNaN(v) ? '—' : `${Math.round(v * 100)}%`);
const fmt = (m: Measure, v: number) => (m === 'missRate' ? pct(v) : ms(v));
const bindingName = (b: Binding) => b.label ?? comboLabel(b.keys.map((k) => k.code));
const keysOf = (b: Binding) => comboLabel(b.keys.map((k) => k.code));

export function DiagnosticsPage({ profileId }: { profileId?: string }) {
  const { data } = useStorage();
  const theme = useChartTheme();
  const entries = useMemo(() => data?.profiles.filter((p) => p.profile) ?? [], [data]);
  const [selected, setSelected] = useState(profileId);
  const [range, setRange] = useState(0);
  const [mode, setMode] = useState<SessionMode | 'all'>('all');
  const [measure, setMeasure] = useState<Measure>('median');
  const [finger, setFinger] = useState<FingerId | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    if (!selected && entries.length) setSelected(entries[0].fileId);
  }, [entries, selected]);

  const selectDetail = (id: string | null) => {
    setDetail(id);
    if (id) requestAnimationFrame(() => document.getElementById('binding-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const entry = entries.find((e) => e.fileId === selected);
  const profile = entry?.profile;
  const sessions = useMemo(() => entry?.sessions.flatMap((s) => (s.session ? [s.session] : [])) ?? [], [entry]);

  const filter: SessionFilter = { lastSessions: range || undefined, mode };
  const set = useMemo(() => (profile ? collectSamples(profile, sessions, filter) : null), [profile, sessions, range, mode]);
  const perBinding = useMemo(() => (set ? bindingStats(set) : []), [set]);
  const fingers = useMemo(() => (set ? fingerSummaries(set, perBinding) : []), [set, perBinding]);

  useEffect(() => {
    if (fingers.length && (!finger || !fingers.some((f) => f.finger === finger))) setFinger(fingers[0].finger);
  }, [fingers, finger]);

  if (!data) return <main className="page"><p className="muted">Loading…</p></main>;
  if (!entries.length || !profile || !set) {
    return (
      <main className="page">
        <h1>Diagnostics</h1>
        <p className="muted">No profiles yet. <a href="#/data">Add one on the Data page.</a></p>
      </main>
    );
  }

  const total = statsOf(set.samples.map((s) => s.attempt));
  const leftOut = set.earlierVersion + set.removed;
  const currentFinger = fingers.find((f) => f.finger === finger) ?? fingers[0];
  const detailStats = perBinding.find((b) => b.id === detail);

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Diagnostics</h1>
          <p className="muted">How fast and how accurately each finger handles its keys. Click a bar or cell for details.</p>
        </div>
        <a className="button" href={`#/train/${encodeURIComponent(profile.id)}`}>Train</a>
      </header>

      <div className="filter-row card">
        <label>
          <span>Profile</span>
          <select value={selected} onChange={(e) => { setSelected(e.target.value); setDetail(null); }}>
            {entries.map((e) => (
              <option key={e.fileId} value={e.fileId}>{e.profile!.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Sessions</span>
          <select value={range} onChange={(e) => setRange(Number(e.target.value))}>
            {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
        <label>
          <span>Mode</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as SessionMode | 'all')}>
            <option value="all">All modes</option>
            <option value="normal">Normal</option>
            <option value="weak-spot">Weak spots</option>
          </select>
        </label>
        <label>
          <span>Measure</span>
          <select value={measure} onChange={(e) => setMeasure(e.target.value as Measure)}>
            {MEASURES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
      </div>

      {set.sessions.length === 0 ? (
        <section className="card">
          <p>No sessions for this selection yet. <a href={`#/train/${encodeURIComponent(profile.id)}`}>Train</a> to see diagnostics.</p>
        </section>
      ) : (
        <>
          <section className="stats-row">
            <Tile label="Sessions" value={String(set.sessions.length)} />
            <Tile label="Attempts" value={String(total.n)} />
            <Tile label="Median time" value={ms(total.median)} />
            <Tile label="Slow end (p90)" value={ms(total.p90)} />
            <Tile label="Clean (no misclick)" value={pct(1 - total.missRate)} />
          </section>
          {leftOut > 0 && (
            <p className="muted small">
              {set.earlierVersion > 0 && `${set.earlierVersion} attempts belong to bindings whose keys or fingers changed since, `}
              {set.removed > 0 && `${set.removed} to bindings no longer in the profile, `}
              so they are left out.
            </p>
          )}

          <ChartCard
            title="By finger"
            subtitle={`${MEASURES.find((m) => m.id === measure)!.label} over every binding the finger takes part in`}
            chart={<FingerChart theme={theme} fingers={fingers} measure={measure} onSelect={(f) => setFinger(f as FingerId)} />}
            table={
              <StatsTable
                head="Finger"
                rows={fingers.map((f) => ({ key: f.finger, name: fingerLabel(f.finger), stats: f.stats, onClick: () => setFinger(f.finger) }))}
              />
            }
          />

          {currentFinger && (
            <ChartCard
              title={`${fingerLabel(currentFinger.finger)}: best to worst`}
              subtitle={
                <span className="finger-tabs">
                  {fingers.map((f) => (
                    <button key={f.finger} className={f.finger === currentFinger.finger ? '' : 'secondary'} onClick={() => setFinger(f.finger)}>
                      {fingerLabel(f.finger)}
                    </button>
                  ))}
                </span>
              }
              chart={<FingerBindingsChart theme={theme} list={currentFinger.bindings} measure={measure} onSelect={selectDetail} />}
              table={
                <StatsTable
                  head="Binding"
                  extra={(id) => {
                    const fb = currentFinger.bindings.find((b) => b.stats.id === id)!;
                    return fb.role === 'modifier' ? `holds ${comboLabel([fb.code])}` : 'presses';
                  }}
                  extraHead="Role"
                  rows={rankBindings(currentFinger.bindings, measure).map((fb) => ({
                    key: fb.stats.id,
                    name: `${bindingName(fb.stats.binding)} (${keysOf(fb.stats.binding)})`,
                    stats: fb.stats,
                    onClick: () => selectDetail(fb.stats.id),
                  }))}
                />
              }
            />
          )}

          <ChartCard
            title="Key grid"
            subtitle="Each key with and without modifiers; columns show the finger that presses the key"
            chart={<KeyGridChart theme={theme} set={keyGrid(set, perBinding)} measure={measure} onSelect={selectDetail} />}
            table={
              <StatsTable
                head="Binding"
                rows={perBinding.map((b) => ({ key: b.id, name: `${bindingName(b.binding)} (${keysOf(b.binding)})`, stats: b, onClick: () => selectDetail(b.id) }))}
              />
            }
          />

          <WeakSpots list={weakSpots(perBinding)} onSelect={selectDetail} />

          <TrendCard theme={theme} set={set} profile={profile} measure={measure} fingers={fingers.map((f) => f.finger)} />

          <section className="card" id="binding-detail">
            <div className="card-title">
              <h2>Binding detail</h2>
              <select value={detail ?? ''} onChange={(e) => setDetail(e.target.value || null)}>
                <option value="">Choose a binding…</option>
                {perBinding.map((b) => (
                  <option key={b.id} value={b.id}>{bindingName(b.binding)} ({keysOf(b.binding)})</option>
                ))}
              </select>
            </div>
            {detailStats ? (
              <BindingDetail theme={theme} stats={detailStats} set={set} profile={profile} />
            ) : (
              <p className="muted">Pick a binding, or click one in a chart above.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}

// --- building blocks ---------------------------------------------------------------

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="muted small">{label}</div>
    </div>
  );
}

/** A chart with a "Table" toggle; the table shows every value the chart does. */
function ChartCard({ title, subtitle, chart, table }: { title: string; subtitle?: ReactNode; chart: ReactNode; table: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="card">
      <div className="card-title">
        <h2>{title}</h2>
        <div className="segmented">
          <button className={asTable ? 'secondary' : ''} onClick={() => setAsTable(false)}>Chart</button>
          <button className={asTable ? '' : 'secondary'} onClick={() => setAsTable(true)}>Table</button>
        </div>
      </div>
      {subtitle && <div className="muted small chart-sub">{subtitle}</div>}
      {asTable ? <div className="table-scroll">{table}</div> : chart}
    </section>
  );
}

function StatsTable({
  head,
  rows,
  extra,
  extraHead,
}: {
  head: string;
  rows: { key: string; name: string; stats: Stats; onClick?: () => void }[];
  extra?: (key: string) => string;
  extraHead?: string;
}) {
  return (
    <table className="summary">
      <thead>
        <tr>
          <th>{head}</th>
          {extraHead && <th>{extraHead}</th>}
          <th className="num">Attempts</th>
          <th className="num">Median</th>
          <th className="num">p90</th>
          <th className="num">Misclick rate</th>
          <th className="num">Misclicks</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className={r.onClick ? 'clickable' : ''} onClick={r.onClick}>
            <td>{r.name}</td>
            {extra && <td>{extra(r.key)}</td>}
            <td className="num">{r.stats.n}</td>
            <td className="num">{ms(r.stats.median)}</td>
            <td className="num">{ms(r.stats.p90)}</td>
            <td className="num">{pct(r.stats.missRate)}</td>
            <td className="num">{r.stats.misses || ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function valueAxis(t: ChartTheme, measure: Measure) {
  return {
    type: 'value' as const,
    ...axisStyle(t),
    axisLabel: { ...axisStyle(t).axisLabel, formatter: (v: number) => (measure === 'missRate' ? `${Math.round(v * 100)}%` : `${v}`) },
    name: measure === 'missRate' ? '' : 'ms',
    nameTextStyle: { color: t.muted },
    max: measure === 'missRate' ? 1 : undefined,
  };
}

/** Horizontal ranked bars, one series. */
function hbarOption(t: ChartTheme, items: { id: string; name: string; value: number; note?: string }[], measure: Measure) {
  return {
    ...baseOption(t),
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      ...(baseOption(t).tooltip as object),
      trigger: 'item',
      formatter: (p: { data: { value: number; name: string; note?: string } }) =>
        `<strong>${fmt(measure, p.data.value)}</strong><br/>${escapeHtml(p.data.name)}${p.data.note ? `<br/><span style="opacity:.7">${escapeHtml(p.data.note)}</span>` : ''}`,
    },
    xAxis: valueAxis(t, measure),
    yAxis: {
      type: 'category',
      inverse: true,
      data: items.map((i) => i.name),
      ...axisStyle(t),
      splitLine: { show: false },
      axisLabel: { color: t.text, fontSize: 12 },
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 18,
        itemStyle: { color: t.series, borderRadius: [0, 4, 4, 0] },
        emphasis: { itemStyle: { opacity: 0.8 } },
        label: { show: true, position: 'right', color: t.muted, fontSize: 12, formatter: (p: { value: number }) => fmt(measure, p.value) },
        data: items.map((i) => ({ id: i.id, name: i.name, value: i.value, note: i.note })),
      },
    ],
  };
}

function FingerChart({ theme, fingers, measure, onSelect }: { theme: ChartTheme; fingers: ReturnType<typeof fingerSummaries>; measure: Measure; onSelect: (f: string) => void }) {
  const items = fingers
    .filter((f) => !Number.isNaN(f.stats[measure]))
    .map((f) => ({ id: f.finger, name: fingerLabel(f.finger), value: f.stats[measure], note: `${f.stats.n} attempts · ${f.bindings.length} bindings` }));
  const option = useMemo(() => hbarOption(theme, items, measure), [theme, JSON.stringify(items), measure]);
  return <EChart option={option} height={Math.max(120, items.length * 34 + 40)} label="Measure per finger" onClick={onSelect} />;
}

function FingerBindingsChart({ theme, list, measure, onSelect }: { theme: ChartTheme; list: FingerBinding[]; measure: Measure; onSelect: (id: string) => void }) {
  const ranked = rankBindings(list, measure).filter((fb) => fb.stats.timed >= MIN_TIMED);
  const unranked = list.length - ranked.length;
  const items = ranked.map((fb) => ({
    id: fb.stats.id,
    name: keysOf(fb.stats.binding),
    value: fb.stats[measure],
    note: `${bindingName(fb.stats.binding)} · ${fb.role === 'modifier' ? `holds ${comboLabel([fb.code])}` : 'presses the key'} · ${fb.stats.n} attempts`,
  }));
  const option = useMemo(() => hbarOption(theme, items, measure), [theme, JSON.stringify(items), measure]);
  return (
    <>
      {items.length > 0 && <EChart option={option} height={items.length * 28 + 40} label="Bindings for this finger, best first" onClick={onSelect} />}
      {unranked > 0 && <p className="muted small">{unranked} binding(s) have fewer than {MIN_TIMED} timed attempts and are not ranked yet.</p>}
    </>
  );
}

/** Interpolate the sequential ramp (CSS tokens) at 0..1. */
function seqColor(t: ChartTheme, x: number): string {
  const stops = t.seq.map((h) => parseInt(h.replace('#', ''), 16));
  const pos = Math.max(0, Math.min(1, x)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(pos));
  const f = pos - i;
  const ch = (n: number, s: number) => (n >> s) & 255;
  const mix = (s: number) => Math.round(ch(stops[i], s) + (ch(stops[i + 1], s) - ch(stops[i], s)) * f);
  return `#${[16, 8, 0].map((s) => mix(s).toString(16).padStart(2, '0')).join('')}`;
}

function KeyGridChart({ theme, set, measure, onSelect }: { theme: ChartTheme; set: ReturnType<typeof keyGrid>; measure: Measure; onSelect: (id: string) => void }) {
  const values = set.cells.map((c) => c.stats[measure]).filter((v) => !Number.isNaN(v));
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 1;
  const at = (row: number, col: number) => set.cells.find((c) => c.row === row && c.col === col);
  return (
    <>
      <div className="table-scroll">
        <table className="heat">
          <thead>
            <tr>
              <th />
              {set.cols.map((c) => (
                <th key={`${c.code}-${c.finger}`} scope="col">
                  <div className="heat-key">{c.label}</div>
                  <div className="muted heat-finger">{fingerLabel(c.finger).replace('Left ', 'L ').replace('Right ', 'R ')}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {set.rows.map((r, ri) => (
              <tr key={r || 'none'}>
                <th scope="row">{r || 'no modifier'}</th>
                {set.cols.map((_c, ci) => {
                  const cell = at(ri, ci);
                  if (!cell) return <td key={ci} className="heat-empty" />;
                  const v = cell.stats[measure];
                  const has = cell.stats.timed > 0 && !Number.isNaN(v);
                  const bg = has ? seqColor(theme, hi > lo ? (v - lo) / (hi - lo) : 0.5) : undefined;
                  const name = `${bindingName(cell.stats.binding)} (${keysOf(cell.stats.binding)})`;
                  return (
                    <td key={ci} className="heat-cell">
                      <button
                        style={bg ? { background: bg, color: inkOn(bg) } : undefined}
                        className={has ? '' : 'no-data'}
                        onClick={() => onSelect(cell.stats.id)}
                        title={`${name}: ${has ? fmt(measure, v) : 'no data yet'}, ${cell.stats.n} attempts`}
                        aria-label={`${name}: ${has ? fmt(measure, v) : 'no data yet'}`}
                      >
                        {has ? (measure === 'missRate' ? `${Math.round(v * 100)}%` : Math.round(v)) : '–'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {values.length > 0 && (
        <div className="scale-legend">
          <span>{fmt(measure, lo)}</span>
          <span className="scale-bar" style={{ background: `linear-gradient(to right, ${theme.seq.join(', ')})` }} />
          <span>{fmt(measure, hi)}</span>
          <span className="muted">{measure === 'missRate' ? '(more misclicks toward the right end of the scale)' : '(slower toward the right end of the scale)'}</span>
        </div>
      )}
    </>
  );
}

function WeakSpots({ list, onSelect }: { list: BindingStats[]; onSelect: (id: string) => void }) {
  return (
    <section className="card">
      <h2>Weak spots</h2>
      <p className="muted small">
        Ranked by median time plus the misclick rate × {MISS_PENALTY_MS / 1000} s, so slow and error-prone bindings both rise.
        Bindings need {MIN_TIMED} timed attempts to be ranked.
      </p>
      {list.length === 0 ? (
        <p className="muted">Not enough data yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="summary">
            <thead>
              <tr>
                <th>#</th>
                <th>Binding</th>
                <th>Keys and fingers</th>
                <th className="num">Median</th>
                <th className="num">Misclick rate</th>
                <th className="num">Score</th>
              </tr>
            </thead>
            <tbody>
              {list.map((b, i) => (
                <tr key={b.id} className="clickable" onClick={() => onSelect(b.id)}>
                  <td>{i + 1}</td>
                  <td>{bindingName(b.binding)}</td>
                  <td>{b.binding.keys.map((k) => `${comboLabel([k.code])} (${k.finger})`).join(' + ')}</td>
                  <td className="num">{ms(b.median)}</td>
                  <td className="num">{pct(b.missRate)}</td>
                  <td className="num">{Math.round(b.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TrendCard({ theme, set, profile, measure, fingers }: { theme: ChartTheme; set: ReturnType<typeof collectSamples>; profile: Profile; measure: Measure; fingers: FingerId[] }) {
  const [scope, setScope] = useState('all');
  const include = useMemo(() => {
    if (scope === 'all') return () => true;
    if (scope.startsWith('f:')) {
      const f = scope.slice(2);
      const ids = new Set(profile.bindings.filter((b) => b.keys.some((k) => `${k.hand ?? profile.defaultHand}.${k.finger}` === f)).map((b) => b.id));
      return (a: { b: string }) => ids.has(a.b);
    }
    const id = scope.slice(2);
    return (a: { b: string }) => a.b === id;
  }, [scope, profile]);
  const points = trend(set, include);
  return (
    <ChartCard
      title="Over time"
      subtitle={
        <span className="inline-control">
          One point per session for{' '}
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">all bindings</option>
            <optgroup label="Finger">
              {fingers.map((f) => <option key={f} value={`f:${f}`}>{fingerLabel(f)}</option>)}
            </optgroup>
            <optgroup label="Binding">
              {profile.bindings.map((b) => <option key={b.id} value={`b:${b.id}`}>{bindingName(b)} ({keysOf(b)})</option>)}
            </optgroup>
          </select>
        </span>
      }
      chart={
        points.length < 2 ? (
          <p className="muted">Trends need at least two sessions with data for this selection.</p>
        ) : (
          <TrendChart theme={theme} points={points} measure={measure} />
        )
      }
      table={
        <table className="summary">
          <thead>
            <tr>
              <th>Session</th>
              <th className="num">Attempts</th>
              <th className="num">Median</th>
              <th className="num">p90</th>
              <th className="num">Misclick rate</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.session}>
                <td>{new Date(p.startedAt).toLocaleString()}</td>
                <td className="num">{p.stats.n}</td>
                <td className="num">{ms(p.stats.median)}</td>
                <td className="num">{ms(p.stats.p90)}</td>
                <td className="num">{pct(p.stats.missRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}

function TrendChart({ theme, points, measure }: { theme: ChartTheme; points: ReturnType<typeof trend>; measure: Measure }) {
  const option = useMemo(
    () => ({
      ...baseOption(theme),
      grid: { left: 8, right: 24, top: 24, bottom: 8, containLabel: true },
      tooltip: {
        ...(baseOption(theme).tooltip as object),
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: theme.axis, width: 1 } },
        formatter: (ps: { dataIndex: number }[]) => {
          const p = points[ps[0].dataIndex];
          return `<strong>${fmt(measure, p.stats[measure])}</strong><br/>${new Date(p.startedAt).toLocaleString()}<br/><span style="opacity:.7">${p.stats.n} attempts</span>`;
        },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: points.map((p) => new Date(p.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
        ...axisStyle(theme),
        splitLine: { show: false },
      },
      yAxis: { ...valueAxis(theme, measure), scale: measure !== 'missRate' },
      series: [
        {
          type: 'line',
          data: points.map((p) => p.stats[measure]),
          lineStyle: { width: 2, color: theme.series, cap: 'round', join: 'round' },
          itemStyle: { color: theme.series, borderColor: theme.surface, borderWidth: 2 },
          symbol: 'circle',
          symbolSize: 9,
          areaStyle: { color: theme.series, opacity: 0.1 },
        },
      ],
    }),
    [theme, points, measure],
  );
  return <EChart option={option} height={260} label="Trend per session" />;
}

function BindingDetail({ theme, stats, set, profile }: { theme: ChartTheme; stats: BindingStats; set: ReturnType<typeof collectSamples>; profile: Profile }) {
  const times = set.samples.filter((s) => s.attempt.b === stats.id && s.attempt.rt !== undefined).map((s) => s.attempt.rt!);
  const bins = histogram(times, 50);
  const option = useMemo(
    () => ({
      ...baseOption(theme),
      grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
      tooltip: {
        ...(baseOption(theme).tooltip as object),
        trigger: 'item',
        formatter: (p: { dataIndex: number }) => {
          const b = bins[p.dataIndex];
          return `<strong>${b.count} attempts</strong><br/>${b.from}–${b.to} ms`;
        },
      },
      xAxis: { type: 'category', data: bins.map((b) => `${b.from}`), ...axisStyle(theme), splitLine: { show: false }, name: 'ms', nameTextStyle: { color: theme.muted } },
      yAxis: { type: 'value', minInterval: 1, ...axisStyle(theme) },
      series: [{ type: 'bar', data: bins.map((b) => b.count), barMaxWidth: 24, barCategoryGap: 2, itemStyle: { color: theme.series, borderRadius: [4, 4, 0, 0] } }],
    }),
    [theme, bins],
  );
  return (
    <div className="detail-grid">
      <div>
        <p>
          <strong>{bindingName(stats.binding)}</strong>{' '}
          <span className="muted">
            {stats.binding.keys.map((k) => `${comboLabel([k.code])}: ${(k.hand ?? profile.defaultHand) === 'left' ? 'L' : 'R'} ${k.finger}`).join(' · ')}
          </span>
        </p>
        <div className="stats-row compact">
          <Tile label="Attempts" value={String(stats.n)} />
          <Tile label="Median" value={ms(stats.median)} />
          <Tile label="p90" value={ms(stats.p90)} />
          <Tile label="Misclick rate" value={pct(stats.missRate)} />
        </div>
        {bins.length > 0 ? (
          <>
            <h3 className="small-heading">Reaction times</h3>
            <EChart option={option} height={200} label="Reaction time distribution" />
          </>
        ) : (
          <p className="muted">No timed attempts yet.</p>
        )}
      </div>
      <div>
        <h3 className="small-heading">Pressed instead</h3>
        {stats.confusions.length === 0 ? (
          <p className="muted">No misclicks recorded.</p>
        ) : (
          <table className="summary">
            <thead>
              <tr><th>Wrong input</th><th className="num">Times</th></tr>
            </thead>
            <tbody>
              {stats.confusions.slice(0, 10).map((c) => (
                <tr key={c.label}><td>{c.label}</td><td className="num">{c.count}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
