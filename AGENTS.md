# Chess trainer repository instructions

These instructions apply to all work under `C:\chess_trainer` on pc2
(`DESKTOP-TPCBPRG`).

## Records

- Read `DESIGN.md` before changing behavior. Its Decisions section records
  the owner's choices; do not re-propose one without materially new evidence,
  and add a dated entry when the owner makes or changes a decision.
- This project's notes live in this repository, not in `C:\Trading\.ai\`.
- Investigations and reviews are read-only: present findings and the
  proposed change, and wait for the owner's explicit yes before editing.

## Runtimes

- `python` and `node` on PATH are Windows Store stubs or missing. Use Codex's
  bundled runtimes:
  - Node 24: `C:\Users\Cuabo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`
  - Python 3.12: `C:\Users\Cuabo\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`
- Stockfish 19 for `tools/build_freeplay.mjs` is at
  `%LOCALAPPDATA%\chess_trainer_tools\stockfish_sf_19\stockfish\stockfish-windows-x86-64-universal.exe`.
  Keep it out of this repository. pc2 also runs the market recorder, so long
  analysis runs stay at low priority (the tool does this) and run after the
  market close, with up to 4 workers (pc2 has 4 cores). The 2026-10-27 full
  build took about 2 hours (Stockfish 19, 1.5M nodes, 3 steps, 2,105
  positions).
- There is no npm. Third-party code is vendored under `vendor/` with its
  license; do not load scripts from a CDN.

## Checks

- Run `node --test "tests/*.test.mjs"` before committing.
- `tests/deck.test.mjs` fails if `data/openings.json` is stale; rebuild it
  with `node tools/build_openings.mjs`.
- For UI changes, also load the page from a local server and play a card.
  Say which checks were run; unit tests are not a browser check.

## Git

- `origin` is the public GitHub repository `earlcuabo/chess_trainer`, branch
  `main`, published by GitHub Pages. Everything pushed is public: never
  commit credentials, personal data, or progress backups.
- Stage explicit paths, never `git add .` or `git add -A`.
- Commit validated changes and push to `origin`. Never force-push, delete
  remote branches, or change remotes without asking. Report the commit hash,
  checks run, and whether the push succeeded.
