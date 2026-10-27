// Spaced-repetition scheduling (SM-2, as in Anki's classic scheduler) plus
// depth growth. All functions are pure: they take `now` in milliseconds and
// return new objects.

export const MINUTE = 60 * 1000;
export const DAY = 24 * 60 * MINUTE;
export const LEARNING_STEPS = [1 * MINUTE, 10 * MINUTE];
export const RELEARNING_STEPS = [10 * MINUTE];
export const START_EASE = 2.5;
export const MIN_EASE = 1.3;
export const EASY_BONUS = 1.3;
export const GRADUATING_DAYS = 1;
export const EASY_DAYS = 4;
// A new day starts at 4am local time, so late-night practice counts as the
// same day.
export const DAY_ROLLOVER_HOURS = 4;

export const DEFAULT_SETTINGS = Object.freeze({
  newPerDay: null, // null means no limit
  maxDepth: 10,
  promoteAfter: 3,
  side: 'both', // 'both' | 'w' | 'b'
  speed: 'normal', // 'slow' | 'normal' | 'fast'
});

export function newCardState() {
  return { state: 'new', step: 0, due: 0, interval: 0, ease: START_EASE, reps: 0, lapses: 0, depth: 1, streak: 0, intro: true, misses: {} };
}

// Local day number with the 4am rollover.
export function dayNumber(now) {
  const shifted = new Date(now - DAY_ROLLOVER_HOURS * 60 * MINUTE);
  return Math.floor(Date.UTC(shifted.getFullYear(), shifted.getMonth(), shifted.getDate()) / DAY);
}

// Start (4am local) of the day `days` after the day containing `now`.
export function dayStart(now, days) {
  const shifted = new Date(now - DAY_ROLLOVER_HOURS * 60 * MINUTE);
  return new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate() + days, DAY_ROLLOVER_HOURS).getTime();
}

// Number of the user's moves in a line of `plies` half-moves ending on the
// user's move.
export function userMoveCount(plies) {
  return Math.ceil(plies / 2);
}

export function depthLimit(plies, settings) {
  return Math.max(1, Math.min(settings.maxDepth, userMoveCount(plies)));
}

// result: 'again' | 'good' | 'easy'
export function grade(card, result, now, plies, settings = DEFAULT_SETTINGS) {
  const next = { ...card, misses: { ...card.misses }, intro: false, reps: card.reps + 1 };
  const graduate = (days) => {
    next.state = 'review';
    next.step = 0;
    next.interval = days;
    next.due = dayStart(now, days);
  };

  if (card.state === 'new' || card.state === 'learning') {
    if (result === 'again') {
      next.state = 'learning';
      next.step = 0;
      next.due = now + LEARNING_STEPS[0];
    } else if (result === 'easy') {
      graduate(EASY_DAYS);
    } else {
      const step = card.state === 'new' ? 1 : card.step + 1;
      if (step >= LEARNING_STEPS.length) graduate(GRADUATING_DAYS);
      else {
        next.state = 'learning';
        next.step = step;
        next.due = now + LEARNING_STEPS[step];
      }
    }
    return next;
  }

  if (card.state === 'relearning') {
    if (result === 'again') {
      next.step = 0;
      next.due = now + RELEARNING_STEPS[0];
    } else {
      const step = card.step + 1;
      if (step >= RELEARNING_STEPS.length) graduate(Math.max(1, card.interval));
      else {
        next.step = step;
        next.due = now + RELEARNING_STEPS[step];
      }
    }
    return next;
  }

  // Review card.
  if (result === 'again') {
    next.state = 'relearning';
    next.step = 0;
    next.lapses = card.lapses + 1;
    next.ease = Math.max(MIN_EASE, card.ease - 0.2);
    next.interval = 1;
    next.streak = 0;
    next.due = now + RELEARNING_STEPS[0];
    return next;
  }
  if (result === 'easy') {
    next.ease = card.ease + 0.15;
    graduate(Math.max(card.interval + 1, Math.round(card.interval * card.ease * EASY_BONUS)));
  } else {
    graduate(Math.max(card.interval + 1, Math.round(card.interval * card.ease)));
  }
  next.streak = card.streak + 1;

  // Depth growth: after enough passed reviews in a row, test one more move
  // and send the card back through short learning steps.
  if (next.streak >= settings.promoteAfter && card.depth < depthLimit(plies, settings)) {
    next.depth = card.depth + 1;
    next.streak = 0;
    next.intro = true;
    next.state = 'learning';
    next.step = 0;
    next.due = now + LEARNING_STEPS[0];
  }
  return next;
}

// Short labels for the buttons shown after a card, e.g. "10m" or "4d".
export function previewInterval(card, result, now, plies, settings = DEFAULT_SETTINGS) {
  const next = grade(card, result, now, plies, settings);
  return formatDelay(next.due - now);
}

export function formatDelay(ms) {
  if (ms < 60 * MINUTE) return `${Math.max(1, Math.round(ms / MINUTE))}m`;
  if (ms < DAY) return `${Math.round(ms / (60 * MINUTE))}h`;
  const days = Math.round(ms / DAY);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
