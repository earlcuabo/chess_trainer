// Builds data/freeplay.json: opening positions with Stockfish's top moves.
//
//   node tools/build_freeplay.mjs --engine <stockfish.exe> [--nodes 1500000]
//        [--workers 3] [--limit N] [--cache <file.jsonl>]
//
// Positions are 6-14 half-moves into deck lines (their end positions first,
// then positions partway through longer lines) with at least two minor pieces
// developed, one per unique position. Each puzzle has
// up to STEPS steps: the user's best move, then the engine's reply from the
// best move's principal variation, then the next step.
//
// Each analysis uses one thread, a fixed node count and a cleared hash, so
// results are reproducible. Results are cached by position and settings, so
// an interrupted run resumes where it stopped. Engines run at the lowest CPU
// priority so they only use spare time on pc2.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { constants, setPriority } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Chess } from '../vendor/chess.js/chess.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT_PATH = join(root, 'data', 'freeplay.json');
export const STEPS = 3;
export const MULTIPV = 8;
export const MIN_PLIES = 6;
export const MAX_PLIES = 14;
export const MATE = 30000;

const MINOR_HOMES = { w: { n: ['b1', 'g1'], b: ['c1', 'f1'] }, b: { n: ['b8', 'g8'], b: ['c8', 'f8'] } };

