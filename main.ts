// Lotya's Sokoban solver for make.fun's "Build the best Sokoban solver, 21 November 2026"
// (sokoban-solver-01-run-20261121). One program, Node 22, no dependencies.
//
// Idea: the generator's levels are a 1-wide hallway with 1-4 independent rooms
// hanging off it (3-4 boxes and as many goals each). A box pushed out of its room
// can never come back, so each room is solved on its own and the rooms' optima
// add up to the level's push-optimal count P*. Inside a room we run an A* over
// pushes: a state is the boxes' squares plus the player's reachable region
// (named by its lowest square). The heuristic is the cheapest assignment of
// boxes to goals by shortest-path distance, which never overestimates the
// pushes still needed, so the first solved state popped is push-optimal.
// Dead squares (a box there can never reach a goal, found by pulling back
// from the goals) and frozen 2x2 blocks of walls/boxes are pruned: neither
// prunes a solvable state. Moves are rebuilt by walking the player to each
// push square and pushing, room after room, the player walking on from where
// the last room left it.
//
// I/O contract (kit): levels at $MAKEFUN_INPUT_DIR/<id>/level.txt (default
// /input), answers at $MAKEFUN_OUTPUT_DIR/<id>/solution.txt (default
// /output), one run answers all 5 instances, deterministic output.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
/** Most states one room search keeps before it gives up (same cap the kit's reference uses). */
const MAX_STATES = 250_000;

interface Dir {
  dx: number;
  dy: number;
  step: string;
  push: string;
}
const DIRS: Dir[] = [
  { dx: 0, dy: -1, step: 'u', push: 'U' },
  { dx: 0, dy: 1, step: 'd', push: 'D' },
  { dx: -1, dy: 0, step: 'l', push: 'L' },
  { dx: 1, dy: 0, step: 'r', push: 'R' },
];

interface Level {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

interface Room {
  squares: number[];
  boxes: number[];
  goals: number[];
  done: boolean;
}

/** Parse XSB text. Short rows and the outermost frame count as walls. */
function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  return { w, h, wall, goals, boxes: boxes.sort((a, b) => a - b), player };
}

