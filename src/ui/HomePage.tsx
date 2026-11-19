import { useStorage } from './storageContext';

export function HomePage() {
  const { data } = useStorage();
  const hasProfile = !!data?.profiles.some((p) => p.profile);

  return (
    <main tabIndex={-1} className="page home">
      <section className="home-hero">
        <div>
          <h1>Practice your keybinds. Find the slow ones.</h1>
          <p className="home-lead">
            You tell it which finger presses which key. It throws your binds at you in random order, times every press and
            notes every miss. Afterwards you can see which binds your fingers handle well, and which ones they don't.
          </p>
          <div className="row-actions">
            {hasProfile ? (
              <a className="button big-link" href="#/train">Start training</a>
            ) : (
              <a className="button big-link" href="#/profile/new">Set up your keys</a>
            )}
            <a className="button secondary big-link" href="#/data">{hasProfile ? 'Your profiles' : 'Or start from the WoW example'}</a>
          </div>
        </div>
        <div className="home-example" aria-hidden="true">
          <div className="keycaps">
            <div className="keycap-wrap">
              <div className="keycap">
                <span className="cap">Ctrl</span>
                <span className="finger">L pinky</span>
              </div>
            </div>
            <div className="keycap-wrap">
              <span className="plus">+</span>
              <div className="keycap">
                <span className="cap">1</span>
                <span className="finger">L index</span>
              </div>
            </div>
          </div>
          <p className="feedback correct">✓ 412 ms</p>
        </div>
      </section>

      <section className="card home-steps">
        <h2>How it works</h2>
        <ol>
          <li>
            <strong>Add your keys.</strong> Make a profile, hit Record and press the combos you want to practice. Then pick a
            finger for each key. Ctrl + 1 can be your pinky on Ctrl and your index on 1.
          </li>
          <li>
            <strong>Train.</strong> Choose 5 minutes, or 20, or whatever you like. Combos come up one at a time, in random
            order. Press them as fast as you can without fumbling.
          </li>
          <li>
            <strong>Check the numbers.</strong> Diagnostics breaks it down per finger and per key. Maybe your index is quick on
            1 but slow on 2, or Alt + anything trips you up. Handy if you're deciding what to rebind.
          </li>
          <li>
            <strong>Work on the weak spots.</strong> Weak-spot mode brings up the slow and error-prone binds more often. You can
            also drill just the worst eight.
          </li>
        </ol>
      </section>

      <section className="home-grid">
        <div className="card">
          <h2>Your files, your machine</h2>
          <p>
            Profiles and results are plain YAML files in a folder you choose. Open them in any text editor, back them up,
            fix something by hand. Nothing gets uploaded anywhere.
          </p>
        </div>
        <div className="card">
          <h2>More than one setup</h2>
          <p>
            Two keyboards, or different binds per game? Make a profile for each. Every profile keeps its own stats and weak
            spots.
          </p>
        </div>
        <div className="card">
          <h2>Before you start</h2>
          <p>
            Use Chrome or Edge. On a new keyboard, run the <a href="#/input-test">input test</a> once to make sure your
            browser lets every combo through.
          </p>
        </div>
      </section>

      <p className="muted small home-foot">
        Made for an Azeron Cyborg 2 and WoW action bars, but any keyboard works. Source on{' '}
        <a href="https://github.com/dalruby/keybind.trainer">GitHub</a>.
      </p>
    </main>
  );
}
