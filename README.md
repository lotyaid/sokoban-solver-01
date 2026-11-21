# Sokoban Solver — push-optimal, room by room

[![make.fun](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/lotyaid/sokoban-solver-01/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/lotyaid/sokoban-solver-01/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)

A push-optimal Sokoban solver built for make.fun's
[Build the best Sokoban solver, 21 November 2026](https://make.fun/bounty/sokoban-solver-01-run-20261121)
bounty ($100 in USDC).

## How it works

The generator's levels are a one-square-wide hallway with one to four
independent rooms hanging off it (3–4 boxes and as many goals each). A box
pushed out of its room can never come back, so each room is solved on its
own and the rooms' optima add up to the level's push-optimal count P*.
Inside a room the solver runs an A* over pushes: a state is the boxes'
squares plus the player's reachable region (named by its lowest square).
The heuristic is the cheapest assignment of boxes to goals by shortest-path
distance, which never overestimates the pushes still needed, so the first
solved state popped is push-optimal. Dead squares (a box there can never
reach a goal, found by pulling back from the goals) and frozen 2x2 blocks
of walls and boxes are pruned; neither prunes a solvable state. Moves are
rebuilt by walking the player to each push square and pushing, room after
room, the player walking on from where the last room left it.

## Results

Practice set (kit): **1,000,000 / 1,000,000** — every instance solved in
exactly P* pushes (i001: 13, i002: 16, i003: 29, i004: 47, i005: 60).
Two further sets drawn fresh from the kit's own generator with random
seeds also scored 1,000,000 with every instance at P*. One run answers
all 5 instances in about 5 seconds (limit: 60 seconds), deterministically.

## Run

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` is the whole entry: one TypeScript file, Node 22, no dependencies.
It reads `$MAKEFUN_INPUT_DIR/<id>/level.txt` (default `/input`) and writes
`$MAKEFUN_OUTPUT_DIR/<id>/solution.txt` (default `/output`) for every
instance in the set.

## License

MIT — see [LICENSE](LICENSE).
