// Converts a deck card's SAN moves into the move objects a Drill uses.
import { Chess } from '../vendor/chess.js/chess.js';

const toMove = (move) => ({ san: move.san, uci: move.from + move.to + (move.promotion ?? ''), from: move.from, to: move.to });

export function buildLine(card) {
  const chess = new Chess();
  return card.moves.split(' ').map((san) => toMove(chess.move(san)));
}

// UCI moves other than the card's own last move that also reach the named
// opening (see `alt` in tools/build_openings.mjs).
export function finalAlternatives(card, line) {
  if (!card.alt) return [];
  const chess = new Chess();
  line.slice(0, -1).forEach((move) => chess.move(move.san));
  return card.alt.map((san) => {
    const move = toMove(chess.move(san));
    chess.undo();
    return move.uci;
  });
}
