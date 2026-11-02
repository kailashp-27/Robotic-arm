export const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
export const ORDER = [4,0,2,6,8,1,3,5,7];
export const squareName = i => `${'ABC'[Math.floor(i/3)]}${i%3+1}`;

export function result(board) {
  for (const line of LINES) if (board[line[0]] && line.every(i => board[i] === board[line[0]])) {
    return { winner: board[line[0]], line };
  }
  return board.every(Boolean) ? { winner: 'draw', line: [] } : null;
}

export function analyze(board) {
  if (board.length !== 9 || board.some(v => v !== null && v !== 'X' && v !== 'O')) throw new Error('Invalid board');
  const xs = board.filter(v => v === 'X').length, os = board.filter(v => v === 'O').length;
  if (result(board) || xs !== os+1) throw new Error('Analysis requires a live position with O to move');
  const cache = new Map();
  const metrics = { visited: 0, terminals: 0, cacheHits: 0, maxDepth: 0 };
  function search(position, turn, depth) {
    metrics.visited++; metrics.maxDepth = Math.max(metrics.maxDepth, depth);
    const terminal = result(position);
    if (terminal) {
      metrics.terminals++;
      const filled = position.filter(Boolean).length;
      return terminal.winner === 'O' ? 100-filled : terminal.winner === 'X' ? filled-100 : 0;
    }
    const key = position.map(v => v || '-').join('') + turn;
    if (cache.has(key)) { metrics.cacheHits++; return cache.get(key); }
    let value = turn === 'O' ? -Infinity : Infinity;
    for (const index of ORDER) if (!position[index]) {
      position[index] = turn;
      const child = search(position, turn === 'O' ? 'X' : 'O', depth+1);
      position[index] = null;
      value = turn === 'O' ? Math.max(value, child) : Math.min(value, child);
    }
    cache.set(key, value); return value;
  }
  const candidates = ORDER.filter(i => !board[i]).map(index => {
    const next = [...board]; next[index] = 'O';
    return { index, score: search(next, 'X', 1) };
  }).sort((a,b) => b.score-a.score || ORDER.indexOf(a.index)-ORDER.indexOf(b.index));
  const chosen = candidates[0];
  const winsNow = mark => ORDER.filter(i => !board[i]).filter(i => {
    const next = [...board]; next[i] = mark; return result(next)?.winner === mark;
  });
  const outcome = chosen.score > 0 ? 'Forced win' : chosen.score === 0 ? 'Draw with perfect play' : 'Forced loss';
  let title, explanation;
  if (winsNow('O').includes(chosen.index)) {
    title = 'Complete the winning line';
    explanation = `${squareName(chosen.index)} makes three O marks in a row. Winning immediately takes priority over defending.`;
  } else if (winsNow('X').includes(chosen.index)) {
    title = 'Block your winning threat';
    explanation = `You could complete a line at ${squareName(chosen.index)} next turn. O occupies that square to stop it, after checking the remaining continuations.`;
  } else {
    title = chosen.score > 0 ? 'Create a winning continuation' : chosen.score === 0 ? 'Keep a drawing continuation' : 'Choose the strongest remaining reply';
    explanation = `O checks every legal reply and assumes you will always choose your strongest response. ${squareName(chosen.index)} has the best worst-case result: ${outcome.toLowerCase()}.`;
  }
  const ties = candidates.filter(c => c.score === chosen.score).length;
  if (ties > 1) explanation += ` ${ties} moves share the top score; ties prefer center, then corners, then edges.`;
  return { chosen: chosen.index, score: chosen.score, outcome, title, explanation, candidates, metrics };
}

export function humanMove(board, index) {
  if (!Number.isInteger(index) || index < 0 || index > 8 || board[index] || result(board)) throw new Error('Illegal square');
  if (board.filter(v=>v==='X').length !== board.filter(v=>v==='O').length) throw new Error('Wait for O');
  const next = [...board]; next[index] = 'X'; return next;
}
