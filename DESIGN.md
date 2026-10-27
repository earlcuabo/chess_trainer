# Design

## Decisions

Recorded from the owner's answers while designing the app.

- **2026-10-27 — Platform.** Practice happens on the owner's phone, so the app
  is an installable web page (progressive web app) rather than an App Store
  app, which would need a paid Apple developer account and a Mac. It can be
  wrapped as a store app later if wanted.
- **2026-10-27 — Hosting.** A separate public repository,
  `earlcuabo/chess_trainer`, served by GitHub Pages. It is kept out of the
  private `Trading_backtest` repository because it is unrelated to trading.
  This project's notes and task records live in this repository, not in
  `C:\Trading\.ai\`.
- **2026-10-27 — Content.** All named openings, learned easy-first and
  memorized progressively like Anki.
- **2026-10-27 — Depth.** Starts at 1 move and grows automatically after
  3 correct reviews in a row, up to 10 of the user's moves; both numbers are
  settings.
- **2026-10-27 — New cards per day.** No limit by default; adjustable.
- **2026-10-27 — Chess site.** The owner plays on Chess.com. That only matters
  for the later game-import feature, which can use Chess.com's public games
  API with just a username.

## Cards

`tools/build_openings.mjs` turns each row of the Lichess opening list
(`data/source/*.tsv`: ECO code, name, moves) into one card in
`data/openings.json`:

- `id` is the ECO code plus the line in UCI, so progress survives renames.
- `side` is the side that plays the line's last move. Depth 1 therefore always
  tests the move that reaches the named opening, and "defense" lines can be
  practiced from White's side when White moves last.
- `tier` orders new cards: 1 = the shortest entry of each name in
  `CORE_NAMES`; 2 = other entries in those families without a sub-variation
  (no comma in the name); 3 = everything else. Within a tier, shorter lines
  come first, then larger families.
- `alt` lists other last moves that reach an opening with the same name from
  the same position (for example, Queen's Pawn Game after 1.d4 is reached by
  1...d5 or 1...d6). Either move counts as correct on the last move only.

## Drill

`src/drill.js`: with depth *d*, the user plays the last *d* of their moves;
every move before the first of those, and every opponent move after it, is
played automatically. A wrong move is retried once, then the answer is shown;
any wrong move fails the card. On a card's first showing, and the first
showing after its depth grows, the new move is shown with an arrow and a
mistake on it does not count.

## Scheduling

`src/srs.js` follows Anki's classic SM-2:

- New and learning cards: steps of 1 and 10 minutes. Good on a new card goes
  to the 10-minute step; graduating gives 1 day, or 4 days with Easy.
- Review: Good multiplies the interval by ease (starting at 2.5); Easy also
  multiplies by 1.3 and raises ease by 0.15. Again lowers ease by 0.2
  (minimum 1.3) and relearns with a 10-minute step, then 1 day.
- Depth grows when a card passes `promoteAfter` reviews in a row; the card
  then goes back through the learning steps at the new depth.
- Review days start at 4am local time.

`src/queue.js` picks the next card: due learning cards, then due reviews,
then new cards in deck order (within the daily limit if one is set), then
learning cards due within 20 minutes.

## Storage

Progress and settings are in `localStorage` (`chess_trainer.v1`). Export and
import use a JSON backup file. On iOS, a home-screen app has its own storage,
separate from Safari tabs.

## Later

- "Name this opening" multiple-choice cards.
- Continuing popular openings past their named moves into main-line theory.
- Stockfish in the browser, to tell a playable move outside the line from a
  mistake.
- Importing the owner's Chess.com games to show where they left known lines.
- Personal repertoire decks from PGN files or Lichess studies.
