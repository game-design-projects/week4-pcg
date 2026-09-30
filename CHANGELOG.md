# Changelog

What changed in Late, and why. Versions after 0.1 come from the improvement loop: we run
generated days through the solver and the autopilot (`node tools/sweep.js`), look for days that
are trivial, unfair or dull, change the generator or the rules, and measure again.

## 0.3.0 — second loop: generate less waste, meet the checkpoints, explain lost days

Same 40 seeds per weekday; report in [`docs/sweeps/0.3.md`](docs/sweeps/0.3.md).

**Wasteful: whole days were thrown away over one checkpoint.** In 0.2 the most common reasons to discard an
attempt were "the route no longer goes through the hub" and "wrong number of transfers" *after* checkpoints and
closures were placed (67 of the discarded attempts), and Friday needed 2.5 attempts per day. Two causes: a
checkpoint that bent the route was kept anyway, and the day's shape was judged on the worst-case route, which
swerves away from any queue it can.
→ Placements are now repaired instead: up to six candidate spots are tried, and one is only kept if the day
still has its shape. The shape (hub on route, number of transfers, now allowed one more transfer after trouble
is placed) is judged on the route a typical commuter takes with average queues; the worst-case route stays the
winnability guarantee. Routes through stacked or cross-platform interchanges had almost nowhere to put a
checkpoint, so a checkpoint can now also stand at the head or foot of transfer stairs ("Transfer ID check").
Result: attempts per day 1.27 / 1.63 / 2.52 → 1.18 / 1.50 / 1.50 (Wed / Thu / Fri); Friday generation 111 → 100 ms
median; the typical route goes through the hub on 100% of Wednesday–Friday days.

**Trivial: some checkpoints were never met.** Candidate spots now come from both the worst-case route and the
typical route, and a spot the typical commuter still passes after the day is re-timed is preferred.
Result: checkpoints on the typical route 0.80 / 1.27 / 1.50 / 1.68 → 0.85 / 1.55 / 1.77 / 1.95 (Tue–Fri);
days where nobody meets a checkpoint 15 → 8 of 160.

**Unclear: a late day gave no reason.** The deadline map from 0.2 now also serves the player (a display
feature, not the generator): on Monday and Tuesday a meter shows how much time you have in hand at perfect
play, and after any day the result screen draws your time in hand over the whole commute and names the moment
and place the day was lost ("The day was lost at 08:21:50 on Wanquan Avenue (the street)"). The excuse to the
boss uses it too: lose the day before leaving your street and you "stood outside my building thinking about the
day". The time-in-hand meter joins the information that disappears later in the week.

**Measurement fixes.** The sweep now separates "reboards" (hopping off to change cars, the 0.1 exploit, still
0%) from "turn-backs" (riding one stop the wrong way to come back, e.g. round a closed platform: 0–5% of days,
kept as a legitimate trick). It also reports the route a typical commuter takes, not only the worst case.

**Known and accepted.** 2 of 40 Friday days have a 6-second pinch point on the *fastest* route (a stair
checkpoint right before a train). The hesitant human is still never late, because a safer route remains; we
keep it as Friday flavour and watch it.

**Also new: telemetry and the daily leaderboard** (the Week 3 pattern; `server/`). Opt-in on a first-run card,
local-first storage with export, a random browser id and nothing else; a Cloudflare Worker + D1 collector that
never reads IP, User-Agent or geo; and a daily-commute board where the Worker regenerates the day and replays
the submitted key presses with the game's own simulation. Tested under `node --test` against real SQLite. Not
deployed yet, so the game ships with both endpoints off and says so.

Generator version `g2` → `g3`.

## 0.2.0 — first improvement loop

Measured with `node tools/sweep.js` on the same 40 seeds per weekday (200 days). Full reports:
[`docs/sweeps/0.1.md`](docs/sweeps/0.1.md) (before) and [`docs/sweeps/0.2.md`](docs/sweeps/0.2.md) (after).
New instruments first: a reverse solver that gives, for every place in the city, the latest time you
can be there and still clock in (the *deadline map*), and a hesitant "human" autopilot that pauses
10 s at every stair and gate and wants 8 s of margin to step onto a train.

