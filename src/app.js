// Page wiring: board, Learn and Free play flows, grading buttons, settings,
// progress and backup. Scheduling, queueing, drill and free-play rules live
// in the other modules.
import { Chessground } from '../vendor/chessground/chessground.min.js';
import { Chess } from '../vendor/chess.js/chess.js';
import { Drill } from './drill.js';
import { emptyFreeStats, formatScore, FreePlay, pickPuzzle, recordFreePlay } from './freeplay.js';
import { buildLine, finalAlternatives } from './line.js';
import { counts, newCountToday, nextCard, noteNewCard } from './queue.js';
import { dayStart, depthLimit, formatDelay, grade, newCardState } from './srs.js';
import { exportBackup, importBackup, loadProgress, normalizeSettings, saveProgress } from './storage.js';

const SPEEDS = { slow: 900, normal: 550, fast: 250 };
const MATURE_DAYS = 21;
const AUTO_NEXT_MS = 1200;
const $ = (id) => document.getElementById(id);

let deck = [];
let progress = loadProgress(localStorage);
// Learn: { mode, card, kind, line, drill, chess, side, state, session }
// Free play: { mode, puzzle, game, chess, side, session }
let current = null;
let freePuzzles = null;
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
  const { chess, side } = current;
  cg.set({ turnColor: chess.turn() === 'w' ? 'white' : 'black', movable: { color: side === 'w' ? 'white' : 'black', dests: legalDests(chess) } });
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
  const free = progress.settings.mode === 'free';
  $('learn-counts').hidden = free;
  $('free-counts').hidden = !free;
  if (free) {
    const stats = progress.freeplay;
    $('free-solved').textContent = stats.solved;
    $('free-attempted').textContent = stats.attempted;
    $('free-streak').textContent = stats.streak;
    return;
  }
  const c = counts(deck, progress, progress.settings, Date.now());
  $('count-new').textContent = c.new;
  $('count-learning').textContent = c.learning;
  $('count-review').textContent = c.review;
}

function hidePanels() {
  $('result').hidden = true;
  $('free-result').hidden = true;
  $('done').hidden = true;
}

function start(skipId = null) {
  cg.set({ movable: { color: undefined, dests: new Map() } });
  cg.setAutoShapes([]);
  if (progress.settings.mode === 'free') startFree(skipId);
  else startCard(skipId);
}

