import { useEffect, useState } from 'react';
import { DataPage } from './DataPage';
import { InputTestPage } from './InputTestPage';

const ROUTES = [
  { hash: '#/data', label: 'Data', render: () => <DataPage /> },
  { hash: '#/input-test', label: 'Input test', render: () => <InputTestPage /> },
];

function currentRoute() {
  return ROUTES.find((r) => r.hash === window.location.hash) ?? ROUTES[0];
}

export function App() {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <>
      <nav className="topbar">
        <span className="brand">keybind.trainer</span>
        {ROUTES.map((r) => (
          <a key={r.hash} href={r.hash} className={`nav-link ${r === route ? 'active' : ''}`}>
            {r.label}
          </a>
        ))}
      </nav>
      {route.render()}
    </>
  );
}
