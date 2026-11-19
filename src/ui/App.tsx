import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { DataPage } from './DataPage';
import { HomePage } from './HomePage';
import { InputTestPage } from './InputTestPage';
import { mayLeave, parseHash } from './nav';
import { ProfileEditor } from './ProfileEditor';
import { StorageProvider } from './storageContext';
import { TrainPage } from './TrainPage';

// Charts are heavy; load them only when the Diagnostics page is opened.
const DiagnosticsPage = lazy(() => import('./DiagnosticsPage').then((m) => ({ default: m.DiagnosticsPage })));

const NAV = [
  { hash: '#/train', label: 'Train', section: 'train' },
  { hash: '#/stats', label: 'Diagnostics', section: 'stats' },
  { hash: '#/data', label: 'Data', section: 'data' },
  { hash: '#/input-test', label: 'Input test', section: 'input-test' },
];

function renderRoute(hash: string) {
  const { parts, query } = parseHash(hash);
  if (parts.length === 0) return { section: 'home', element: <HomePage /> };
  if (parts[0] === 'data') return { section: 'data', element: <DataPage /> };
  if (parts[0] === 'input-test') return { section: 'input-test', element: <InputTestPage /> };
  if (parts[0] === 'stats') return { section: 'stats', element: <DiagnosticsPage profileId={parts[1]} /> };
  if (parts[0] === 'train') {
    const only = query.get('only')?.split(',').filter(Boolean);
    return { section: 'train', element: <TrainPage profileId={parts[1]} only={only} /> };
  }
  if (parts[0] === 'profile' && parts[1]) {
    const element =
      parts[1] === 'new' ? (
        <ProfileEditor copyFrom={query.get('from') ?? undefined} />
      ) : (
        <ProfileEditor editId={parts[1]} />
      );
    return { section: 'data', element };
  }
  return { section: 'home', element: <HomePage /> };
}

export function App() {
  const [hash, setHash] = useState(() => window.location.hash || '#/');
  const current = useRef(hash);

  useEffect(() => {
    const onHash = () => {
      const next = window.location.hash || '#/';
      if (next === current.current) return;
      if (!mayLeave()) {
        // Put the old address back without triggering another check.
        window.history.replaceState(null, '', current.current);
        return;
      }
      current.current = next;
      setHash(next);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const route = renderRoute(hash);
  return (
    <StorageProvider>
      <a className="skip-link" href="#main-content" onClick={(e) => { e.preventDefault(); document.querySelector<HTMLElement>('main')?.focus(); }}>
        Skip to content
      </a>
      <nav className="topbar">
        <a href="#/" className={`brand ${route.section === 'home' ? 'active' : ''}`} aria-label="keybind.trainer home" title="Home">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width="28" height="28" />
        </a>
        {NAV.map((r) => (
          <a key={r.hash} href={r.hash} className={`nav-link ${r.section === route.section ? 'active' : ''}`}>
            {r.label}
          </a>
        ))}
      </nav>
      {/* Keyed by address so each page starts fresh when navigated to. */}
      <div key={hash}>
        <Suspense fallback={<main tabIndex={-1} className="page"><p className="muted">Loading…</p></main>}>{route.element}</Suspense>
      </div>
    </StorageProvider>
  );
}
