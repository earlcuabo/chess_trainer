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
- A wrong move is taken back and you get one more try; a second wrong move
  shows the answer with an arrow. Any wrong move fails the card, and it comes
  back in 10 minutes.
- Scheduling follows Anki's classic SM-2: learning steps of 1 and 10 minutes,
  then days that grow with each correct review. **Good** is chosen
  automatically after a correct line; tap **Easy** to push a card further out.
  Days roll over at 4am.
- Settings: new cards per day (no limit by default), maximum depth (10),
  correct reviews before depth grows (3), White/Black/both, and move speed.

## Development

There is no build step for the page itself; it is plain HTML, CSS and
JavaScript modules.

- Rebuild the deck after updating `data/source/*.tsv`:
  `node tools/build_openings.mjs`
- Run the tests: `node --test "tests/*.test.mjs"`
- Serve locally: `python -m http.server 8790 --bind 127.0.0.1` from this
  folder, then open `http://127.0.0.1:8790/`.
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
- Move rules: [chess.js](https://github.com/jhlywa/chess.js) 1.4.0, BSD-2-Clause
  (`vendor/chess.js/LICENSE`).
- This app is licensed GPL-3.0-or-later (`LICENSE`), as chessground requires.
