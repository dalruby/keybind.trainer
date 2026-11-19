# keybind.trainer — Plan

A web app for learning keybindings: you practise a set of key combinations,
each key assigned to a specific finger of a specific hand, and get detailed
per-finger diagnostics. Built first for an Azeron Cyborg 2 with WoW action bars,
but not tied to it.

Status: milestones 1–4 done (input test, model + storage, profile editor, training session).

---

## 1. Decisions

| Topic | Decision |
|---|---|
| App type | Static web app (no backend), used in Chrome or Edge on Windows |
| Language / UI | TypeScript, React, Vite |
| Charts | ECharts |
| Storage | YAML files in a folder the user picks (File System Access API), plus a browser-storage mirror as backup; import/export as fallback |
| YAML library | `yaml` (keeps comments and gives line numbers for validation errors) |
| Tests | Vitest for timing, matching, scoring and statistics logic |
| Keyboard layout | US-International on Windows (Right Alt = AltGr); keys are stored as physical key codes (`KeyboardEvent.code`) |
| Hosting | GitHub Pages from `dalruby/keybind.trainer` (optional; also runs locally) |
| Out of scope (for now) | WASD/joystick training, gamepad mode, non-US layouts, recommendations |

### Why a web app works here
The Cyborg 2 sends ordinary keystrokes. A browser page can capture and suppress
the defaults of `Ctrl/Shift/Alt + 0–9`. Combos the browser keeps for itself
(`Ctrl+W`, `Ctrl+T`, `Alt+Tab`, …) aren't needed. If they ever are, the
Chromium fullscreen Keyboard Lock API covers them, and a Tauri wrapper is the
last resort. All keyboard input goes through one module (`src/input/`) so that
swap stays contained.

### Verified on Windows (milestone 1, Edge 157; ZSA Voyager and NuPhy Air96 V2, Azeron not yet available)
1. `Ctrl+1`…`Ctrl+9` stay on the tab: `preventDefault()` stops tab switching. ✅
2. Tapping `Alt` alone keeps focus. ✅
3. All 40 WoW bar combinations (0–9 × none/Ctrl/Shift/Alt) reach the page; timestamps have 0.1 ms resolution. ✅

So training works in a normal tab; fullscreen + Keyboard Lock stays an option, not a requirement. Re-run the input test page once the Azeron arrives.

Findings that shaped the input rules in section 4:
- The Windows layout is US-International, so Right Alt is **AltGr**: Windows sends a fake `ControlLeft` with it, and the browser reports Ctrl and Alt as *up* while AltGr is down. Right Alt is not usable as a regular Alt on this layout (switching Windows to the plain "US" layout would change that).
- One of the test keyboards produced a **switch bounce**: a key released and pressed again 0.3 ms later.

---

## 2. Concepts

- **Profile**: a named set of bindings, such as "Azeron – WoW". Every profile has its own sessions, diagnostics and weak spots.
- **Binding**: one thing to train, made of one or more keys pressed together (`Ctrl+1`).
- **Key assignment**: one key within a binding plus the **hand** and **finger** that presses it. Each key in a binding has exactly one finger, and different keys in one binding can use different fingers.
- **Finger identity** = `hand` (`left` | `right`) + `finger` (`thumb` | `index` | `middle` | `ring` | `pinky`). This gives 10 possible fingers. The same finger name on different hands is always counted separately.
- **Session**: one timed run over a profile, in **normal** mode (uniform random) or **weak-spot** mode (weighted random).
- **Attempt**: one prompt within a session. It records the time to the correct input and every wrong input before it.

### Left/right handling
- **Hands**: a profile sets a `defaultHand`, and each key may override it. A left-hand-only profile like the Azeron one never has to mention hands. A split keyboard profile sets `hand:` where needed.
- **Physical left/right keys**: modifiers have left and right variants (`ControlLeft` / `ControlRight`).
  - A binding may use the specific code (`ControlLeft`), meaning only that physical key counts.
  - Or it may use a generic name (`Control`, `Shift`, `Alt`), meaning either side counts.
  - The default for new bindings is the specific code, so diagnostics show which physical key was used.

