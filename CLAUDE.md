# Mabar — instructions for Claude Code

Browser party games: a laptop/TV hosts (`play.html`), phones are the controllers (`controller.html`), linked peer-to-peer over WebRTC (PeerJS). Plain static site: no framework, no bundler, no backend. Deployed as-is to GitHub Pages from the repo root.

Read first, depending on the task:
- [README.md](README.md) — pages, controls, networking, message format, how to add a game (user-facing; keep it accurate)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — script load order, hub ↔ game interface, rendering, asset loading
- [docs/ASSET_PIPELINE.md](docs/ASSET_PIPELINE.md) — Blender scripts → `.glb`, source vs game-ready assets
- [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) — concept, games, visual direction, open decisions
- [docs/DEVELOPMENT_LOG.md](docs/DEVELOPMENT_LOG.md) — milestones and known issues
- [knowledge/](knowledge/README.md) — verified technical findings

## Commands

```bash
npm install                         # dev tools only (http-server, gltf-transform)
npm run dev                         # http://localhost:8080  (landing) and /play.html (host)
npm run cert && npm run dev:https   # https://<lan-ip>:8443 — needed for phone motion sensors
BPY=python3.13 npm run assets       # rebuild assets/*.glb from art/*.py (needs `pip install bpy`)
```

There is no test suite, linter or build step for the code. `node --check <file>` catches syntax errors.

## Code conventions

- Classic `<script>` tags, no modules. Each file is an IIFE or registers onto a global: `MABAR`, `MabarGames` (js/common.js), `Kit3D` (js/kit3d.js), `MabarRacket` (js/games/racket.js), `THREE` (vendor bundle). **Script order in the HTML matters.**
- A game is one file in `js/games/` calling `MabarGames.register({...})`, plus a `<script>` tag in `play.html` before `js/screen.js`. Racket sports are configs passed to `MabarRacket.define`.
- 2-space indent, single quotes, semicolons, `'use strict'` inside IIFEs. Python (art/) uses 4 spaces.
- Comments explain *why* or describe the gameplay rule; keep that density, not more.
- World units are meters, three.js Y-up (Blender Z-up, converted on glTF export).
- Paths are relative to the site root (`assets/menu.glb`, `vendor/…`), so the site works from any subpath on Pages. Never use leading `/`.

## Preserve what works

- Inspect the existing implementation before writing a replacement; extend `racket.js`, `kit3d.js` and the hub API rather than forking them.
- Keep the four HTML entry points and their URLs/query params (`?room=`, `?game=`, `?peer=`, `?relay=1`) stable: QR codes and shared links depend on them.
- Changing the phone ↔ host message format means bumping `MABAR.PREFIX` (`mabar-v1-`) so old controllers can't join.
- Don't swap the rendering engine (Three.js), networking (PeerJS) or hosting (GitHub Pages) without an explicit decision from the owner.

## Assets

- `assets/` is **game-ready runtime files only** (meshopt `.glb`, `img/*.jpg`). Everything in it ships to Pages.
- `assets/*.glb` are generated: edit `art/*.py` and rebuild, never hand-edit the `.glb`. Node and material names (`ch_tennis_armR`, `shirt`, `plat_tennis`, `k_stove`, …) are an API the JS looks up by name; renaming one breaks the game silently.
- `art/source/` (original FBX + textures) and `art/reference/` (concept art) are **gitignored, local-only**. Never move them into `assets/`, never delete or overwrite originals; write converted output elsewhere.
- `vendor/` is third-party (PeerJS, qrcode-generator, a custom Three.js bundle). Don't edit it; replace whole files and update versions in README.

## Testing expectations

After a change, at minimum: `node --check` the edited JS, serve the site and load every affected page with the browser console open (no errors, no 404s). For game changes, play it on `play.html` with the keyboard player (`WASD`, `Space`, `E`). Phone, motion and cross-network behaviour need real devices; if you couldn't test something, say so explicitly. Never report something as tested if it wasn't.

## Git and deployment

- Pushing `main` deploys to production (GitHub Pages). **Never push, deploy, or change repo/Pages settings without the owner's explicit approval.** Local commits are fine when asked.
- Don't commit `node_modules/`, `.cert/`, or anything under `art/source/` / `art/reference/`.
- `js/common.js` contains the Metered TURN credential URL; publishing it was an owner decision. Don't copy it into docs, logs or new files, and never add other secrets or private keys to the repo.

## Keeping docs current

1. Read the relevant doc before substantial changes; check the source agrees with it.
2. When architecture, workflows or key decisions change, update the doc in the same change. Source code wins over docs: fix the doc when they disagree.
3. Check for an existing doc before creating a new one; don't duplicate README content in docs/.
4. Put reusable, verified technical findings in `knowledge/` (see its README). Label anything unverified as an assumption or proposal.
5. `docs/DEVELOPMENT_LOG.md` records milestones, decisions and open issues, not every edit.
6. No secrets, credentials or keys in any doc.
