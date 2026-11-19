# keybind.trainer

Practise keybindings per finger and see which fingers and keys are slow or error-prone.
Built for an Azeron Cyborg 2 with WoW action bars, but works with any keyboard.

Live: https://dalruby.github.io/keybind.trainer/ (use Chrome or Edge).
Design and decisions: [PLAN.md](PLAN.md).

## Using it

1. **Data**: choose a folder for your files (Chrome/Edge), or keep data in the browser only.
   Add a profile with **New profile**, or start from **Add WoW bars example**.
2. **Edit** the profile: click **Record bindings** and press each key combination you want to
   practise. Set the hand and finger for each key, or use **Fingers per key** to set a key's
   finger in every binding at once.
3. **Train**: pick a length (2, 5, 10, 20 minutes or custom) and press **Start**. Bindings come up
   in random order; press each as fast and accurately as you can.
   - Choose **Focus on weak spots** to see slow and error-prone bindings more often.
   - **Esc** pauses (unless a binding uses Esc), **Enter** or **Space** resumes.
     Switching windows also pauses.
   - Optional fullscreen: with Keyboard Lock (Chrome/Edge) even browser shortcuts reach the
     trainer; hold **Esc** to leave fullscreen.
4. **Diagnostics**: per finger, per key, weak spots and trends. Click any bar or cell for
   details, or **Train these** to practise the weak spots.

**Input test** checks that your browser passes key combinations through; run it once on a new
keyboard or computer.

## Files

Everything is plain YAML you can open and edit in any text editor:

```
<your folder>/
  profiles/<profile id>.yaml            bindings, with hand and finger per key
  sessions/<profile id>/<start>.yaml    one file per training session
```

The app keeps comments you add to profile files. Hand-edit mistakes are shown on the Data page
with the file and line number. **Export zip** / **Import zip** on the Data page make backups.

## Develop

```bash
npm install
npm run dev
```

Open http://localhost:5173 in Chrome or Edge.

- `npm test` – unit tests (Vitest)
- `npm run build` – type-check and build to `dist/`

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`
(repo Settings → Pages → Source: **GitHub Actions**).

| Folder | What's in it |
|---|---|
| `src/input/` | keyboard capture, key labels, AltGr and bounce handling, combo recorder |
| `src/model/` | data types, YAML parsing/validation/saving, fingerprints, templates |
| `src/storage/` | folder, browser and zip storage |
| `src/session/` | scheduler, matcher and session engine |
| `src/stats/` | statistics, diagnostics and weak-spot weights |
| `src/ui/` | pages and components |