/** Squares from which a box alone can be pushed onto some goal (pulled back from the goals over open floor). */
function liveSquares(level: Level): Uint8Array {
  const { w, wall, goals } = level;
  const live = new Uint8Array(wall.length);
  const queue = [...goals];
  for (const g of goals) live[g] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi]!;
    for (const d of DIRS) {
      const step = d.dy * w + d.dx;
      const y = x - step;
      if (!wall[y] && !wall[y - step] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/** Flood the player's reachable region from `from` (walls and boxes block); returns its lowest square. */
function regionLow(
  level: Level,
  occupied: Uint8Array,
  from: number,
  seen: Int32Array,
  stamp: number,
  stack: Int32Array,
): number {
  const { w, wall } = level;
  let low = from;
  let n = 0;
  stack[n++] = from;
  seen[from] = stamp;
  while (n > 0) {
    const p = stack[--n]!;
    if (p < low) low = p;
    for (const d of DIRS) {
      const q = p + d.dy * w + d.dx;
      if (wall[q] === 0 && occupied[q] === 0 && seen[q] !== stamp) {
        seen[q] = stamp;
        stack[n++] = q;
      }
    }
  }
  return low;
}

/** True when the box just pushed to `t` sits in a frozen 2x2 block of walls and boxes with a box off its goal. */
function frozenBlock(level: Level, occupied: Uint8Array, goal: Uint8Array, t: number): boolean {
  const { w, wall } = level;
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (!(wall[a] || occupied[a]) || !(wall[b] || occupied[b]) || !(wall[c] || occupied[c]) || !(wall[d] || occupied[d])) continue;
    if ((occupied[a] && !goal[a]) || (occupied[b] && !goal[b]) || (occupied[c] && !goal[c]) || (occupied[d] && !goal[d])) return true;
  }
  return false;
}

/** Shortest walk from `from` to `to` around walls and boxes, lower-case LURD (first direction first on ties). */
function walkTo(level: Level, occupied: Uint8Array, from: number, to: number): string {
  const { w, wall } = level;
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const how = new Array<string>(wall.length);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]!;
    if (p === to) break;
    for (const d of DIRS) {
      const q = p + d.dy * w + d.dx;
      if (wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = d.step;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walkTo: the push square is out of reach');
  let s = '';
  for (let p = to; p !== from; p = prev[p]!) s = how[p]! + s;
  return s;
}

/** The square the player stands on after `moves` (case aside) from `from` on a board `w` wide. */
function endOf(w: number, from: number, moves: string): number {
  let p = from;
  for (const ch of moves.toLowerCase()) p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  return p;
}

/**
 * Push-optimal solution of `level`: {pushes, moves} (lower letter a step, upper
 * a push), or null when the search gives up. A* over pushes with the cheapest
 * box-to-goal assignment as its heuristic; dead-square and frozen-block pruning.
 */
function solvePushOptimal(level: Level, maxStates = MAX_STATES): { pushes: number; moves: string } | null {
  const { w, wall, goals } = level;
  const size = wall.length;
  const n = level.boxes.length;
  const goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const live = liveSquares(level);
  const solved = (boxes: number[]): boolean => boxes.every((b) => goal[b]);
  if (level.boxes.some((b) => !live[b])) return null;
  if (solved(level.boxes)) return { pushes: 0, moves: '' };

  // Grid distances from every goal (BFS over open floor): cost[box][goal].
  const distFromGoal: Int32Array[] = goals.map((g) => {
    const dist = new Int32Array(size).fill(-1);
    const queue = [g];
    dist[g] = 0;
    for (let qi = 0; qi < queue.length; qi++) {
      const p = queue[qi]!;
      for (const d of DIRS) {
        const q = p + d.dy * w + d.dx;
        if (!wall[q] && dist[q] === -1) {
          dist[q] = dist[p]! + 1;
          queue.push(q);
        }
      }
    }
    return dist;
  });
  // Cheapest assignment of boxes to goals (exact permutation for small rooms,
  // sum of per-box minima when there are too many boxes to permute).
  const heuristic = (boxes: number[]): number => {
    if (n <= 5) {
      const order = goals.map((_, i) => i);
      let best = Infinity;
      const permute = (k: number): void => {
        if (k === n) {
          let sum = 0;
          for (let i = 0; i < n; i++) {
            const d = distFromGoal[order[i]!]![boxes[i]!]!;
            if (d < 0) return;
            sum += d;
          }
          if (sum < best) best = sum;
          return;
        }
        for (let i = k; i < n; i++) {
          [order[k], order[i]] = [order[i]!, order[k]!];
          permute(k + 1);
          [order[k], order[i]] = [order[i]!, order[k]!];
        }
      };
      permute(0);
      return best === Infinity ? 1e9 : best;
    }
    let sum = 0;
    for (const b of boxes) {
      let m = Infinity;
      for (let gi = 0; gi < goals.length; gi++) {
        const d = distFromGoal[gi]![b]!;
        if (d >= 0 && d < m) m = d;
      }
      if (m === Infinity) return 1e9;
      sum += m;
    }
    return sum;
  };

  const occupied = new Uint8Array(size);
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;
  const useNumericKey = n <= 5;
  const keyOf = (boxes: number[], low: number): number | string => {
    if (!useNumericKey) return `${low}|${boxes.join(',')}`;
    let k = low;
    for (const b of boxes) k = k * size + b;
    return k;
  };

  // States in discovery order: boxes, player square after the push, g, parent, push, and the state's key.
  const statesBoxes: number[][] = [level.boxes];
  const statesPlayer: number[] = [level.player];
  const statesG: number[] = [0];
  const statesKey: (number | string)[] = [];
  const parent: number[] = [-1];
  const pushDir: number[] = [-1];
  const pushFrom: number[] = [-1];
  const best = new Map<number | string, number>();
  for (const b of level.boxes) occupied[b] = 1;
  const startLow = regionLow(level, occupied, level.player, seen, ++stamp, stack);
  for (const b of level.boxes) occupied[b] = 0;
  statesKey.push(keyOf(level.boxes, startLow));
  best.set(statesKey[0]!, 0);
  // Binary heap of [f, g, sequence, state]; ties break by earlier discovery, so runs are deterministic.
  const heap: [number, number, number, number][] = [];
  let seq = 0;
  const heapLess = (a: [number, number, number, number], b: [number, number, number, number]): boolean =>
    a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
  const heapPush = (e: [number, number, number, number]): void => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!heapLess(heap[i]!, heap[p]!)) break;
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const heapPop = (): [number, number, number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heapLess(heap[c + 1]!, heap[c]!)) c++;
        if (!heapLess(heap[c]!, heap[i]!)) break;
        [heap[i], heap[c]] = [heap[c]!, heap[i]!];
        i = c;
      }
    }
    return top;
  };
  heapPush([heuristic(level.boxes), 0, seq++, 0]);

  let found = -1;
  while (heap.length > 0) {
    const [, g, , s] = heapPop();
    // A cheaper route to this box arrangement was found since: skip the stale entry.
    if (best.get(statesKey[s]!) !== s || statesG[s] !== g) continue;
    const boxes = statesBoxes[s]!;
    if (solved(boxes)) {
      found = s;
      break;
    }
    if (statesBoxes.length >= maxStates) break;
    for (const b of boxes) occupied[b] = 1;
    regionLow(level, occupied, statesPlayer[s]!, seen, ++stamp, stack);
    const here = stamp;
    for (let bi = 0; bi < boxes.length; bi++) {
      const b = boxes[bi]!;
      for (let di = 0; di < DIRS.length; di++) {
        const d = DIRS[di]!;
        const step = d.dy * w + d.dx;
        const t = b + step;
        if (seen[b - step] !== here || wall[t] || occupied[t] || !live[t]) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        const frozen = frozenBlock(level, occupied, goal, t);
        let key: number | string = -1;
        let next: number[] | null = null;
        if (!frozen) {
          next = boxes.slice();
          next[bi] = t;
          next.sort((a, x) => a - x);
          key = keyOf(next, regionLow(level, occupied, b, mark, ++stamp, stack));
        }
        occupied[t] = 0;
        occupied[b] = 1;
        if (frozen || next === null) continue;
        const ng = g + 1;
        const prevBest = best.get(key);
        if (prevBest !== undefined && statesG[prevBest]! <= ng) continue;
        const idx = statesBoxes.length;
        best.set(key, idx);
        statesKey.push(key);
        statesBoxes.push(next);
        statesPlayer.push(b);
        statesG.push(ng);
        parent.push(s);
        pushDir.push(di);
        pushFrom.push(b);
        heapPush([ng + heuristic(next), ng, seq++, idx]);
      }
    }
    for (const x of boxes) occupied[x] = 0;
  }
  if (found < 0) return null;

  const path: number[] = [];
  for (let s = found; s > 0; s = parent[s]!) path.push(s);
  path.reverse();
  let moves = '';
  let player = level.player;
  let boxes = level.boxes;
  for (const s of path) {
    const nextBoxes = statesBoxes[s]!;
    const from = pushFrom[s]!;
    const di = pushDir[s]!;
    const d = DIRS[di]!;
    for (const b of boxes) occupied[b] = 1;
    moves += walkTo(level, occupied, player, from - (d.dy * w + d.dx));
    for (const b of boxes) occupied[b] = 0;
    moves += d.push;
    player = from;
    boxes = nextBoxes;
  }
  return { pushes: path.length, moves };
}

