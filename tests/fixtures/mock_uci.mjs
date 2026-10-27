// A stand-in UCI engine for tests. It ranks legal moves alphabetically by
// UCI and scores them 50, 40, 30, ... centipawns; the principal variation of
// the top line includes the opponent's alphabetically first reply.
import { createInterface } from 'node:readline';
import { Chess } from '../../vendor/chess.js/chess.js';

let multipv = 1;
let fen = new Chess().fen();
const out = (line) => process.stdout.write(`${line}\n`);
const uci = (move) => move.from + move.to + (move.promotion ?? '');

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line === 'uci') {
    out('id name MockFish 1');
    out('uciok');
  } else if (line === 'isready') out('readyok');
  else if (line.startsWith('setoption name MultiPV value ')) multipv = Number(line.split(' ').at(-1));
  else if (line.startsWith('position fen ')) fen = line.slice('position fen '.length);
  else if (line.startsWith('go')) {
    const chess = new Chess(fen);
    const moves = chess.moves({ verbose: true }).map(uci).sort();
    moves.slice(0, multipv).forEach((move, index) => {
      let pv = move;
      if (index === 0) {
        chess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
        const replies = chess.moves({ verbose: true }).map(uci).sort();
        if (replies.length) pv += ` ${replies[0]}`;
        chess.undo();
      }
      out(`info depth 5 seldepth 7 multipv ${index + 1} score cp ${50 - index * 10} upperbound nodes 10 pv ${move}`);
      out(`info depth 5 seldepth 7 multipv ${index + 1} score cp ${50 - index * 10} nodes 100 pv ${pv}`);
    });
    out(`bestmove ${moves[0]}`);
  } else if (line === 'quit') process.exit(0);
});