---

## 3. Data format (YAML)

### Folder layout
```
<chosen folder>/
  profiles/
    azeron-wow.yaml
  sessions/
    azeron-wow/
      2026-11-19T20-15-03.yaml
```
- One file per profile and one file per session.
- File names come from the profile `id` and the session start time.
- Files can be edited by hand; the app re-reads them on load ("Reload files") and reports any validation error with its file name and line.
- A profile's `id` must match its file name, and a session's `profile` must match its folder.

### Where files live
- **Folder** (Chrome/Edge): the user picks a folder once; the browser remembers it but asks for permission again after a restart (one click on "Reconnect folder"). The folder is the source of truth.
- **Browser backup**: every write also goes to this browser's IndexedDB, and loading from the folder refreshes that copy. The backup never deletes files on its own, so picking an empty or different folder can't wipe it. When a folder is chosen and the browser holds files the folder doesn't, the app offers to copy them in.
- **No folder** (other browsers, or none chosen yet): data lives only in the browser store.
- **Export / import**: a zip with the same `profiles/` and `sessions/` layout. Imported files are validated first; existing files with different content are only replaced after confirmation.
- Saving from the app edits the existing file in place, so hand-written comments and formatting of unchanged parts survive. Comments attached to a binding move with it; comments on removed bindings go with them.

### Profile
```yaml
schema: 1
id: azeron-wow               # stable, used to link sessions
name: Azeron – WoW
device: Azeron Cyborg 2      # informational
defaultHand: left
bindings:
  - id: bar1-1               # stable id, never reused
    label: Bar 1 – slot 1    # optional
    keys:
      - { code: Digit1, finger: index }
  - id: bar2-1
    label: Bar 2 – slot 1
    keys:
      - { code: ControlLeft, finger: pinky }
      - { code: Digit1, finger: index }
  # split keyboard example:
  # - id: jump
  #   keys:
  #     - { code: Space, hand: right, finger: thumb }
```

Validation rules:
- Binding ids must be unique.
- Each binding needs at least one key.
- A binding can't list the same code twice.
- A binding can have at most one non-modifier key, which is the trigger key.
- No two bindings can have identical key sets.
- `finger` is required and `hand` falls back to `defaultHand`.

### Session
```yaml
schema: 1
profile: azeron-wow
mode: normal                 # normal | weak-spot
startedAt: 2026-11-19T20:15:03.120Z
durationPlanned: 300         # seconds
durationActual: 300.4
prompt: keys                 # keys | label | both
gapMs: 250
warmup: 0                    # leading attempts left out of statistics
bounces: 0
bindings:                    # snapshot of what was trained, so the profile can change later
  bar1-1: { fp: 3f9a1c, keys: [left.index:Digit1] }
  bar2-1: { fp: 81be04, keys: [left.pinky:ControlLeft, left.index:Digit1] }
attempts:                    # one compact line per attempt
  - { b: bar2-1, t: 1.204, rt: 612, miss: [{ k: [ShiftLeft, Digit1], at: 380 }] }
  - { b: bar1-1, t: 2.051, rt: 344 }
```
- `t`: time since session start, in seconds, when the prompt appeared.
- `rt`: time from prompt to correct input, in ms.
- `miss`: each wrong input, with the full set of keys held at that moment and when it happened.
- `fp`: a short hash of the binding's keys, hands and fingers. If the profile's binding changes later, old results for it are marked as an earlier version and kept out of current statistics, though they can still be viewed.

---

## 4. Input and scoring rules

- A binding is **satisfied** on the keydown of its trigger key when:
  - exactly the binding's modifiers are held, and
  - no other non-modifier key is held.
- A **misclick** is any non-repeat keydown that doesn't satisfy the binding. This includes:
  - the right digit with the wrong modifier,
  - a wrong digit,
  - the trigger pressed before the modifier.
  - Pressing a modifier on its own is not a miss.
