// Progress and settings persistence in localStorage, plus a JSON backup
// format for export and import.
import { DEFAULT_SETTINGS } from './srs.js';

export const STORAGE_KEY = 'chess_trainer.v1';
export const BACKUP_FORMAT = 'chess_trainer_backup';
export const BACKUP_VERSION = 1;

export function emptyProgress() {
  return { cards: {}, daily: null, settings: { ...DEFAULT_SETTINGS } };
}

export function normalizeSettings(settings = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  const intOrNull = (value) => (value === null || value === '' || value === undefined ? null : Math.max(0, Math.floor(Number(value))));
  merged.newPerDay = intOrNull(merged.newPerDay);
  if (Number.isNaN(merged.newPerDay)) merged.newPerDay = DEFAULT_SETTINGS.newPerDay;
  merged.maxDepth = clampInt(merged.maxDepth, 1, 30, DEFAULT_SETTINGS.maxDepth);
  merged.promoteAfter = clampInt(merged.promoteAfter, 1, 10, DEFAULT_SETTINGS.promoteAfter);
  if (!['both', 'w', 'b'].includes(merged.side)) merged.side = DEFAULT_SETTINGS.side;
  if (!['slow', 'normal', 'fast'].includes(merged.speed)) merged.speed = DEFAULT_SETTINGS.speed;
  return merged;
}

function clampInt(value, min, max, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function normalizeProgress(data) {
  if (!data || typeof data !== 'object' || typeof data.cards !== 'object' || data.cards === null) throw new Error('not a progress object');
  return {
    cards: data.cards,
    daily: data.daily && typeof data.daily.day === 'number' ? data.daily : null,
    settings: normalizeSettings(data.settings),
  };
}

export function loadProgress(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return emptyProgress();
  try {
    return normalizeProgress(JSON.parse(raw));
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(storage, progress) {
  storage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

export function exportBackup(progress, now) {
  return JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exported: new Date(now).toISOString(), progress }, null, 1);
}

export function importBackup(text) {
  const data = JSON.parse(text);
  if (data.format !== BACKUP_FORMAT || data.version !== BACKUP_VERSION) throw new Error('This file is not a Chess Trainer backup.');
  return normalizeProgress(data.progress);
}