/**
 * The level's rooms: cut the dead squares of the player's row (the hallway: a
 * box there reaches no goal) out of the floor, and each part left that holds a
 * box is a room. Null when some part holds more or fewer boxes than goals, or
 * a box starts in the hallway: then the level is no set of rooms.
 */
function roomsOf(level: Level): Room[] | null {
  const { w, wall, goals, boxes, player } = level;
  const live = liveSquares(level);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) if (!wall[i] && !live[i]) cut[i] = 1;
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms: Room[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const d of DIRS) {
        const q = squares[i]! + d.dy * w + d.dx;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [], done: false });
  }
  for (const b of boxes) rooms[part[b]!]!.boxes.push(b);
  for (const g of goals) if (part[g]! >= 0) rooms[part[g]!]!.goals.push(g);
  if (goals.some((g) => part[g]! < 0) || rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/**
 * Solve a level room by room: each room's push-optimal solution in turn, the
 * other rooms' boxes standing as walls (on their goals once their room is
 * done), the player walking on from where the last room left it. Falls back
 * to solving the whole level at once when it is no set of rooms.
 */
function solveLevel(level: Level): string {
  const rooms = roomsOf(level);
  if (rooms !== null) {
    let player = level.player;
    let moves = '';
    for (const room of rooms) {
      const wall = level.wall.slice();
      for (const other of rooms) {
        if (other === room) continue;
        for (const b of other.done ? other.goals : other.boxes) wall[b] = 1;
      }
      const sub: Level = {
        w: level.w,
        h: level.h,
        wall,
        goals: room.goals.slice().sort((a, b) => a - b),
        boxes: room.boxes.slice().sort((a, b) => a - b),
        player,
      };
      const solved = solvePushOptimal(sub);
      if (solved === null) return solveWhole(level);
      moves += solved.moves;
      player = endOf(level.w, player, solved.moves);
      room.done = true;
    }
    return moves;
  }
  return solveWhole(level);
}

/** Whole-level fallback (also used when a room search gives up). */
function solveWhole(level: Level): string {
  const solved = solvePushOptimal(level);
  return solved === null ? '' : solved.moves;
}

function solve(text: string): string {
  return solveLevel(parseLevel(text));
}

for (const id of readdirSync(INPUT_DIR).sort()) {
  const moves = solve(readFileSync(join(INPUT_DIR, id, 'level.txt'), 'utf8'));
  mkdirSync(join(OUTPUT_DIR, id), { recursive: true });
  writeFileSync(join(OUTPUT_DIR, id, 'solution.txt'), `${moves}\n`);
}