- Auto-repeat events (`event.repeat`) are ignored.
- **Bounce**: a keydown of a key that was released less than 10 ms earlier is hardware bounce, not a press. It and its matching keyup are dropped, so a bouncing key counts as one press, timed at its first keydown. Dropped bounces are counted per session, since frequent bounce on one key may be worth knowing.
- **AltGr**: modifier state comes from the event flags, plus the browser's `AltGraph` state. While AltGr is down, `ControlLeft` and `AltRight` count as held even though the Ctrl/Alt flags say otherwise. AltGr + key never matches a binding without AltGr, so it counts as a misclick.
- **Timing**: `rt = event.timeStamp - promptShownAt`. `promptShownAt` is taken from the first animation frame after the prompt renders.
- After a correct input, the next prompt appears after a short configurable gap (default 250 ms). Keys still held from the previous binding are ignored until they're released.
- **Order**: random, with no binding twice in a row.
  - Normal mode: uniform.
  - Weak-spot mode: weighted by a score that combines median time and miss rate per binding over recent sessions, with a minimum weight so strong bindings still appear.
- **Session length**: presets of 2, 5, 10 and 20 minutes, or a custom length. It can be paused, and pauses aren't counted.
- The first few attempts can be marked as warm-up and excluded from statistics. This is off by default.

---

## 5. Diagnostics

Shown per session, and across all sessions of a profile with filters for date range and mode:

- **Per finger** (hand + finger): every binding that finger is involved in, ranked best to worst by median time, 90th-percentile time and miss rate.
- **Heatmap**: finger × key, colour by median time, with a toggle for miss rate.
- **Per binding**: time distribution, miss rate, and which wrong inputs it gets confused with.
- **Plain vs modifier**: the same digit with and without Ctrl/Shift/Alt, to show what the pinky costs.
- **Trends**: median time and miss rate per binding and per finger across sessions.
- **Weak spots**: the bottom N bindings, with a "Train these" button that starts a weak-spot session limited to them.

The app shows data only and makes no rebinding recommendations.

---

## 6. Project structure (proposed)

```
src/
  input/        keyboard capture, suppression, optional Keyboard Lock
  model/        types, YAML schema + validation, fingerprints
  storage/      folder access, browser-storage mirror, import/export
  session/      prompt scheduler, matcher, timing, recorder
  stats/        aggregation, weak-spot scoring
  ui/           pages: profiles, profile editor, train, results, diagnostics
tests/          Vitest specs for model, session, stats
```

---

## 7. Milestones

1. **Scaffold + input test page** ✅: Vite/React/TS setup and GitHub Pages deploy. The page shows the raw key events with `code`, modifiers and timestamps, and has the browser-shortcut checks from section 1. Verified on Windows with the Cyborg 2.
2. **Model + storage** ✅: YAML schema, validation, fingerprints, folder picker, browser-storage mirror, import/export. Unit tests. Data page lists profiles and shows validation errors.
3. **Profile editor** ✅:
   - Create, copy and edit profiles (name, id, device, default hand); renaming the id moves its sessions.
   - Add bindings by pressing them ("Record bindings"); duplicates and overlapping combos are refused.
   - Hand + finger per key in each binding, plus a "Fingers per key" table that sets a key's finger in every binding at once.
   - Modifiers can be "this side only" (`ControlLeft`) or "either side" (`Control`).
   - Reorder, relabel and remove bindings; warns when an edit restarts a binding's statistics.
   - "Fill with WoW bars 1–4" for an empty profile.
4. **Training session** ✅:
   - Setup: profile, length (2/5/10/20 min or custom), prompt shows keys / label / both, finger hints on or off, gap between prompts, warm-up attempts. Remembered in this browser.
   - 3-2-1 countdown, then random prompts with no immediate repeats; keycaps show the finger for each key.
   - Live feedback (reaction time or the wrong keys pressed), clock and progress bar.
   - Pause with the button or by switching windows; the interrupted prompt is dropped. End early (saves) or discard.
   - Saves the session YAML, then shows a summary: attempts, median time, share of clean attempts, misclicks, and each binding slowest first.
5. **Diagnostics**: the views from section 5.
6. **Weak-spot mode**: weighted scheduling and "train these".
7. **Polish**: optional fullscreen and Keyboard Lock mode, keyboard-only navigation, dark mode.
