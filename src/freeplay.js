// Free play: find the engine's best move in opening positions, for a few
// moves in a row. Not scheduled; results only feed a score and a miss list.
//
// A puzzle (see tools/build_freeplay.mjs) has start moves and steps; each
// step lists the engine's top moves as [san, score] with the score in
// centipawns for the side to move (mates are +/-(MATE - n)).

export const ACCEPT_CP = 20; // a move this close to the best counts as correct
export const MATE = 30000;
export const RECENT_LIMIT = 30;

export function sideToMove(puzzle) {
  return puzzle.moves.split(' ').length % 2 === 0 ? 'w' : 'b';
}

// "+0.35", "-1.20", "#3" (you mate in 3) or "-#2" (you are mated in 2).
export function formatScore(score) {
  if (score == null) return '';
  if (Math.abs(score) > MATE - 1000) {
    const n = MATE - Math.abs(score);
    return score > 0 ? `#${n}` : `-#${n}`;
  }
  const pawns = (score / 100).toFixed(2);
  return score > 0 ? `+${pawns}` : pawns === '-0.00' ? '0.00' : pawns;
}

export class FreePlay {
  constructor(puzzle) {
    this.puzzle = puzzle;
    this.side = sideToMove(puzzle);
    this.step = 0;
    this.results = []; // per step: { verdict, played, score, best, bestScore }
  }

  get current() {
    return this.puzzle.steps[this.step];
  }

  get best() {
    return this.current.top[0];
  }

  get done() {
    return this.step >= this.puzzle.steps.length;
  }

  get solved() {
    return this.results.every((result) => result.verdict !== 'miss');
  }

  get missed() {
    return this.results[this.step] !== undefined;
  }

  // Judges a move in SAN. The first try at a step is graded; after a miss
  // only the best move continues. Returns { verdict, ...details } where
  // verdict is 'best' | 'good' | 'miss', or 'continue' / 'wrong' after a miss.
  submit(san) {
    const [bestSan, bestScore] = this.best;
    if (this.missed) {
      if (san !== bestSan) return { verdict: 'wrong', best: bestSan, bestScore };
      this.step += 1;
      return { verdict: 'continue', best: bestSan, bestScore };
    }
    const entry = this.current.top.find(([move]) => move === san);
    const score = entry ? entry[1] : null;
    let verdict = 'miss';
    if (san === bestSan) verdict = 'best';
    else if (entry && bestScore - score <= ACCEPT_CP) verdict = 'good';
    const result = { verdict, played: san, score, best: bestSan, bestScore, ranked: Boolean(entry) };
    this.results[this.step] = result;
    if (verdict !== 'miss') this.step += 1;
    return result;
  }

  // The opponent's reply after the step just completed, or null when the
  // puzzle is over.
  replyAfter(stepIndex) {
    return stepIndex < this.puzzle.steps.length - 1 ? this.puzzle.steps[stepIndex].reply ?? null : null;
  }
}

export function emptyFreeStats() {
  return { attempted: 0, solved: 0, streak: 0, bestStreak: 0, seen: {}, recent: [] };
}

export function normalizeFreeStats(stats) {
  if (!stats || typeof stats !== 'object') return emptyFreeStats();
  const base = emptyFreeStats();
  return {
    attempted: Number(stats.attempted) || 0,
    solved: Number(stats.solved) || 0,
    streak: Number(stats.streak) || 0,
    bestStreak: Number(stats.bestStreak) || 0,
    seen: stats.seen && typeof stats.seen === 'object' ? stats.seen : base.seen,
    recent: Array.isArray(stats.recent) ? stats.recent.slice(0, RECENT_LIMIT) : base.recent,
  };
}

export function recordFreePlay(stats, game, now) {
  const { puzzle } = game;
  const solved = game.solved;
  const previous = stats.seen[puzzle.id] ?? { tries: 0, solved: 0 };
  const streak = solved ? stats.streak + 1 : 0;
  const misses = game.results
    .map((result, step) => ({ ...result, step }))
    .filter((result) => result.verdict === 'miss')
    .map((result) => ({ id: puzzle.id, name: puzzle.name, step: result.step, played: result.played, best: result.best, at: now }));
  return {
    attempted: stats.attempted + 1,
    solved: stats.solved + (solved ? 1 : 0),
    streak,
    bestStreak: Math.max(stats.bestStreak, streak),
    seen: { ...stats.seen, [puzzle.id]: { tries: previous.tries + 1, solved: previous.solved + (solved ? 1 : 0), last: now } },
    recent: [...misses, ...stats.recent].slice(0, RECENT_LIMIT),
  };
}

// Picks a random puzzle for the side setting: unseen first, then ones never
// solved, then any. `random` returns a number in [0, 1).
export function pickPuzzle(puzzles, stats, side, random = Math.random, skipId = null) {
  const pool = puzzles.filter((puzzle) => puzzle.id !== skipId && (side === 'both' || sideToMove(puzzle) === side));
  if (!pool.length) return null;
  const unseen = pool.filter((puzzle) => !stats.seen[puzzle.id]);
  const unsolved = pool.filter((puzzle) => stats.seen[puzzle.id] && !stats.seen[puzzle.id].solved);
  const choices = unseen.length ? unseen : unsolved.length ? unsolved : pool;
  return choices[Math.floor(random() * choices.length)];
}
