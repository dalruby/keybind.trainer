import { InputTestPage } from './InputTestPage';

// Milestone 1: the app is just the input test page. Routing comes with the
// profile editor in milestone 3.
export function App() {
  return (
    <>
      <nav className="topbar">
        <span className="brand">keybind.trainer</span>
        <span className="muted small">milestone 1 · input test</span>
      </nav>
      <InputTestPage />
    </>
  );
}
