import { useEffect, useRef, useState } from 'react';
import { DataPage } from './DataPage';
import { DiagnosticsPage } from './DiagnosticsPage';
import { InputTestPage } from './InputTestPage';
import { mayLeave, parseHash } from './nav';
import { ProfileEditor } from './ProfileEditor';
import { StorageProvider } from './storageContext';
import { TrainPage } from './TrainPage';

const NAV = [
  { hash: '#/train', label: 'Train', section: 'train' },
  { hash: '#/stats', label: 'Diagnostics', section: 'stats' },
  { hash: '#/data', label: 'Data', section: 'data' },
  { hash: '#/input-test', label: 'Input test', section: 'input-test' },
];

function renderRoute(hash: string) {
  const { parts, query } = parseHash(hash);
  if (parts[0] === 'input-test') return { section: 'input-test', element: <InputTestPage /> };
  if (parts[0] === 'stats') return { section: 'stats', element: <DiagnosticsPage profileId={parts[1]} /> };
  if (parts[0] === 'train') return { section: 'train', element: <TrainPage profileId={parts[1]} /> };
  if (parts[0] === 'profile' && parts[1]) {
    const element =
      parts[1] === 'new' ? (
        <ProfileEditor copyFrom={query.get('from') ?? undefined} />
      ) : (
        <ProfileEditor editId={parts[1]} />
      );
    return { section: 'data', element };
  }
  return { section: 'data', element: <DataPage /> };
}

export function App() {
  const [hash, setHash] = useState(() => window.location.hash || '#/data');
  const current = useRef(hash);

  useEffect(() => {
    const onHash = () => {
      const next = window.location.hash || '#/data';
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
      <nav className="topbar">
        <span className="brand">keybind.trainer</span>
        {NAV.map((r) => (
          <a key={r.hash} href={r.hash} className={`nav-link ${r.section === route.section ? 'active' : ''}`}>
            {r.label}
          </a>
        ))}
      </nav>
      {/* Keyed by address so each page starts fresh when navigated to. */}
      <div key={hash}>{route.element}</div>
    </StorageProvider>
  );
}
