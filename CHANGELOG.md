# Changelog

What changed in Late, and why. Versions after 0.1 come from the improvement loop: we run
generated days through the solver and the autopilot (`node tools/sweep.js`), look for days that
are trivial, unfair or dull, change the generator or the rules, and measure again.

## 0.1.0 — first playable version

- The whole pipeline, from a seed and difficulty parameters: an octilinear metro network (A* on a
  grid, interchanges where lines meet, a hub of three or more lines), station interiors as
  multi-level cross-sections (street, concourse with fare gates, platforms, passages; stairs,
  escalators that can reverse on a timer, lifts), hubs built from several linked blocks in four
  flavours (sprawl, maze, split, deep), corridor types (two-way, one-way, opposing lanes),
  timetables (regular and irregular), checkpoints and closures placed on the best route, and a
  start time chosen so the best route arrives with the day's slack.
- The winnable check: a time-dependent solver finds the best route with worst-case checkpoint
  queues; a static reachability check finds dead ends; failing attempts are regenerated.
- A deterministic tick simulation of the rules, an autopilot that plays it, and a browser game
  drawn on a canvas with the team's sprites: morning briefing, the commute, trains, the result
  with an excuse to the boss, a shop between days and a week summary.
- A five-day week where the display policy shows less each day and the generator adds checkpoints.