**Unfair: the error budget was random.** 0.1 chose the start time so the best route *arrived* with the
day's slack. Trains come in steps, so the time a player could actually afford to lose varied from
10 s to 640 s: the worst tenth of Thursday and Friday days left 10–12 s, 15% of them had a
connection with under 10 s to spare, and the hesitant human was late on 10–20% of Tuesday–Friday
days even though the day had "passed" the winnable check. The check was honest for a machine and
unfair for a person.
→ The day now starts `slack` seconds before the latest time a *human-paced* commuter could leave home
and still make it (read off the deadline map, rounded down to the minute). The winnable check also
refuses a day where that commuter would have under a minute to spare.
Result: knife-edge days 15% → 0%, hesitant human late 20% → 0% (every weekday), and the worst tenth of
days now leaves a perfect player 231–470 s to lose instead of 10–321 s. The budget for a human-paced
player sits within a minute of the target (e.g. Thursday: target 210 s, measured 222 / 245 / 264 s at
p10 / median / p90).

**Odd: the best route hopped off trains to change cars.** Because you left the train by the door you
boarded, the solver found that stepping off at an intermediate stop, walking two doors along the
platform during the 30 s dwell and stepping back on the same train was often optimal (15–35% of best
routes). Real people don't do this; they walk through the train.
→ New rule: while riding you can walk through the carriages (1 m/s, crowded) and get off at any door
you reach before the stop. The train view now scrolls along the whole train and shows where you are.
Result: car-change reboards 15–35% → 0%.

**Trivial: checkpoints that never mattered.** Checkpoints were placed on the 08:00 route, but the day
really starts around 08:30 and the route moved; with worst-case queue times, the best route often
avoided them for free (Tuesday's single checkpoint was on the best route 13% of the time and cost 0 s).
→ Checkpoints (and closures) are now placed on the route at the real start, one at a time, re-timing the
day after each. Candidates are scored by how much earlier you would have to leave home if that spot were
blocked (from the deadline map), and spots a typical commuter would rather queue at than walk around
are preferred. Result: checkpoints on the best route 0.13 / 0.38 / 0.47 / 0.85 → 0.40 / 0.55 / 0.82 / 1.27
(Tue–Fri) and on the typical-wait route 0.80 / 1.27 / 1.50 / 1.68; walking around one now costs a median
150 / 103 / 84 s (Tue–Thu). Friday's fourth checkpoint is often a gamble (a cheap detour against a random
queue), which we keep as a decision.

**Dull: most routes never met the maze mechanics.** Only 40–70% of best routes walked an opposing-lane or
one-way corridor, because the passages that had them were not where people transfer.
→ More passages have opposing lanes (55% → 80%), busy concourses at interchanges and hubs run as two
opposing lanes half of the time, the unpaid halls by the exits carry the incoming morning crowd (35%), and
two-block interchanges are linked by paired one-way passages more often later in the week (10% → 40%).
Result: 95–100% of routes now walk one.

**Found on the way (rules bugs the sweep exposed).**
- On a two-lane floor, ↑ at the foot of the stairs means *climb*, but the solver could plan a lane change
  there. The autopilot then bounced between the street and the concourse forever (15–30% of days never
  finished). The solver no longer plans a lane change where that key takes a stair, lift or escalator.
- The solver let you step off stairs, or through a passage mouth, straight into the far lane; the
  simulation always puts you in the near lane. Plans could be one second too optimistic and miss a train.
  The solver now models exactly what the simulation does. "Perfect autopilot later than promised": 0%.

Cost: Friday takes 2.5 attempts on average (was 1.8) and a median 110 ms to generate (was 24 ms).
Generator version `g1` → `g2` (the same seed gives a different, better day).

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