function setMode(mode) {
  for (const tab of document.querySelectorAll('#mode-tabs button')) tab.setAttribute('aria-pressed', String(tab.dataset.mode === mode));
  if (progress.settings.mode === mode && current) return;
  progress.settings = { ...progress.settings, mode };
  save();
  start();
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
  hidePanels();
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
  current = { mode: 'learn', card, kind, line, drill, chess: new Chess(), side: card.side, state, session: mySession };
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

function onUserMove(orig, dest) {
  if (!current) return;
  if (current.mode === 'free') onFreeMove(orig, dest);
  else onLearnMove(orig, dest);
}

function promotionFor(chess, orig, dest) {
  const piece = chess.get(orig);
  return piece && piece.type === 'p' && (dest[1] === '8' || dest[1] === '1') ? 'q' : '';
}

async function onLearnMove(orig, dest) {
  const mySession = current.session;
  const { drill, chess } = current;
  const promotion = promotionFor(chess, orig, dest);
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

// A correct line is graded Good and the next card follows automatically; a
// missed line is graded Again and waits for Next so the miss can be read.
function finishCard() {
  const { card, drill, state, line, session: mySession } = current;
  cg.set({ movable: { color: undefined, dests: new Map() } });
  const now = Date.now();
  const next = recordAnswer(drill.failed ? 'again' : 'good', now);
  const when = formatDelay(next.due - now);
  if (drill.failed) {
    const missed = drill.missedPlies.map((ply) => `${Drill.moveLabel(ply)}${line[ply].san}`).join(', ');
    $('result-text').textContent = `Missed ${missed}. This card comes back in ${when}.`;
    setStatus('Line complete', 'bad');
    $('result').hidden = false;
    $('next-button').focus({ preventScroll: true });
    return;
  }
  const grew = next.depth > state.depth ? ' with one more move' : '';
  setStatus(`✓ Correct · back in ${when}${grew}`, 'good');
  setTimeout(() => {
    if (current && current.session === mySession) startCard(card.id);
  }, AUTO_NEXT_MS);
}

function recordAnswer(result, now) {
  const { card, drill, state, line } = current;
  const next = grade(state, result, now, line.length, progress.settings);
  for (const ply of drill.missedPlies) next.misses[ply] = (next.misses[ply] ?? 0) + 1;
  if (state.state === 'new') progress = noteNewCard(progress, now);
  progress.cards[card.id] = next;
  save();
  return next;
}

function showDone(nextDue) {
  current = null;
  cg.set({ movable: { color: undefined, dests: new Map() } });
  cg.setAutoShapes([]);
  hidePanels();
  $('done-title').textContent = 'All caught up';
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

// Free play.
async function loadFreePuzzles() {
  if (!freePuzzles) {
    const response = await fetch('data/freeplay.json');
    if (response.status === 404) throw new Error('not built yet');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    freePuzzles = (await response.json()).puzzles;
  }
  return freePuzzles;
}

function showFreeUnavailable(text) {
  current = null;
  cg.set({ movable: { color: undefined, dests: new Map() } });
  cg.setAutoShapes([]);
  hidePanels();
  $('prompt').hidden = true;
  $('line').textContent = '';
  setStatus('');
  $('done-title').textContent = 'Free play';
  $('done-text').textContent = text;
  $('done').hidden = false;
}

async function startFree(skipId = null) {
  session += 1;
  const mySession = session;
  hidePanels();
  setStatus('');
  refreshCounts();
  try {
    await loadFreePuzzles();
  } catch (error) {
    if (session !== mySession) return;
    if (error.message === 'not built yet') showFreeUnavailable("Free play positions aren't available yet. Check back later today.");
    else showFreeUnavailable(`Free play positions could not be loaded (${error.message}).`);
    return;
  }
  if (session !== mySession) return;
  const puzzle = pickPuzzle(freePuzzles, progress.freeplay, progress.settings.side, Math.random, skipId);
  if (!puzzle) {
    showFreeUnavailable('No free play positions match the side chosen in Settings.');
    return;
  }
  const game = new FreePlay(puzzle);
  const chess = new Chess();
  puzzle.moves.split(' ').forEach((san) => chess.move(san));
  current = { mode: 'free', puzzle, game, chess, side: game.side, session: mySession };
  $('prompt').hidden = false;
  cg.set({ orientation: game.side === 'w' ? 'white' : 'black' });
  syncBoard(lastMoveSquares(chess));
  renderFreePrompt();
  renderFreeLine();
  cg.redrawAll();
  setStatus(`${colorName(game.side)} to move`, 'info');
  enableInput();
}

function renderFreePrompt() {
  const { puzzle, game } = current;
  const badge = $('card-kind');
  badge.textContent = 'Free play';
  badge.dataset.kind = 'free';
  $('card-eco').textContent = `${puzzle.eco} · you play ${colorName(game.side)}`;
  $('card-name').textContent = puzzle.name;
  const total = puzzle.steps.length;
  $('card-task').textContent = game.done
    ? 'Done.'
    : `Find the engine's best move${total > 1 ? ` (${game.step + 1} of ${total})` : ''}.`;
  $('depth-dots').innerHTML = puzzle.steps
    .map((_, index) => {
      const result = game.results[index];
      const cls = result ? (result.verdict === 'miss' ? 'wrong' : 'right') : 'tested';
      return `<i class="${cls}"></i>`;
    })
    .join('');
}

function renderFreeLine() {
  const { chess, puzzle } = current;
  const start = puzzle.moves.split(' ').length;
  const parts = chess.history().map((san, ply) => {
    const label = ply % 2 === 0 ? `${Drill.moveLabel(ply)} ` : '';
    return `${label}<span class="${ply >= start ? 'tested' : ''}">${san}</span>`;
  });
  $('line').innerHTML = parts.join(' ');
}

function lastMoveSquares(chess) {
  const last = chess.history({ verbose: true }).at(-1);
  return last ? [last.from, last.to] : undefined;
}

function moveSquares(chess, san) {
  const move = chess.move(san);
  chess.undo();
  return { orig: move.from, dest: move.to };
}

async function onFreeMove(orig, dest) {
  const mySession = current.session;
  const { game, chess } = current;
  const promotion = promotionFor(chess, orig, dest);
  const san = chess.move({ from: orig, to: dest, promotion: promotion || undefined }).san;
  chess.undo();
  const stepIndex = game.step;
  const outcome = game.submit(san);
  const alive = () => current && current.session === mySession;

  if (outcome.verdict === 'best' || outcome.verdict === 'continue') {
    chess.move(san);
    syncBoard([orig, dest], [{ orig: dest, brush: 'green' }]);
    if (outcome.verdict === 'best') {
      flash('good');
      setStatus(`✓ Best move: ${san} (${formatScore(outcome.score)})`, 'good');
    }
    renderFreePrompt();
    renderFreeLine();
    afterFreeStep(stepIndex, mySession);
    return;
  }
  if (outcome.verdict === 'good') {
    chess.move(san);
    syncBoard([orig, dest], [{ orig: dest, brush: 'green' }]);
    flash('good');
    setStatus(`✓ ${san} is good (${formatScore(outcome.score)}). Engine's top: ${outcome.best} (${formatScore(outcome.bestScore)}). Continuing from there.`, 'good');
    renderFreePrompt();
    renderFreeLine();
    await wait(1600);
    if (!alive()) return;
    chess.undo();
    const best = chess.move(outcome.best);
    syncBoard([best.from, best.to]);
    renderFreeLine();
    afterFreeStep(stepIndex, mySession);
    return;
  }
  // A miss, or another wrong move after a miss.
  flash('bad');
  cg.set({ movable: { color: undefined, dests: new Map() } });
  cg.setAutoShapes([{ orig: dest, brush: 'red' }]);
  if (outcome.verdict === 'miss') {
    const played = outcome.ranked ? `${san} (${formatScore(outcome.score)})` : `${san} is not in the engine's top 8`;
    setStatus(`✗ ${played}. Best: ${outcome.best} (${formatScore(outcome.bestScore)}). Play it to continue.`, 'bad');
    renderFreePrompt();
  } else {
    setStatus(`✗ Play ${outcome.best} to continue.`, 'bad');
  }
  await wait(500);
  if (!alive()) return;
  syncBoard(lastMoveSquares(chess));
  enableInput([{ ...moveSquares(chess, outcome.best), brush: 'green' }]);
}

async function afterFreeStep(stepIndex, mySession) {
  const { game, chess } = current;
  const reply = game.replyAfter(stepIndex);
  if (!reply || game.done) {
    await wait(700);
    if (current && current.session === mySession) finishFree();
    return;
  }
  await wait(Math.max(delay(), 600));
  if (!current || current.session !== mySession) return;
  const move = chess.move(reply);
  syncBoard([move.from, move.to]);
  renderFreeLine();
  renderFreePrompt();
  setStatus(`Opponent played ${move.san}. Your move.`, 'info');
  enableInput();
}

function finishFree() {
  const { game, puzzle } = current;
  cg.set({ movable: { color: undefined, dests: new Map() } });
  progress.freeplay = recordFreePlay(progress.freeplay, game, Date.now());
  save();
  refreshCounts();
  const missed = game.results.filter((result) => result.verdict === 'miss').length;
  const total = game.results.length;
  $('free-result-text').textContent = missed ? `Missed ${missed} of ${total}.` : `Solved: all ${total} found.`;
  setStatus(missed ? 'Position complete' : '✓ Solved', missed ? 'bad' : 'good');
  const startPly = puzzle.moves.split(' ').length;
  const list = $('free-steps');
  list.innerHTML = '';
  game.results.forEach((result, index) => {
    const item = document.createElement('li');
    const verdict = document.createElement('span');
    verdict.className = result.verdict;
    const word = result.verdict === 'miss' ? 'missed' : result.verdict;
    verdict.textContent = `${Drill.moveLabel(startPly + index * 2)}${result.played} ${word}`;
    const note = document.createElement('small');
    const yours = result.score == null ? 'not in top 8' : formatScore(result.score);
    note.textContent = result.verdict === 'best' ? ` ${yours}` : ` ${yours} · best ${result.best} ${formatScore(result.bestScore)}`;
    item.append(verdict, note);
    list.append(item);
  });
  $('free-result').hidden = false;
  $('next-free-button').focus({ preventScroll: true });
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
    mode: before.mode,
  });
  save();
  const after = progress.settings;
  if (after.mode === 'free') {
    if (!current || before.side !== after.side) startFree();
  } else if (!current || before.side !== after.side || before.maxDepth !== after.maxDepth || before.newPerDay !== after.newPerDay) startCard();
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
    current = null;
    setMode(progress.settings.mode);
  } catch (error) {
    alert(`Could not import: ${error.message}`);
  }
});

