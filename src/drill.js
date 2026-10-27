// One attempt at a card. Moves before the tested section are played
// automatically; within it, the opponent's moves are played automatically
// and the user must find each of their own moves. A wrong move is taken back
// once; a second wrong move reveals the answer. Any wrong move fails the card.
//
// `line` is [{ san, uci }] for every half-move; `finalAlternatives` lists
// other UCI moves that also reach the named opening on the last move.

export const TRIES_BEFORE_REVEAL = 2;

export class Drill {
  constructor(line, side, depth, { finalAlternatives = [], hintPlies = [] } = {}) {
    this.line = line;
    this.side = side;
    this.userPlies = line.map((_, ply) => ply).filter((ply) => (ply % 2 === 0 ? 'w' : 'b') === side);
    if (!this.userPlies.length || this.userPlies.at(-1) !== line.length - 1) throw new Error('line must end on the user\'s move');
    this.depth = Math.max(1, Math.min(depth, this.userPlies.length));
    this.testedPlies = this.userPlies.slice(-this.depth);
    this.startPly = this.testedPlies[0];
    this.finalAlternatives = finalAlternatives;
    this.hintPlies = new Set(hintPlies);
    this.ply = 0;
    this.tries = 0;
    this.missedPlies = [];
  }

  get done() {
    return this.ply >= this.line.length;
  }

  get failed() {
    return this.missedPlies.length > 0;
  }

  isUserTurn() {
    return !this.done && this.ply >= this.startPly && this.ply % 2 === (this.side === 'w' ? 0 : 1);
  }

  // Next move the app plays by itself (setup or opponent), or null.
  nextAutoMove() {
    if (this.done || this.isUserTurn()) return null;
    return this.line[this.ply];
  }

  advanceAuto() {
    if (this.isUserTurn() || this.done) throw new Error('not an automatic move');
    this.ply += 1;
    this.tries = 0;
  }

  expected() {
    return this.line[this.ply];
  }

  shouldHint() {
    return this.isUserTurn() && this.hintPlies.has(this.ply);
  }

  // Returns { result: 'correct' | 'retry' | 'reveal', move }.
  submit(uci) {
    if (!this.isUserTurn()) throw new Error('not the user\'s turn');
    const expected = this.line[this.ply];
    const isFinal = this.ply === this.line.length - 1;
    if (uci === expected.uci || (isFinal && this.finalAlternatives.includes(uci))) {
      this.ply += 1;
      this.tries = 0;
      return { result: 'correct', move: expected, alternative: uci !== expected.uci };
    }
    this.tries += 1;
    if (!this.missedPlies.includes(this.ply) && !this.hintPlies.has(this.ply)) this.missedPlies.push(this.ply);
    return { result: this.tries >= TRIES_BEFORE_REVEAL ? 'reveal' : 'retry', move: expected };
  }

  // Move number label for a ply, e.g. "3." or "3...".
  static moveLabel(ply) {
    return `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'}`;
  }
}
