import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY, DEFAULT_SETTINGS, MINUTE, dayNumber, dayStart, depthLimit, formatDelay, grade, newCardState } from '../src/srs.js';

// 2026-10-27 10:00 local time.
const NOW = new Date(2026, 9, 27, 10, 0).getTime();
const PLIES = 5; // e.g. Italian Game: three White moves

test('new card: good goes to the 10 minute step, again to the 1 minute step', () => {
  const good = grade(newCardState(), 'good', NOW, PLIES);
  assert.equal(good.state, 'learning');
  assert.equal(good.step, 1);
  assert.equal(good.due, NOW + 10 * MINUTE);
  assert.equal(good.intro, false);
  const again = grade(newCardState(), 'again', NOW, PLIES);
  assert.equal(again.state, 'learning');
  assert.equal(again.due, NOW + MINUTE);
});

test('learning card graduates to a one-day review at the 4am rollover', () => {
  const learning = grade(newCardState(), 'good', NOW, PLIES);
  const review = grade(learning, 'good', NOW + 10 * MINUTE, PLIES);
  assert.equal(review.state, 'review');
  assert.equal(review.interval, 1);
  assert.equal(review.due, new Date(2026, 9, 28, 4, 0).getTime());
});

test('easy on a new card graduates straight to four days', () => {
  const card = grade(newCardState(), 'easy', NOW, PLIES);
  assert.equal(card.state, 'review');
  assert.equal(card.interval, 4);
});

test('review intervals grow by ease and a lapse sends the card to relearning', () => {
  let card = { ...newCardState(), state: 'review', interval: 10, ease: 2.5, intro: false };
  card = grade(card, 'good', NOW, 99);
  assert.equal(card.interval, 25);
  assert.equal(card.streak, 1);
  const lapsed = grade(card, 'again', NOW, 99);
  assert.equal(lapsed.state, 'relearning');
  assert.equal(lapsed.lapses, 1);
  assert.equal(lapsed.ease, 2.3);
  assert.equal(lapsed.streak, 0);
  assert.equal(lapsed.due, NOW + 10 * MINUTE);
  const back = grade(lapsed, 'good', NOW + 10 * MINUTE, 99);
  assert.equal(back.state, 'review');
  assert.equal(back.interval, 1);
});

test('ease never drops below the minimum', () => {
  const card = grade({ ...newCardState(), state: 'review', interval: 3, ease: 1.35 }, 'again', NOW, PLIES);
  assert.equal(card.ease, 1.3);
});

test('depth grows after the set number of passed reviews in a row', () => {
  let card = { ...newCardState(), state: 'review', interval: 1, intro: false };
  card = grade(card, 'good', NOW, PLIES);
  card = grade(card, 'good', NOW, PLIES);
  assert.equal(card.depth, 1);
  card = grade(card, 'good', NOW, PLIES);
  assert.equal(card.depth, 2);
  assert.equal(card.state, 'learning');
  assert.equal(card.intro, true);
  assert.equal(card.streak, 0);
  assert.equal(card.due, NOW + MINUTE);
});

test('depth stops at the number of the user\'s moves and at the max setting', () => {
  let card = { ...newCardState(), state: 'review', interval: 1, depth: 3, streak: 2 };
  card = grade(card, 'good', NOW, 5);
  assert.equal(card.depth, 3);
  assert.equal(card.state, 'review');
  assert.equal(depthLimit(5, DEFAULT_SETTINGS), 3);
  assert.equal(depthLimit(40, DEFAULT_SETTINGS), 10);
  assert.equal(depthLimit(40, { ...DEFAULT_SETTINGS, maxDepth: 1 }), 1);
  const capped = grade({ ...newCardState(), state: 'review', interval: 1, streak: 2 }, 'good', NOW, 40, { ...DEFAULT_SETTINGS, maxDepth: 1 });
  assert.equal(capped.depth, 1);
});

test('promotion respects the promoteAfter setting', () => {
  const card = grade({ ...newCardState(), state: 'review', interval: 1 }, 'good', NOW, PLIES, { ...DEFAULT_SETTINGS, promoteAfter: 1 });
  assert.equal(card.depth, 2);
});

test('grade does not mutate its input', () => {
  const card = newCardState();
  const copy = structuredClone(card);
  grade(card, 'again', NOW, PLIES);
  assert.deepEqual(card, copy);
});

test('days roll over at 4am', () => {
  const lateNight = new Date(2026, 9, 28, 2, 0).getTime();
  assert.equal(dayNumber(lateNight), dayNumber(NOW));
  assert.equal(dayNumber(new Date(2026, 9, 28, 5, 0).getTime()), dayNumber(NOW) + 1);
  assert.equal(dayStart(lateNight, 1), new Date(2026, 9, 28, 4, 0).getTime());
});

test('formatDelay labels', () => {
  assert.equal(formatDelay(30 * 1000), '1m');
  assert.equal(formatDelay(10 * MINUTE), '10m');
  assert.equal(formatDelay(18 * 60 * MINUTE), '18h');
  assert.equal(formatDelay(4 * DAY), '4d');
  assert.equal(formatDelay(90 * DAY), '3mo');
});