export function positionKey(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

// Minor pieces (both sides) that have left their starting squares.
export function developedMinors(chess) {
  let home = 0;
  for (const color of ['w', 'b']) {
    for (const type of ['n', 'b']) {
      for (const square of MINOR_HOMES[color][type]) {
        const piece = chess.get(square);
        if (piece && piece.color === color && piece.type === type) home += 1;
      }
    }
  }
  return 8 - home;
}

function eligible(chess) {
  return developedMinors(chess) >= 2 && !chess.isGameOver();
}

// End positions of deck lines come first, in deck order, so their puzzle
// order and ids stay stable; then positions partway through longer lines,
// each named after the latest named opening on its path.
export function selectPositions(cards) {
  const seen = new Set();
  const positions = [];
  const named = new Map(); // position key -> first deck card ending there
  const lines = cards.map((card) => {
    const chess = new Chess();
    const keys = card.moves.split(' ').map((san) => {
      chess.move(san);
      return positionKey(chess.fen());
    });
    if (!named.has(keys.at(-1))) named.set(keys.at(-1), card);
    return { card, sans: card.moves.split(' '), keys, chess };
  });

  for (const { card, sans, keys, chess } of lines) {
    if (sans.length < MIN_PLIES || sans.length > MAX_PLIES || !eligible(chess)) continue;
    if (seen.has(keys.at(-1))) continue;
    seen.add(keys.at(-1));
    positions.push({ eco: card.eco, name: card.name, moves: card.moves });
  }

  for (const { card, sans, keys } of lines) {
    const chess = new Chess();
    let label = null;
    for (let ply = 1; ply < Math.min(sans.length, MAX_PLIES + 1); ply += 1) {
      chess.move(sans[ply - 1]);
      label = named.get(keys[ply - 1]) ?? label;
      if (ply < MIN_PLIES || seen.has(keys[ply - 1]) || !eligible(chess)) continue;
      seen.add(keys[ply - 1]);
      const source = label ?? card;
      positions.push({ eco: source.eco, name: source.name, moves: sans.slice(0, ply).join(' ') });
    }
  }
  return positions;
}

// Score from the side to move: centipawns, or +/-(MATE - n) for mate in n.
export function parseScore(kind, value) {
  const n = Number(value);
  if (kind === 'cp') return n;
  return n > 0 ? MATE - n : -MATE - n;
}

// Parses the last complete set of "info ... multipv k ..." lines.
export function parseInfoLines(lines) {
  const byPv = new Map();
  for (const line of lines) {
    if (!line.startsWith('info ') || !line.includes(' pv ') || line.includes(' bound ')) continue;
    const multipv = Number(/ multipv (\d+)/.exec(line)?.[1] ?? 1);
    const score = / score (cp|mate) (-?\d+)/.exec(line);
    const pv = line.split(' pv ')[1].trim().split(/\s+/);
    const depth = Number(/ depth (\d+)/.exec(line)?.[1] ?? 0);
    if (!score) continue;
    byPv.set(multipv, { depth, score: parseScore(score[1], score[2]), pv: pv.slice(0, 2) });
  }
  return [...byPv.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value);
}

export class UciEngine {
  constructor(path, args = []) {
    this.process = spawn(path, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    try {
      setPriority(this.process.pid, constants.priority.PRIORITY_LOW);
    } catch {
      // Priority is best effort.
    }
    this.waiters = [];
    this.lines = [];
    createInterface({ input: this.process.stdout }).on('line', (line) => {
      this.lines.push(line);
      const waiter = this.waiters[0];
      if (waiter && waiter.test(line)) {
        this.waiters.shift();
        waiter.resolve(this.lines.splice(0));
      }
    });
  }

  send(command) {
    this.process.stdin.write(`${command}\n`);
  }

  until(test) {
    return new Promise((resolve) => this.waiters.push({ test, resolve }));
  }

  async init() {
    this.send('uci');
    const lines = await this.until((line) => line === 'uciok');
    this.name = (lines.find((line) => line.startsWith('id name ')) ?? 'id name unknown').slice(8);
    this.send('setoption name Threads value 1');
    this.send('setoption name Hash value 64');
    this.send(`setoption name MultiPV value ${MULTIPV}`);
    this.send('isready');
    await this.until((line) => line === 'readyok');
    return this;
  }

  async analyze(fen, nodes) {
    this.send('ucinewgame');
    this.send('isready');
    await this.until((line) => line === 'readyok');
    this.send(`position fen ${fen}`);
    this.send(`go nodes ${nodes}`);
    return parseInfoLines(await this.until((line) => line.startsWith('bestmove')));
  }

  quit() {
    this.send('quit');
  }
}

function uciToSan(chess, uci) {
  const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  chess.undo();
  return move.san;
}

// Builds one puzzle's steps; `analyze(fen)` returns parsed engine lines.
export async function buildPuzzle(position, analyze) {
  const chess = new Chess();
  position.moves.split(' ').forEach((san) => chess.move(san));
  const steps = [];
  for (let index = 0; index < STEPS; index += 1) {
    const lines = await analyze(chess.fen());
    if (!lines.length) break;
    const step = { top: lines.map((line) => [uciToSan(chess, line.pv[0]), line.score]) };
    steps.push(step);
    const [best] = lines;
    chess.move({ from: best.pv[0].slice(0, 2), to: best.pv[0].slice(2, 4), promotion: best.pv[0][4] });
    const reply = best.pv[1];
    if (index === STEPS - 1 || !reply || chess.isGameOver()) break;
    step.reply = uciToSan(chess, reply);
    chess.move(step.reply);
    if (chess.isGameOver()) {
      delete step.reply;
      break;
    }
  }
  return { id: puzzleId(position.moves), eco: position.eco, name: position.name, moves: position.moves, steps };
}

// FNV-1a hash of the start moves, as 8 hex digits.
export function puzzleId(moves) {
  let hash = 0x811c9dc5;
  for (const char of moves) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function parseArgs(argv) {
  const args = { nodes: 1500000, workers: 3, limit: null, engine: process.env.STOCKFISH_PATH, cache: join(process.env.LOCALAPPDATA ?? root, 'chess_trainer_tools', 'freeplay_cache.jsonl') };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in args)) throw new Error(`unknown option ${argv[i]}`);
    args[key] = ['nodes', 'workers', 'limit'].includes(key) ? Number(argv[i + 1]) : argv[i + 1];
  }
  if (!args.engine) throw new Error('pass --engine <path to stockfish> or set STOCKFISH_PATH');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { cards } = JSON.parse(readFileSync(join(root, 'data', 'openings.json'), 'utf8'));
  let positions = selectPositions(cards);
  if (args.limit) positions = positions.slice(0, args.limit);

  mkdirSync(dirname(args.cache), { recursive: true });
  const cache = new Map();
  if (existsSync(args.cache)) {
    for (const line of readFileSync(args.cache, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        cache.set(entry.key, entry.lines);
      } catch {
        // A run stopped mid-write can leave a partial last line; redo it.
      }
    }
  }

  const engines = await Promise.all(Array.from({ length: args.workers }, () => new UciEngine(args.engine).init()));
  const engineName = engines[0].name;
  const free = [...engines];
  const idle = [];
  const acquire = () => (free.length ? Promise.resolve(free.pop()) : new Promise((resolve) => idle.push(resolve)));
  const release = (engine) => (idle.length ? idle.shift()(engine) : free.push(engine));

  let analyses = 0;
  let cached = 0;
  const started = Date.now();
  const analyze = async (fen) => {
    const key = `${engineName}|${args.nodes}|${MULTIPV}|${positionKey(fen)}`;
    if (cache.has(key)) {
      cached += 1;
      return cache.get(key);
    }
    const engine = await acquire();
    try {
      const lines = await engine.analyze(fen, args.nodes);
      cache.set(key, lines);
      appendFileSync(args.cache, `${JSON.stringify({ key, lines })}\n`);
      analyses += 1;
      return lines;
    } finally {
      release(engine);
    }
  };

  const puzzles = new Array(positions.length);
  let next = 0;
  let done = 0;
  const report = setInterval(() => {
    const elapsed = (Date.now() - started) / 1000;
    const rate = done / Math.max(elapsed, 1);
    const eta = rate ? Math.round((positions.length - done) / rate / 60) : '?';
    console.log(`${done}/${positions.length} puzzles, ${analyses} analyses (${cached} cached), ${Math.round(elapsed / 60)} min elapsed, ~${eta} min left`);
  }, 60000);
  await Promise.all(Array.from({ length: args.workers }, async () => {
    while (next < positions.length) {
      const index = next;
      next += 1;
      puzzles[index] = await buildPuzzle(positions[index], analyze);
      done += 1;
    }
  }));
  clearInterval(report);
  engines.forEach((engine) => engine.quit());

  const output = { engine: engineName, nodes: args.nodes, multipv: MULTIPV, count: puzzles.length, puzzles };
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(output)}\n`);
  console.log(`wrote ${puzzles.length} puzzles to data/freeplay.json (${engineName}, ${args.nodes} nodes, ${analyses} new analyses, ${cached} cached)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
