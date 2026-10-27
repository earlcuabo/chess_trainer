import assert from 'node:assert/strict';
import test from 'node:test';
import { Drill } from '../src/drill.js';
import { buildLine, finalAlternatives } from '../src/line.js';

const italian = buildLine({ moves: 'e4 e5 Nf3 Nc6 Bc4' });

function playAuto(drill) {
  const played = [];
  for (let move = drill.nextAutoMove(); move; move = drill.nextAutoMove()) {
    played.push(move.san);
    drill.advanceAuto();
  }
  return played;
}

test('depth 1 plays everything before the last move automatically', () => {
  const drill = new Drill(italian, 'w', 1);
  assert.deepEqual(playAuto(drill), ['e4', 'e5', 'Nf3', 'Nc6']);
  assert.ok(drill.isUserTurn());
  assert.deepEqual(drill.submit('f1c4'), { result: 'correct', move: italian[4], alternative: false });
  assert.ok(drill.done);
  assert.equal(drill.failed, false);
});

test('higher depth tests earlier user moves and auto-plays the opponent', () => {
  const drill = new Drill(italian, 'w', 2);
  assert.deepEqual(drill.testedPlies, [2, 4]);
  assert.deepEqual(playAuto(drill), ['e4', 'e5']);
  assert.equal(drill.submit('g1f3').result, 'correct');
  assert.deepEqual(playAuto(drill), ['Nc6']);
  assert.equal(drill.submit('f1c4').result, 'correct');
  assert.ok(drill.done);
});

test('depth is clamped to the number of user moves', () => {
  const drill = new Drill(italian, 'w', 9);
  assert.equal(drill.depth, 3);
  assert.equal(drill.startPly, 0);
  assert.deepEqual(playAuto(drill), []);
});

test('a wrong move reveals the answer at once and fails the card', () => {
  const drill = new Drill(italian, 'w', 1);
  playAuto(drill);
  const outcome = drill.submit('f1b5');
  assert.equal(outcome.result, 'reveal');
  assert.equal(outcome.move.san, 'Bc4');
  assert.equal(drill.playExpected().san, 'Bc4');
  assert.ok(drill.done);
  assert.ok(drill.failed);
  assert.deepEqual(drill.missedPlies, [4]);
});

test('after a revealed move the line carries on', () => {
  const drill = new Drill(italian, 'w', 2);
  playAuto(drill);
  assert.equal(drill.submit('d2d4').result, 'reveal');
  drill.playExpected();
  assert.deepEqual(playAuto(drill), ['Nc6']);
  assert.equal(drill.submit('f1c4').result, 'correct');
  assert.ok(drill.done);
  assert.deepEqual(drill.missedPlies, [2]);
  assert.throws(() => drill.playExpected(), /not the user/);
});

test('black lines test black moves', () => {
  const sicilian = buildLine({ moves: 'e4 c5' });
  const drill = new Drill(sicilian, 'b', 1);
  assert.deepEqual(playAuto(drill), ['e4']);
  assert.equal(drill.submit('c7c5').result, 'correct');
  assert.throws(() => new Drill(sicilian, 'w', 1), /must end/);
});

test('alternative final moves count as correct only on the last move', () => {
  const card = { moves: 'd4 d6', alt: ['d5'] };
  const line = buildLine(card);
  const alternatives = finalAlternatives(card, line);
  assert.deepEqual(alternatives, ['d7d5']);
  const drill = new Drill(line, 'b', 1, { finalAlternatives: alternatives });
  playAuto(drill);
  const outcome = drill.submit('d7d5');
  assert.equal(outcome.result, 'correct');
  assert.equal(outcome.alternative, true);
  assert.equal(drill.failed, false);
});

test('mistakes on a hinted move do not fail the card', () => {
  const drill = new Drill(italian, 'w', 1, { hintPlies: [4] });
  playAuto(drill);
  assert.ok(drill.shouldHint());
  assert.equal(drill.submit('f1b5').result, 'reveal');
  drill.playExpected();
  assert.equal(drill.failed, false);
});

test('castling and move labels', () => {
  const line = buildLine({ moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 O-O' });
  assert.equal(line[6].uci, 'e1g1');
  assert.equal(Drill.moveLabel(0), '1.');
  assert.equal(Drill.moveLabel(5), '3...');
});
