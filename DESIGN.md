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
- **2026-10-27 — Free play.** A separate, unscheduled mode: find
  Stockfish's best move in opening positions after a few pieces are developed.
  A move within 0.20 pawns of the best counts as correct (the owner chose this
  over "exact top move only"). Each position continues for up to 3 of the
  user's moves with the engine replying (chosen over one move per position).
- **2026-10-27 — More Free play positions.** At the owner's request, added
  positions partway through longer named lines (still 6-14 half-moves in),
  growing Free play from 2,105 to 4,498 positions. Going up to 20 half-moves
  (about 5,741) was offered as a later option.
- **2026-10-27 — Free play engine.** Stockfish's answers are calculated ahead
  of time on pc2 and shipped as data, rather than running Stockfish on the
  phone: instant, stronger, smaller download, works offline. Stockfish itself
  is kept on pc2 only, not in this repository.
- **2026-10-27 — No grade buttons.** A correct line is graded Good
  automatically and the next card follows after a moment; the Good/Easy
  buttons were removed at the owner's request. A missed line is graded Again.
- **2026-10-27 — Misses in Learn.** No second try and no confirmation: the
  first wrong move shows the right move for about a second, the app plays it,
  and the line continues; the next card follows automatically.

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
played automatically. A wrong move reveals the answer, which the app plays
for the user (`playExpected`); any wrong move fails the card. On a card's first showing, and the first
showing after its depth grows, the new move is shown with an arrow and a
mistake on it does not count.

## Scheduling

`src/srs.js` follows Anki's classic SM-2:

- Grading is automatic: Good for a line with no misses, Again otherwise.
  `grade()` still supports Easy, but the app no longer offers it.
- New and learning cards: steps of 1 and 10 minutes. Good on a new card goes
  to the 10-minute step; graduating gives 1 day (4 days with Easy).
- Review: Good multiplies the interval by ease (starting at 2.5); Easy would
  also multiply by 1.3 and raise ease by 0.15. Again lowers ease by 0.2
  (minimum 1.3) and relearns with a 10-minute step, then 1 day.
- Depth grows when a card passes `promoteAfter` reviews in a row; the card
  then goes back through the learning steps at the new depth.
- Review days start at 4am local time.

`src/queue.js` picks the next card: due learning cards, then due reviews,
then new cards in deck order (within the daily limit if one is set), then
learning cards due within 20 minutes.

## Free play

`tools/build_freeplay.mjs` picks positions 6-14 half-moves into deck lines
with at least two minor pieces developed, one per unique position (piece
placement, side to move, castling, en passant): first the end positions of
lines that long (2,105, in deck order), then positions partway through longer
lines (2,393 more, named after the latest named opening on their path), for
4,498 in all. Keeping the end positions first keeps their order and ids
stable when positions are added. For each it
runs Stockfish with MultiPV 8 at a fixed node count, one thread and a cleared
hash, so results are reproducible. A puzzle has up to 3 steps: the top 8 moves
with scores (centipawns for the side to move; mate in n is 30000 - n), then
the reply from the best move's principal variation, then the next step.

`src/freeplay.js` judges the first try at each step: the top move is "best",
another listed move within 20 centipawns is "good", anything else is a miss,
after which only the top move continues. A puzzle is solved when no step was
missed. Puzzles are picked at random among unseen ones, then never-solved
ones, then any, filtered by the side setting.

## Storage

Progress, settings and free play stats are in `localStorage`
(`chess_trainer.v1`). Export and import use a JSON backup file. On iOS, a home-screen app has its own storage,
separate from Safari tabs.

## Later

- "Name this opening" multiple-choice cards.
- Continuing popular openings past their named moves into main-line theory.
- Stockfish in the browser, to tell a playable move outside a Learn line
  from a mistake.
- Importing the owner's Chess.com games to show where they left known lines.
- Personal repertoire decks from PGN files or Lichess studies.
