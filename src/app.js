// Page wiring: board, drill flow, grading buttons, settings, progress and
// backup. Scheduling, queueing and drill rules live in the other modules.
import { Chessground } from '../vendor/chessground/chessground.min.js';
import { Chess } from '../vendor/chess.js/chess.js';
import { Drill } from './drill.js';
import { buildLine, finalAlternatives } from './line.js';
import { counts, newCountToday, nextCard, noteNewCard } from './queue.js';
import { dayStart, depthLimit, formatDelay, grade, newCardState, previewInterval } from './srs.js';
import { exportBackup, importBackup, loadProgress, normalizeSettings, saveProgress } from './storage.js';

const SPEEDS = { slow: 900, normal: 550, fast: 250 };
const MATURE_DAYS = 21;
const $ = (id) => document.getElementById(id);

let deck = [];
let progress = loadProgress(localStorage);
let current = null; // { card, kind, line, drill, chess, state, session }
let session = 0;

const cg = Chessground($('board'), {
  orientation: 'white',
  coordinates: true,
  movable: { free: false, color: undefined, showDests: true, events: { after: onUserMove } },
  premovable: { enabled: false },
  draggable: { showGhost: true },
  highlight: { lastMove: true, check: true },
  animation: { enabled: true, duration: 220 },
  drawable: { enabled: false, visible: true },
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const colorName = (side) => (side === 'w' ? 'White' : 'Black');
const delay = () => SPEEDS[progress.settings.speed] ?? SPEEDS.normal;

function save() {
  saveProgress(localStorage, progress);
}

function legalDests(chess) {
  const dests = new Map();
  for (const move of chess.moves({ verbose: true })) {
    if (!dests.has(move.from)) dests.set(move.from, []);
    dests.get(move.from).push(move.to);
  }
  return dests;
}

function syncBoard(lastMove, shapes = []) {
  const { chess } = current;
  cg.set({
    fen: chess.fen(),
    turnColor: chess.turn() === 'w' ? 'white' : 'black',
    lastMove,
    check: chess.inCheck(),
    movable: { color: undefined, dests: new Map() },
  });
  cg.setAutoShapes(shapes);
}

function enableInput(shapes = []) {
  const { chess, card } = current;
  cg.set({ turnColor: chess.turn() === 'w' ? 'white' : 'black', movable: { color: card.side === 'w' ? 'white' : 'black', dests: legalDests(chess) } });
  cg.setAutoShapes(shapes);
}

function setStatus(text, tone = '') {
  $('status').textContent = text;
  $('status').className = tone;
}

function flash(kind) {
  const wrap = $('board-wrap');
  wrap.classList.remove('flash-good', 'flash-bad');
  void wrap.offsetWidth;
  wrap.classList.add(kind === 'good' ? 'flash-good' : 'flash-bad');
}

function refreshCounts() {
  const c = counts(deck, progress, progress.settings, Date.now());
  $('count-new').textContent = c.new;
  $('count-learning').textContent = c.learning;
  $('count-review').textContent = c.review;
}

function renderLine() {
  const { drill, line } = current;
  const parts = [];
  for (let ply = 0; ply < drill.ply; ply += 1) {
    const label = ply % 2 === 0 ? `${Drill.moveLabel(ply)} ` : '';
    const cls = drill.missedPlies.includes(ply) ? 'missed' : drill.testedPlies.includes(ply) ? 'tested' : '';
    parts.push(`${label}<span class="${cls}">${line[ply].san}</span>`);
  }
  if (!drill.done && drill.ply > 0) parts.push(drill.ply % 2 === 1 ? '…' : `${Drill.moveLabel(drill.ply)} …`);
  $('line').innerHTML = parts.join(' ');
}

function renderDots() {
  const { drill } = current;
  $('depth-dots').innerHTML = drill.testedPlies
    .map((ply) => `<i class="${drill.missedPlies.includes(ply) ? 'wrong' : ply < drill.ply ? 'right' : 'tested'}"></i>`)
    .join('');
}

function renderPrompt() {
  const { card, kind, drill, state } = current;
  const badge = $('card-kind');
  badge.textContent = kind === 'new' ? 'New' : kind === 'learning' ? 'Learning' : 'Review';
  badge.dataset.kind = kind;
  $('card-eco').textContent = `${card.eco} · you play ${colorName(card.side)}`;
  $('card-name').textContent = card.name;
  let task;
  if (state.intro && kind === 'new') task = `New opening: play the move shown by the arrow.`;
  else if (state.intro) task = `Depth ${drill.depth}: the arrow shows the move you now also play.`;
  else if (drill.depth === 1) task = `Play ${colorName(card.side)}'s move that reaches this opening.`;
  else task = `Play your last ${drill.depth} moves of this line.`;
  $('card-task').textContent = task;
  renderDots();
}

function startCard(skipId = null) {
  session += 1;
  const mySession = session;
  $('result').hidden = true;
  $('done').hidden = true;
  setStatus('');
  refreshCounts();
  const now = Date.now();
  let pick = nextCard(deck, progress, progress.settings, now, skipId);
  if (!pick.card && skipId) pick = nextCard(deck, progress, progress.settings, now);
  if (!pick.card) {
    showDone(pick.nextDue);
    return;
  }
  const { card, kind } = pick;
  const state = progress.cards[card.id] ?? newCardState();
  const line = buildLine(card);
  const depth = Math.min(state.depth, depthLimit(line.length, progress.settings));
  const drill = new Drill(line, card.side, depth, { finalAlternatives: finalAlternatives(card, line) });
  if (state.intro) drill.hintPlies = new Set([drill.startPly]);
  current = { card, kind, line, drill, chess: new Chess(), state, session: mySession };
  $('prompt').hidden = false;
  cg.set({ orientation: card.side === 'w' ? 'white' : 'black' });
  syncBoard(undefined);
  renderPrompt();
  renderLine();
  // The prompt's height varies by card, which moves the board; make the
  // board re-measure its position so taps land on the right squares.
  cg.redrawAll();
  runAutoMoves(mySession, true);
}

async function runAutoMoves(mySession, first = false) {
  if (first) await wait(Math.min(400, delay()));
  while (current && current.session === mySession) {
    const { drill, chess } = current;
    const move = drill.nextAutoMove();
    if (!move) break;
    await wait(delay());
    if (!current || current.session !== mySession) return;
    chess.move(move.san);
    drill.advanceAuto();
    syncBoard([move.from, move.to]);
    renderLine();
  }
  if (!current || current.session !== mySession) return;
  const { drill } = current;
  if (drill.isUserTurn()) {
    const expected = drill.expected();
    if (drill.shouldHint()) {
      setStatus(`Play ${Drill.moveLabel(drill.ply)}${expected.san}`, 'info');
      enableInput([{ orig: expected.from, dest: expected.to, brush: 'blue' }]);
    } else {
      setStatus('Your move', 'info');
      enableInput();
    }
  }
}

async function onUserMove(orig, dest) {
  if (!current) return;
  const mySession = current.session;
  const { drill, chess } = current;
  const piece = chess.get(orig);
  const promotion = piece && piece.type === 'p' && (dest[1] === '8' || dest[1] === '1') ? 'q' : '';
  const uci = orig + dest + promotion;
  const before = drill.ply;
  const outcome = drill.submit(uci);
  if (outcome.result === 'correct') {
    const move = chess.move({ from: orig, to: dest, promotion: promotion || undefined });
    syncBoard([orig, dest], [{ orig: dest, brush: 'green' }]);
    flash('good');
    setStatus(outcome.alternative ? `✓ ${move.san} also reaches it` : `✓ ${Drill.moveLabel(before)}${move.san}`, 'good');
    renderLine();
    renderDots();
    if (drill.done) {
      await wait(350);
      if (current && current.session === mySession) finishCard();
    } else {
      runAutoMoves(mySession);
    }
    return;
  }
  flash('bad');
  renderDots();
  cg.set({ movable: { color: undefined, dests: new Map() } });
  cg.setAutoShapes([{ orig: dest, brush: 'red' }]);
  const expected = outcome.move;
  if (outcome.result === 'retry') setStatus('✗ Not this line, try again', 'bad');
  else setStatus(`✗ The move is ${Drill.moveLabel(before)}${expected.san}. Play it to continue.`, 'bad');
  await wait(500);
  if (!current || current.session !== mySession) return;
  const last = before > 0 ? [current.line[before - 1].from, current.line[before - 1].to] : undefined;
  syncBoard(last);
  enableInput(outcome.result === 'reveal' ? [{ orig: expected.from, dest: expected.to, brush: 'green' }] : []);
}

function finishCard() {
  const { card, drill, state, line } = current;
  const now = Date.now();
  const settings = progress.settings;
  cg.set({ movable: { color: undefined, dests: new Map() } });
  const failed = drill.failed;
  if (failed) {
    const missed = drill.missedPlies.map((ply) => `${Drill.moveLabel(ply)}${line[ply].san}`).join(', ');
    $('result-text').textContent = `Missed ${missed}. This card comes back soon.`;
    setStatus('Line complete', 'bad');
  } else {
    $('result-text').textContent = `Correct: ${card.name}.`;
    setStatus('Line complete', 'good');
  }
  $('again-button').hidden = !failed;
  $('good-button').hidden = failed;
  $('easy-button').hidden = failed;
  const label = (result) => {
    const next = grade(state, result, now, line.length, settings);
    const delayLabel = previewInterval(state, result, now, line.length, settings);
    return next.depth > state.depth ? `${delayLabel} · +1 move` : delayLabel;
  };
  $('again-button').querySelector('small').textContent = label('again');
  $('good-button').querySelector('small').textContent = label('good');
  $('easy-button').querySelector('small').textContent = label('easy');
  $('result').hidden = false;
  (failed ? $('again-button') : $('good-button')).focus({ preventScroll: true });
}

function answer(result) {
  if (!current || $('result').hidden) return;
  const { card, drill, state, line } = current;
  const now = Date.now();
  const next = grade(state, result, now, line.length, progress.settings);
  for (const ply of drill.missedPlies) next.misses[ply] = (next.misses[ply] ?? 0) + 1;
  if (state.state === 'new') progress = noteNewCard(progress, now);
  progress.cards[card.id] = next;
  save();
  startCard(card.id);
}

function showDone(nextDue) {
  current = null;
  cg.set({ movable: { color: undefined, dests: new Map() } });
  cg.setAutoShapes([]);
  $('result').hidden = true;
  $('prompt').hidden = true;
  $('line').textContent = '';
  setStatus('');
  const now = Date.now();
  const { settings } = progress;
  const parts = [];
  if (settings.newPerDay != null && newCountToday(progress, now) >= settings.newPerDay) parts.push(`You've reached today's limit of ${settings.newPerDay} new cards. You can change it in Settings.`);
  else if (counts(deck, progress, settings, now).unseen === 0) parts.push('You have started every opening in this deck.');
  if (nextDue) parts.push(`Next card ${new Date(nextDue).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} (in ${formatDelay(nextDue - now)}).`);
  $('done-text').textContent = parts.join(' ');
  $('done').hidden = false;
}

// Settings dialog.
function openSettings() {
  const s = progress.settings;
  $('setting-new').value = s.newPerDay ?? '';
  $('setting-depth').value = s.maxDepth;
  $('setting-promote').value = s.promoteAfter;
  $('setting-side').value = s.side;
  $('setting-speed').value = s.speed;
  $('settings-dialog').showModal();
}

$('settings-dialog').addEventListener('close', () => {
  if ($('settings-dialog').returnValue !== 'save') return;
  const before = progress.settings;
  progress.settings = normalizeSettings({
    newPerDay: $('setting-new').value,
    maxDepth: $('setting-depth').value,
    promoteAfter: $('setting-promote').value,
    side: $('setting-side').value,
    speed: $('setting-speed').value,
  });
  save();
  const after = progress.settings;
  if (!current || before.side !== after.side || before.maxDepth !== after.maxDepth || before.newPerDay !== after.newPerDay) startCard();
  else refreshCounts();
});

async function exportProgress() {
  const now = Date.now();
  const name = `chess-trainer-backup-${new Date(now).toISOString().slice(0, 10)}.json`;
  const file = new File([exportBackup(progress, now)], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Chess Trainer backup' });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

$('import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const imported = importBackup(await file.text());
    const started = Object.keys(imported.cards).length;
    if (!confirm(`Replace the progress on this device with the backup (${started} cards started)?`)) return;
    progress = imported;
    save();
    $('settings-dialog').close();
    startCard();
  } catch (error) {
    alert(`Could not import: ${error.message}`);
  }
});

$('reset-button').addEventListener('click', () => {
  if (!confirm('Delete all progress on this device? Export a backup first if you might want it back.')) return;
  progress = { cards: {}, daily: null, settings: progress.settings };
  save();
  $('settings-dialog').close();
  startCard();
});

// Progress dialog.
function openStats() {
  const now = Date.now();
  const byId = new Map(deck.map((card) => [card.id, card]));
  let started = 0, learning = 0, young = 0, mature = 0, fullDepth = 0, dueTomorrow = 0;
  const weak = [];
  for (const [id, state] of Object.entries(progress.cards)) {
    const card = byId.get(id);
    if (!card || state.state === 'new') continue;
    started += 1;
    if (state.state === 'review') {
      if (state.interval >= MATURE_DAYS) mature += 1;
      else young += 1;
    } else learning += 1;
    const plies = card.moves.split(' ').length;
    if (state.depth >= depthLimit(plies, progress.settings)) fullDepth += 1;
    if (state.due < dayStart(now, 2)) dueTomorrow += 1;
    const missCount = Object.values(state.misses ?? {}).reduce((a, b) => a + b, 0);
    if (state.lapses || missCount) weak.push({ card, lapses: state.lapses, missCount });
  }
  const rows = [
    ['Openings in deck', deck.length],
    ['Started', started],
    ['Learning', learning],
    ['Young (interval under 21 days)', young],
    ['Mature (21 days or more)', mature],
    ['At full depth', fullDepth],
    ['Due by end of tomorrow', dueTomorrow],
    ['New cards today', newCountToday(progress, now)],
  ];
  $('stats-table').innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  weak.sort((a, b) => b.lapses - a.lapses || b.missCount - a.missCount);
  const list = $('weakest');
  list.innerHTML = '';
  if (!weak.length) list.innerHTML = '<li>No misses yet.</li>';
  for (const { card, lapses, missCount } of weak.slice(0, 10)) {
    const item = document.createElement('li');
    item.textContent = `${card.name} (${colorName(card.side)})`;
    const note = document.createElement('small');
    note.textContent = `${lapses} ${lapses === 1 ? 'lapse' : 'lapses'} · ${missCount} missed ${missCount === 1 ? 'move' : 'moves'}`;
    item.append(note);
    list.append(item);
  }
  $('stats-dialog').showModal();
}

$('settings-button').addEventListener('click', openSettings);
$('stats-button').addEventListener('click', openStats);
$('export-button').addEventListener('click', exportProgress);
$('import-button').addEventListener('click', () => $('import-file').click());
$('again-button').addEventListener('click', () => answer('again'));
$('good-button').addEventListener('click', () => answer('good'));
$('easy-button').addEventListener('click', () => answer('easy'));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !deck.length) return;
  if (!current) startCard();
  else refreshCounts();
});

async function init() {
  try {
    const response = await fetch('data/openings.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    deck = (await response.json()).cards;
  } catch (error) {
    $('card-name').textContent = 'Could not load the openings.';
    setStatus(error.message, 'bad');
    return;
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  startCard();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
init();
