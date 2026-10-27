// Chooses the next card: due learning cards, then due reviews, then new
// cards in deck order (subject to the daily new-card limit), then learning
// cards due within the learn-ahead window.
import { dayNumber, MINUTE } from './srs.js';

export const LEARN_AHEAD = 20 * MINUTE;

export function matchesSide(card, settings) {
  return settings.side === 'both' || card.side === settings.side;
}

export function newCountToday(progress, now) {
  return progress.daily && progress.daily.day === dayNumber(now) ? progress.daily.newCount : 0;
}

export function counts(deck, progress, settings, now) {
  let learning = 0;
  let review = 0;
  let unseen = 0;
  for (const card of deck) {
    if (!matchesSide(card, settings)) continue;
    const state = progress.cards[card.id];
    if (!state || state.state === 'new') unseen += 1;
    else if (state.due <= now) {
      if (state.state === 'review') review += 1;
      else learning += 1;
    }
  }
  const remaining = settings.newPerDay == null ? unseen : Math.min(unseen, Math.max(0, settings.newPerDay - newCountToday(progress, now)));
  return { learning, review, new: remaining, unseen };
}

// Returns { card, kind } or { card: null, nextDue } when nothing is left.
export function nextCard(deck, progress, settings, now, skipId = null) {
  let learning = null;
  let review = null;
  let ahead = null;
  let fresh = null;
  let nextDue = null;
  for (const card of deck) {
    if (card.id === skipId || !matchesSide(card, settings)) continue;
    const state = progress.cards[card.id];
    if (!state || state.state === 'new') {
      if (!fresh) fresh = card;
      continue;
    }
    const isLearning = state.state !== 'review';
    if (state.due <= now) {
      if (isLearning) {
        if (!learning || state.due < progress.cards[learning.id].due) learning = card;
      } else if (!review || state.due < progress.cards[review.id].due) review = card;
    } else {
      if (isLearning && state.due <= now + LEARN_AHEAD && (!ahead || state.due < progress.cards[ahead.id].due)) ahead = card;
      if (nextDue == null || state.due < nextDue) nextDue = state.due;
    }
  }
  if (learning) return { card: learning, kind: 'learning' };
  if (review) return { card: review, kind: 'review' };
  const newAllowed = settings.newPerDay == null || newCountToday(progress, now) < settings.newPerDay;
  if (fresh && newAllowed) return { card: fresh, kind: 'new' };
  if (ahead) return { card: ahead, kind: 'learning' };
  return { card: null, nextDue };
}

// Records that a new card was started today.
export function noteNewCard(progress, now) {
  const day = dayNumber(now);
  const newCount = progress.daily && progress.daily.day === day ? progress.daily.newCount + 1 : 1;
  return { ...progress, daily: { day, newCount } };
}
