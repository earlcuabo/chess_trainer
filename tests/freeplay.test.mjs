import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildPuzzle, developedMinors, MULTIPV, parseInfoLines, parseScore, puzzleId, selectPositions, STEPS, UciEngine,
} from '../tools/build_freeplay.mjs';
import { Chess } from '../vendor/chess.js/chess.js';
import { ACCEPT_CP, emptyFreeStats, formatScore, FreePlay, pickPuzzle, recordFreePlay, sideToMove } from '../src/freeplay.js';

const puzzle = {
  id: 'p1',
  eco: 'C50',
  name: 'Italian Game',
  moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5',
  steps: [
    { top: [['c3', 40], ['O-O', 30], ['d3', 15], ['Nc3', 5]], reply: 'Nf6' },
    { top: [['d4', 50], ['d3', 45]], reply: 'exd4' },
    { top: [['cxd4', 60]] },
  ],
};

test('the side to move comes from the number of start moves', () => {
  assert.equal(sideToMove(puzzle), 'w');
  assert.equal(sideToMove({ moves: 'e4 e5 Nf3' }), 'b');
});

test('best and near-best moves pass; others miss and must then play the best move', () => {
  const game = new FreePlay(puzzle);
  assert.equal(game.submit('c3').verdict, 'best');
  assert.equal(game.replyAfter(0), 'Nf6');
  const good = game.submit('d3');
  assert.equal(good.verdict, 'good');
  assert.ok(good.bestScore - good.score <= ACCEPT_CP);
  const miss = game.submit('Qe2');
  assert.deepEqual([miss.verdict, miss.ranked, miss.score, miss.best], ['miss', false, null, 'cxd4']);
  assert.equal(game.submit('Bb3').verdict, 'wrong');
  assert.equal(game.submit('cxd4').verdict, 'continue');
  assert.ok(game.done);
  assert.equal(game.solved, false);
  assert.equal(game.replyAfter(2), null);
});

test('a ranked move further than the margin from the best is a miss', () => {
  const game = new FreePlay(puzzle);
  const result = game.submit('d3');
  assert.equal(result.verdict, 'miss');
  assert.equal(result.ranked, true);
  assert.equal(result.score, 15);
});

test('scores are shown in pawns from the player\'s side, mates as #n', () => {
  assert.equal(formatScore(35), '+0.35');
  assert.equal(formatScore(-120), '-1.20');
  assert.equal(formatScore(0), '0.00');
  assert.equal(formatScore(parseScore('mate', '3')), '#3');
  assert.equal(formatScore(parseScore('mate', '-2')), '-#2');
});

test('results update the score, streak, per-position record and miss list', () => {
  const solvedGame = new FreePlay(puzzle);
  solvedGame.submit('c3');
  solvedGame.submit('d4');
  solvedGame.submit('cxd4');
  let stats = recordFreePlay(emptyFreeStats(), solvedGame, 1000);
  assert.deepEqual([stats.attempted, stats.solved, stats.streak, stats.bestStreak], [1, 1, 1, 1]);
  const missedGame = new FreePlay(puzzle);
  missedGame.submit('h3');
  stats = recordFreePlay(stats, missedGame, 2000);
  assert.deepEqual([stats.attempted, stats.solved, stats.streak, stats.bestStreak], [2, 1, 0, 1]);
  assert.deepEqual(stats.seen.p1, { tries: 2, solved: 1, last: 2000 });
  assert.deepEqual(stats.recent[0], { id: 'p1', name: 'Italian Game', step: 0, played: 'h3', best: 'c3', at: 2000 });
});

test('puzzle choice prefers unseen, then unsolved, and respects the side filter', () => {
  const puzzles = [
    { id: 'a', moves: 'e4 e5' },
    { id: 'b', moves: 'e4 e5' },
    { id: 'c', moves: 'e4 e5 Nf3' },
  ];
  const stats = { ...emptyFreeStats(), seen: { a: { tries: 1, solved: 0 }, b: { tries: 1, solved: 1 } } };
  assert.equal(pickPuzzle(puzzles, stats, 'both', () => 0).id, 'c');
  assert.equal(pickPuzzle(puzzles, stats, 'w', () => 0.99).id, 'a');
  assert.equal(pickPuzzle(puzzles, stats, 'w', () => 0.99, 'a').id, 'b');
  assert.equal(pickPuzzle(puzzles, emptyFreeStats(), 'b', () => 0).id, 'c');
  assert.equal(pickPuzzle([], stats, 'both'), null);
});

test('positions need 6-14 half-moves, two developed minor pieces, and are unique', () => {
  const cards = [
    { eco: 'A', name: 'Short', moves: 'e4 e5 Nf3 Nc6' },
    { eco: 'B', name: 'Italian', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5' },
    { eco: 'C', name: 'Transposed', moves: 'Nf3 Nc6 e4 e5 Bc4 Bc5' },
    { eco: 'D', name: 'Pawns', moves: 'e4 e5 d4 d5 c4 c5' },
  ];
  assert.deepEqual(selectPositions(cards).map((p) => p.name), ['Italian']);
  const chess = new Chess();
  ['e4', 'e5', 'Nf3', 'Nc6'].forEach((san) => chess.move(san));
  assert.equal(developedMinors(chess), 2);
});

test('engine output parsing keeps the last full line per multipv and skips bound lines', () => {
  const lines = parseInfoLines([
    'info depth 10 multipv 1 score cp 20 nodes 5 pv e2e4 e7e5',
    'info depth 11 multipv 1 score cp 99 lowerbound nodes 6 pv d2d4',
    'info depth 11 multipv 1 score cp 25 nodes 7 pv d2d4 d7d5 c2c4',
    'info depth 11 multipv 2 score mate 2 nodes 7 pv e2e4',
    'info string NNUE evaluation',
  ]);
  assert.deepEqual(lines, [
    { depth: 11, score: 25, pv: ['d2d4', 'd7d5'] },
    { depth: 11, score: 29998, pv: ['e2e4'] },
  ]);
});

test('puzzles are built step by step through a UCI engine', async () => {
  const mock = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'mock_uci.mjs');
  const engine = await new UciEngine(process.execPath, [mock]).init();
  try {
    assert.equal(engine.name, 'MockFish 1');
    const position = { eco: 'C50', name: 'Italian Game', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5' };
    const built = await buildPuzzle(position, (fen) => engine.analyze(fen, 100));
    assert.equal(built.id, puzzleId(position.moves));
    assert.equal(built.steps.length, STEPS);
    assert.equal(built.steps[0].top.length, MULTIPV);
    assert.deepEqual(built.steps[0].top[0], ['a3', 50]);
    assert.equal(built.steps[0].reply, 'a5');
    assert.equal(built.steps.at(-1).reply, undefined);
    // Replaying best moves and replies must be legal throughout.
    const chess = new Chess();
    position.moves.split(' ').forEach((san) => chess.move(san));
    for (const step of built.steps) {
      chess.move(step.top[0][0]);
      if (step.reply) chess.move(step.reply);
    }
  } finally {
    engine.quit();
  }
});
