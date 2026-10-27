# Chess Opening Trainer

Learn chess openings like puzzles, with Anki-style spaced repetition. It is a
web page that installs like an app on a phone and works offline.

## Using it on an iPhone

1. Open the site in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Always open it from the home-screen icon. iOS keeps a home-screen app's
   progress separate from Safari's, so progress made in a Safari tab does not
   carry over.
4. Use **Settings → Export progress** now and then to save a backup file
   (for example to Files or iCloud Drive). **Import progress** restores it.

## How practice works

- Every named opening in the Lichess opening list (about 3,900 lines) is a
  card. You play the side that makes the line's last move.
- **Depth** is how many of your own moves you have to find, counted from the
  end of the line. A card starts at depth 1, so you only find the move that
  reaches the opening, and the app plays the earlier moves for you. After 3
  correct reviews in a row, the card grows by one move, until you play the
  whole line from move 1.
- New cards come easy-first: about 36 core openings, then the main variations
  of those openings, then everything else, shorter lines first.
- A wrong move is taken back, the right move is shown with an arrow for a
  second and then played for you, and the line carries on. Any wrong move
  fails the card, and it comes back in 10 minutes.
- Scheduling follows Anki's classic SM-2: learning steps of 1 and 10 minutes,
  then days that grow with each correct review. There are no buttons to tap:
  a correct line counts as Good, a missed one as Again, and the next card
  follows on its own.
  Days roll over at 4am.
- Settings: new cards per day (no limit by default), maximum depth (10),
  correct reviews before depth grows (3), White/Black/both, and move speed.

## Free play

Switch to **Free play** at the top. It is not scheduled and does not affect
your Learn cards.

- You get a real opening position a few moves in (6-14 half-moves, with at
  least two knights or bishops developed) and find Stockfish's best move.
- The best move, or any move within 0.20 pawns of it, counts as correct; you
  are also shown the engine's top choice and both scores.
- The engine then replies and you find the best move again, for up to
  3 moves. After a "good" move the position continues from the engine's top
  choice. After a miss, play the shown best move to continue.
- Positions you have not seen come first, then ones you have never solved.
  Your score, streak and recent misses are under **Progress**.

## Development

There is no build step for the page itself; it is plain HTML, CSS and
JavaScript modules.

- Rebuild the deck after updating `data/source/*.tsv`:
  `node tools/build_openings.mjs`
- Run the tests: `node --test "tests/*.test.mjs"`
- Serve locally: `python -m http.server 8790 --bind 127.0.0.1` from this
  folder, then open `http://127.0.0.1:8790/`.
- Rebuild the free play positions (needs Stockfish, which is not stored in
  this repository; pc2 keeps it under
  `%LOCALAPPDATA%\chess_trainer_tools\`):
  `node tools/build_freeplay.mjs --engine <path to stockfish.exe>`.
  It uses one thread per engine at the lowest CPU priority, resumes from its
  cache if interrupted, and prints progress every minute.
- Rebuild the icons from `tools/icon.html`: `tools/make_icons.ps1` (uses
  headless Microsoft Edge).
- `sw.js` caches the app for offline use. When adding a file the page loads,
  add it to the `SHELL` list in `sw.js`.

See `DESIGN.md` for the design and the decisions behind it.

## Credits and licenses

- Opening names and lines: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings),
  CC0 1.0 (`data/source/COPYING.txt`).
- Board: [chessground](https://github.com/lichess-org/chessground) 9.2.1, GPL-3.0
  (`vendor/chessground/LICENSE`), including the cburnett piece set.
- Free play analysis: [Stockfish](https://stockfishchess.org/), GPL-3.0.
  Only its results are stored here (`data/freeplay.json`).
- Move rules: [chess.js](https://github.com/jhlywa/chess.js) 1.4.0, BSD-2-Clause
  (`vendor/chess.js/LICENSE`).
- This app is licensed GPL-3.0-or-later (`LICENSE`), as chessground requires.