$('reset-button').addEventListener('click', () => {
  if (!confirm('Delete all progress on this device? Export a backup first if you might want it back.')) return;
  progress = { cards: {}, daily: null, settings: progress.settings, freeplay: emptyFreeStats() };
  save();
  $('settings-dialog').close();
  start();
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
  const free = progress.freeplay;
  const percent = free.attempted ? ` (${Math.round((100 * free.solved) / free.attempted)}%)` : '';
  $('free-stats-table').innerHTML = [
    ['Positions played', free.attempted],
    ['Solved', `${free.solved}${percent}`],
    ['Current streak', free.streak],
    ['Best streak', free.bestStreak],
  ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  const misses = $('free-misses');
  misses.innerHTML = '';
  if (!free.recent.length) misses.innerHTML = '<li>No misses yet.</li>';
  for (const miss of free.recent.slice(0, 10)) {
    const item = document.createElement('li');
    item.textContent = miss.name;
    const note = document.createElement('small');
    note.textContent = `played ${miss.played}, best ${miss.best}`;
    item.append(note);
    misses.append(item);
  }
  $('stats-dialog').showModal();
}

$('settings-button').addEventListener('click', openSettings);
$('stats-button').addEventListener('click', openStats);
$('export-button').addEventListener('click', exportProgress);
$('import-button').addEventListener('click', () => $('import-file').click());
$('next-button').addEventListener('click', () => {
  if (current && current.mode === 'learn') startCard(current.card.id);
});
$('next-free-button').addEventListener('click', () => startFree(current?.puzzle?.id ?? null));
for (const tab of document.querySelectorAll('#mode-tabs button')) tab.addEventListener('click', () => setMode(tab.dataset.mode));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !deck.length) return;
  if (!current && progress.settings.mode === 'learn') startCard();
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
  setMode(progress.settings.mode);
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
init();
