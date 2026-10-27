import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyFreeStats } from '../src/freeplay.js';
import { counts, nextCard, noteNewCard } from '../src/queue.js';
import { DEFAULT_SETTINGS, MINUTE, newCardState } from '../src/srs.js';
import { emptyProgress, exportBackup, importBackup, loadProgress, normalizeSettings, saveProgress, STORAGE_KEY } from '../src/storage.js';

const NOW = new Date(2026, 9, 27, 10, 0).getTime();
const deck = [
  { id: 'A', side: 'w' },
  { id: 'B', side: 'b' },
  { id: 'C', side: 'w' },
  { id: 'D', side: 'b' },
];

function progressWith(cards, daily = null) {
  return { cards, daily, settings: { ...DEFAULT_SETTINGS }, freeplay: emptyFreeStats() };
}

test('new cards come in deck order when nothing is due', () => {
  assert.deepEqual(nextCard(deck, progressWith({}), DEFAULT_SETTINGS, NOW), { card: deck[0], kind: 'new' });
});

test('due learning cards come before due reviews, which come before new cards', () => {
  const progress = progressWith({
    A: { ...newCardState(), state: 'review', due: NOW - 5 },
    B: { ...newCardState(), state: 'learning', due: NOW - 1 },
  });
  assert.equal(nextCard(deck, progress, DEFAULT_SETTINGS, NOW).card.id, 'B');
  delete progress.cards.B;
  assert.equal(nextCard(deck, progress, DEFAULT_SETTINGS, NOW).kind, 'review');
});

test('the side filter limits every queue', () => {
  const settings = { ...DEFAULT_SETTINGS, side: 'b' };
  assert.equal(nextCard(deck, progressWith({}), settings, NOW).card.id, 'B');
  assert.equal(counts(deck, progressWith({}), settings, NOW).new, 2);
});

test('the daily new-card limit applies only when set', () => {
  let progress = progressWith({});
  progress = noteNewCard(progress, NOW);
  progress = noteNewCard(progress, NOW);
  assert.equal(progress.daily.newCount, 2);
  const limited = { ...DEFAULT_SETTINGS, newPerDay: 2 };
  assert.equal(nextCard(deck, progress, limited, NOW).card, null);
  assert.equal(counts(deck, progress, limited, NOW).new, 0);
  assert.equal(nextCard(deck, progress, DEFAULT_SETTINGS, NOW).kind, 'new');
  assert.equal(counts(deck, progress, DEFAULT_SETTINGS, NOW).new, 4);
});

test('learning cards due soon are shown early; otherwise report the next due time', () => {
  const soon = progressWith({ A: { ...newCardState(), state: 'learning', due: NOW + 5 * MINUTE } });
  const settings = { ...DEFAULT_SETTINGS, side: 'w', newPerDay: 0 };
  assert.equal(nextCard(deck, soon, settings, NOW).card.id, 'A');
  const later = progressWith({ A: { ...newCardState(), state: 'review', due: NOW + 60 * MINUTE } });
  assert.deepEqual(nextCard(deck, later, settings, NOW), { card: null, nextDue: NOW + 60 * MINUTE });
});

test('skipId avoids repeating the card just answered', () => {
  const progress = progressWith({ A: { ...newCardState(), state: 'learning', due: NOW - 1 } });
  assert.equal(nextCard(deck, progress, DEFAULT_SETTINGS, NOW, 'A').card.id, 'B');
});

test('settings are normalized', () => {
  assert.equal(normalizeSettings({ newPerDay: '' }).newPerDay, null);
  assert.equal(normalizeSettings({ newPerDay: '7' }).newPerDay, 7);
  assert.equal(normalizeSettings({ maxDepth: 99 }).maxDepth, 30);
  assert.equal(normalizeSettings({ maxDepth: 'x' }).maxDepth, 10);
  assert.equal(normalizeSettings({ side: 'red' }).side, 'both');
  assert.deepEqual(normalizeSettings(), { ...DEFAULT_SETTINGS });
});

test('progress round-trips through storage and backups', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.deepEqual(loadProgress(storage), emptyProgress());
  const progress = progressWith({ A: newCardState() }, { day: 1, newCount: 1 });
  saveProgress(storage, progress);
  assert.deepEqual(loadProgress(storage), progress);
  store.set(STORAGE_KEY, '{not json');
  assert.deepEqual(loadProgress(storage), emptyProgress());
  assert.deepEqual(importBackup(exportBackup(progress, NOW)), progress);
  assert.throws(() => importBackup('{"format":"other"}'), /not a Chess Trainer backup/);
});
