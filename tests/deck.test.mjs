import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildCards, buildDeckJson, OUTPUT_PATH, parseTsv, pgnToSans } from '../tools/build_openings.mjs';
import { Drill } from '../src/drill.js';
import { buildLine, finalAlternatives } from '../src/line.js';

const rows = parseTsv([
  'eco\tname\tpgn',
  'C20\tKing\'s Pawn Game\t1. e4',
  'B20\tSicilian Defense\t1. e4 c5',
  'B27\tSicilian Defense\t1. e4 c5 2. Nf3',
  'B20\tSicilian Defense: Bowdler Attack\t1. e4 c5 2. Bc4',
  'B20\tSicilian Defense: Snyder Variation, Queen Fianchetto Variation\t1. e4 c5 2. b3 b6',
  'A00\tAmar Opening\t1. Nh3',
  'A40\tQueen\'s Pawn Game\t1. d4 d5',
  'A41\tQueen\'s Pawn Game\t1. d4 d6',
].join('\n'));

test('pgnToSans drops move numbers', () => {
  assert.deepEqual(pgnToSans('1. e4 e5 2. Nf3'), ['e4', 'e5', 'Nf3']);
});

test('cards are tiered, ordered easy-first and get the side of the last move', () => {
  const cards = buildCards(rows, ["King's Pawn Game", 'Sicilian Defense']);
  assert.deepEqual(cards.map((card) => [card.name, card.tier, card.side]), [
    ["King's Pawn Game", 1, 'w'],
    ['Sicilian Defense', 1, 'b'],
    ['Sicilian Defense', 2, 'w'],
    ['Sicilian Defense: Bowdler Attack', 2, 'w'],
    ['Amar Opening', 3, 'w'],
    ["Queen's Pawn Game", 3, 'b'],
    ["Queen's Pawn Game", 3, 'b'],
    ['Sicilian Defense: Snyder Variation, Queen Fianchetto Variation', 3, 'b'],
  ]);
  assert.equal(cards[0].id, 'C20:e2e4');
});

test('same-name lines ending on different moves list each other as alternatives', () => {
  const cards = buildCards(rows, ["King's Pawn Game"]);
  const qp = cards.filter((card) => card.name === "Queen's Pawn Game");
  assert.deepEqual(qp.map((card) => card.alt), [['d6'], ['d5']]);
});

test('a missing core opening is an error', () => {
  assert.throws(() => buildCards(rows, ['Nonexistent Opening']), /core opening not found/);
});

test('data/openings.json is up to date with data/source', () => {
  assert.equal(readFileSync(OUTPUT_PATH, 'utf8'), buildDeckJson(), 'run: node tools/build_openings.mjs');
});

test('every deck card can be drilled at full depth', () => {
  const { cards } = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'));
  assert.ok(cards.length > 3000);
  assert.equal(cards[0].name, "King's Pawn Game");
  for (const card of cards) {
    const line = buildLine(card);
    const drill = new Drill(line, card.side, 99, { finalAlternatives: finalAlternatives(card, line) });
    for (let move = drill.nextAutoMove(); !drill.done; move = drill.nextAutoMove()) {
      if (move) drill.advanceAuto();
      else assert.equal(drill.submit(drill.expected().uci).result, 'correct', card.id);
    }
    assert.equal(drill.failed, false);
  }
});
