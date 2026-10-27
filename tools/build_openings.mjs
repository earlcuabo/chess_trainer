// Builds data/openings.json from the Lichess chess-openings TSV files in
// data/source/. Run: node tools/build_openings.mjs
//
// Each TSV row (eco, name, pgn) becomes one card. The card's side is the side
// that plays the line's last move, so depth 1 always tests that move.
// Cards are ordered easy-first: core openings, then other entries of core
// families without sub-variations, then everything else; shorter lines first.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from '../vendor/chess.js/chess.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Ordered roughly from the first moves a beginner learns to deeper systems.
export const CORE_NAMES = [
  "King's Pawn Game", "Queen's Pawn Game", 'English Opening', 'Zukertort Opening',
  'Sicilian Defense', 'French Defense', 'Caro-Kann Defense', 'Scandinavian Defense',
  'Pirc Defense', 'Alekhine Defense', 'Modern Defense', 'Indian Defense', 'Dutch Defense',
  'Vienna Game', "King's Gambit", "Bishop's Opening", "Queen's Gambit", 'Philidor Defense',
  "Petrov's Defense", 'Italian Game', 'Ruy Lopez', 'Scotch Game', "Queen's Gambit Declined",
  "Queen's Gambit Accepted", 'Slav Defense', 'Réti Opening', 'Benoni Defense',
  'Four Knights Game', 'Italian Game: Giuoco Piano', 'Italian Game: Two Knights Defense',
  "King's Indian Defense", 'Grünfeld Defense', 'Nimzo-Indian Defense',
  "Queen's Indian Defense", 'Catalan Opening', "Queen's Pawn Game: London System",
];

export function parseTsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split('\t');
  if (header.join(',') !== 'eco,name,pgn') throw new Error(`unexpected header ${header}`);
  return lines.map((line) => {
    const [eco, name, pgn] = line.split('\t');
    return { eco, name, pgn };
  });
}

export function pgnToSans(pgn) {
  return pgn.split(/\s+/).filter((token) => token && !/^\d+\.+$/.test(token));
}

function family(name) {
  return name.split(':')[0];
}

export function buildCards(rows, coreNames = CORE_NAMES) {
  const coreFamilies = new Set(coreNames.map(family));
  const familySize = new Map();
  for (const row of rows) familySize.set(family(row.name), (familySize.get(family(row.name)) ?? 0) + 1);

  const cards = rows.map((row, index) => {
    const chess = new Chess();
    const uci = [];
    let preFinalFen = null;
    const sans = pgnToSans(row.pgn);
    sans.forEach((san, ply) => {
      if (ply === sans.length - 1) preFinalFen = chess.fen();
      const move = chess.move(san);
      uci.push(move.from + move.to + (move.promotion ?? ''));
    });
    return {
      id: `${row.eco}:${uci.join('')}`,
      eco: row.eco,
      name: row.name,
      moves: chess.history().join(' '),
      side: sans.length % 2 === 1 ? 'w' : 'b',
      index,
      plies: sans.length,
      preFinalFen,
    };
  });

  const seen = new Set();
  for (const card of cards) {
    if (seen.has(card.id)) throw new Error(`duplicate card id ${card.id}`);
    seen.add(card.id);
  }

  // Core tier: the shortest entry for each core name.
  const coreIds = new Map();
  coreNames.forEach((name, rank) => {
    const matches = cards.filter((card) => card.name === name).sort((a, b) => a.plies - b.plies || a.index - b.index);
    if (!matches.length) throw new Error(`core opening not found: ${name}`);
    coreIds.set(matches[0].id, rank);
  });

  for (const card of cards) {
    if (coreIds.has(card.id)) card.tier = 1;
    else if (coreFamilies.has(family(card.name)) && !card.name.includes(',')) card.tier = 2;
    else card.tier = 3;
  }

  // Several entries can share a name and the position before the last move
  // while ending on different moves; each such move reaches the named opening.
  const finals = new Map();
  for (const card of cards) {
    const key = `${card.name}|${card.side}|${card.preFinalFen}`;
    if (!finals.has(key)) finals.set(key, new Set());
    finals.get(key).add(card.moves.split(' ').at(-1));
  }
  for (const card of cards) {
    const last = card.moves.split(' ').at(-1);
    const alternatives = [...finals.get(`${card.name}|${card.side}|${card.preFinalFen}`)].filter((san) => san !== last);
    if (alternatives.length) card.alt = alternatives.sort();
  }

  cards.sort((a, b) =>
    a.tier - b.tier ||
    (a.tier === 1 ? a.plies - b.plies || coreIds.get(a.id) - coreIds.get(b.id) : 0) ||
    a.plies - b.plies ||
    familySize.get(family(b.name)) - familySize.get(family(a.name)) ||
    a.name.localeCompare(b.name) ||
    a.index - b.index);

  return cards.map(({ id, eco, name, moves, side, tier, alt }) => (alt ? { id, eco, name, moves, side, tier, alt } : { id, eco, name, moves, side, tier }));
}

export const OUTPUT_PATH = join(root, 'data', 'openings.json');

// The exact text written to data/openings.json.
export function buildDeckJson() {
  const rows = ['a', 'b', 'c', 'd', 'e'].flatMap((letter) => parseTsv(readFileSync(join(root, 'data', 'source', `${letter}.tsv`), 'utf8')));
  const cards = buildCards(rows);
  const output = {
    source: 'https://github.com/lichess-org/chess-openings (CC0 1.0)',
    count: cards.length,
    cards,
  };
  return `${JSON.stringify(output)}\n`;
}

function main() {
  writeFileSync(OUTPUT_PATH, buildDeckJson());
  const { cards } = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'));
  const tiers = [1, 2, 3].map((tier) => cards.filter((card) => card.tier === tier).length);
  const withAlt = cards.filter((card) => card.alt).length;
  console.log(`wrote ${cards.length} cards (tiers ${tiers.join(' / ')}; ${withAlt} with alternative final moves)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
