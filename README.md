# keybind.trainer

Practise keybindings per finger and see which fingers and keys are slow or error-prone.
Built for an Azeron Cyborg 2, but works with any keyboard. See [PLAN.md](PLAN.md).

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173 in Chrome or Edge.

## Scripts

- `npm run dev` – dev server
- `npm test` – unit tests (Vitest)
- `npm run build` – type-check and build to `dist/`

## Deploy

Pushing to `main` builds and deploys to GitHub Pages via `.github/workflows/deploy.yml`.
One-time setup: in the repo's Settings → Pages, set Source to **GitHub Actions**.
