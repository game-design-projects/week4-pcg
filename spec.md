# Spec: Late (working title)

Design specification for the Week 4 PCG prototype. Status: draft. Nothing here is implemented yet. Items marked **[unverified]** are assumptions that need to be checked before or during implementation.

## 1. Overview

The player is late for work. Each in-game day they must travel from home to the office through a generated multi-level subway transfer network and arrive before clock-in. The challenge is navigation under constraints: one-way corridors, opposing-lane foot traffic, escalators that change direction, train timetables, and checkpoints that force a wait.

The game runs over a five-day work week. Each day is a new generated network. The week is the run.

## 2. Player experience goals

- Reading a confusing space quickly and choosing a route is the core skill.
- Later days remove information (the player must remember things) and add checkpoints (the player must absorb forced delays), rather than only making the map bigger.
- Being late should always feel like the player's mistake. The generator never produces an unwinnable day.

## 3. Core loop

1. A day starts. The player sees the clock-in time and the current time.
2. The player is shown whatever information the day's difficulty allows (map, timetable).
3. The player moves through the network in real time: walking, taking stairs, escalators, and lifts, waiting for trains, passing checkpoints.
4. The player boards the final train and reaches the office, or clock-in passes.
5. The day is scored. The next day is generated using the difficulty for that weekday and the Director's adjustments.

## 4. World model

The network is a directed graph in which every node is a place and every edge is a way to move between places.

### 4.1 Nodes

- `platform(line, station, level)`: where a train of a given line stops.
- `room(station, level, id)`: a walkable area within a station level (hall, concourse, corridor junction).
- `checkpoint(station, level, id)`: a room where the player is stopped.
- `home` and `office`: start and goal.

### 4.2 Edges

Each edge has: `from`, `to`, `type`, `base_time`, `direction_rule`.

| type | behavior |
|---|---|
| `walk` | two-way, base time by distance |
| `walk_oneway` | one direction only |
| `walk_lane` | opposing-lane corridor; walking against the flow is slower |
| `stairs` | two-way between levels, slow |
| `escalator` | one direction at a time; the direction flips on a schedule |
| `lift` | two-way between levels, slow, with a waiting time |
| `train` | ride from one platform to the next station's platform on the same line, following the timetable |
| `transfer` | walk from one platform to another platform within a station (usually multi-edge across levels) |

### 4.3 Time

The game clock is discrete (one tick per in-game second, or coarser if performance requires). Trains depart at scheduled ticks. Escalator direction is a function of tick. Checkpoints have a wait drawn from a range at generation time.

## 5. Generation pipeline

Input: `seed`, `weekday` (1 to 5), `difficulty vector d` (section 7), Director adjustments (section 8).

### 5.1 Stages

1. **Network skeleton.** Choose the number of lines and stations. Lay lines on a coarse grid as simple paths. Any grid cell crossed by two lines becomes a transfer station. Pick `home` on one line and `office` on another so at least one transfer is needed.
2. **Station interiors.** For each station, generate one floor plan per level with rooms and corridors (rot.js Digger or a BSP generator; see open question OQ-1). Place platforms on their levels.
3. **Vertical links.** Connect adjacent levels with stairs, escalators, and lifts at chosen positions. Every level of every station must have at least one vertical link.
4. **Edge rules.** Assign each corridor a type from section 4.2. Probabilities come from `d` (share of one-way edges, share of opposing-lane corridors). Assign each escalator a direction schedule.
5. **Timetables.** For each line, choose a headway and a jitter. Regular schedules have jitter 0; irregular schedules have jitter above 0. Compute departures over the day.
6. **Disruptions and checkpoints.** Compute the chokepoints of the shortest routes (nodes or edges every good route must use). Place checkpoints and disruptions on them, with waits drawn from ranges set by `d`.

### 5.2 Validation

A generated day is accepted only if all of these hold. If not, regenerate with a new sub-seed.

- **V1, route exists:** on the time-expanded directed graph, there is a route from `home` at the start time to `office`.
- **V2, slack:** the best route arrives at least `slack(weekday)` ticks before clock-in.
- **V3, worst case:** V1 and V2 still hold if every mandatory checkpoint takes its maximum wait.
- **V4, no traps:** from every node the player can reach, the office is still reachable (strongly connected components check on the static graph, and reachability check on the time-expanded graph for time-limited edges).
- **V5, level connectivity:** each station level is internally connected (flood fill).

Retry policy: up to `N` attempts at the requested difficulty; after that, fall back to a looser difficulty and record that a fallback happened. `N` is set after measuring how often generation fails **[unverified]**.

### 5.3 Difficulty signal

We track simple measures of how hard an accepted day is: number of transfers on the best route, number of level changes, number of against-flow segments on the best route, and the ratio of the best route's length to the obvious-looking route's length. Whether these correspond to how hard players find a day is **[unverified]** and is only a design assumption.

### 5.4 Hub stations

A hub is a transfer station that is deliberately hard to get through: many lines meet there and moving between them is awkward. Hubs are what make a route feel like a real commute, and from midweek on at least one hub sits on the best route (found with the chokepoint analysis from stage 6).

**Generation.** A hub is a station whose line count is at least `d.hub_lines` (larger than an ordinary transfer station's two or three). Instead of one floor plan per level, a hub is built from several separate blocks (concourses) joined by long passages. Each line's platform is assigned to a block and a level. The result is a sparse transfer structure: not every pair of platforms is directly connected, and many transfers go through an intermediate block.

**Hub archetypes** (one is chosen per hub; more can be added):

| archetype | what makes it hard |
|---|---|
| Sprawl | very long transfer passages between blocks, so transfers cost a lot of time |
| Maze | many one-way corridors and opposing lanes, and several look-alike junctions |
| Split | two parts that are a walk apart and require leaving the station area and coming back in through a gate (the gate can act as a checkpoint) |
| Deep | many levels linked by chains of escalators and lifts |

**Extra rules for hubs**
- Transfer cost is uneven: some pairs of lines transfer quickly and others slowly. The cost of each pair is drawn from a range set by `d.hub_transfer_cost` and stored in a transfer table.
- At higher information levels, hub signs are the ones most likely to be out of date.
- Validation is the same V1 to V5, but V2 (slack) and V3 (worst case) are the ones most likely to fail at a hub, so hubs are the main reason for regeneration. The validator harness (section 13) should report hub failures separately.

## 6. Information layer (display policy, not generation)

Information hiding is controlled by `d.info_level` and changes only what the player sees, not the generated network. Because of that, validation does not change with it.

| info_level | what is shown |
|---|---|
| 0 | full map and timetable at all times |
| 1 | map at all times; timetable shown once at the start |
| 2 | map shown for a few seconds at the start, then hidden |
| 3 | signs may be out of date (a minority are wrong) |
| 4 | station names only |

Timetable shape (regular or irregular) is generated content and does affect how hard it is to remember. Whether irregularity actually maps to memory difficulty is **[unverified]**.

## 7. Difficulty

`d` = { levels, transfers, oneway_share, lane_share, slack, checkpoint_count, wait_range, info_level, timetable_jitter, hub_count, hub_lines, hub_transfer_cost }.

Baseline by weekday (values to be tuned by playtesting):

| Day | Structure | Info level | Checkpoints | Hubs |
|---|---|---|---|---|
| Mon | 1 transfer, 2 levels | 0 | none | none |
| Tue | 2 transfers, one-way escalators | 1 | none | none |
| Wed | 3 levels, opposing lanes | 2 | 1, random wait | 1 small hub |
| Thu | more levels, escalators flip on schedule | 3 | 2, one needs a pass | 1 hub, more lines |
| Fri | largest network | 4 | several, on forced routes | 1 to 2 large hubs, uneven transfer costs |

Slack shrinks from Monday to Friday.

### 7.1 Passes

A checkpoint may require a pass (an item picked up elsewhere on the map). If a pass is required, validation V1 to V3 must include collecting the pass on the route, and the pass must be obtainable before the checkpoint it unlocks.

## 8. Director (adaptive layer)

The Director changes generation parameters between days, and may adjust event timing within a day. It does not generate space.

- Inputs: lateness on recent days, number of wrong turns, time spent at checkpoints.
- Outputs: adjustments to `slack`, `wait_range`, `checkpoint_count`, `info_level` within fixed bounds around the weekday baseline.
- Rule-based for the prototype. Using Jev for the decision step is optional and not required; it would need a way to call it from a static page **[unverified]**.

## 9. Determinism and seeds

- The same `seed` and `d` must produce the same day.
- The current seed is shown in the UI so a day can be reproduced.
- Use a seeded RNG for all generation. rot.js has one (`ROT.RNG`); the exact seeding call must be checked against the version we vendor **[unverified]**. Do not call `Math.random` inside generation.

## 10. Scoring

- Arrival relative to clock-in: on time, late by a small margin, late by a large margin.
- Extra points for spare time on arrival.
- Week total is the sum over five days. Lateness reduces a wage counter used to buy small aids between days (for example, something that shortens the time information stays hidden, or a shortcut).

## 11. Hand-made content

Not procedural: game rules, aids and their effects, art, sound, UI, text templates. The text templates (for example, the excuse sent to the boss after a late day) are filled from small word lists.

## 12. Technical plan

- Static web page, no build step: `index.html` and JavaScript modules, drawn on a canvas.
- Multiple levels are drawn as side-by-side floor panels (an exploded view), not in 3D.
- rot.js 2.2.1 may be vendored under `vendor/` for its RNG and map generators. If Digger does not meet our needs, write BSP ourselves.
- Generation code has no dependency on the DOM, so it can run under Node for testing.

Suggested layout:

```
index.html
src/
  generate/       pipeline stages, validators, difficulty
  game/           simulation, input, Director, scoring
  render/         canvas drawing
vendor/           rot.js if used
tools/            test harness
```

## 13. Testing

- **Validator harness:** run the generator over many seeds for each weekday and report how often each validation fails and how often the fallback fires. This is how we answer OQ-1 and set the retry limit.
- **Determinism test:** same seed and `d` twice gives an identical day.
- **Fairness test:** for accepted days, run a reference solver on the time-expanded graph and confirm it arrives with at least the required slack.
- **Hub test:** for Wednesday to Friday seeds, confirm a hub lies on the best route, and record how often hubs cause regeneration.
- **Manual playtest:** each weekday is completable, and the difficulty ramp is noticeable.

## 14. Acceptance criteria for the prototype

- A full five-day week can be played from start to finish.
- Every accepted day passes V1 to V5.
- The same seed reproduces the same day.
- Information hiding and checkpoints are both present in later days.
- From Wednesday on, at least one hub station lies on the best route.
- The README can point to running code for each of the five pipeline stages.

## 15. Open questions

- **OQ-1:** Does rot.js Digger produce connected floor plans? We have not tested it. Plan: measure in the validator harness, and fall back to BSP or to repair by flood fill if not.
- **OQ-2:** Are the difficulty measures in 5.3 useful proxies? Needs playtesting.
- **OQ-3:** How long should a day take in real time? Not decided.
- **OQ-4:** Should the Director be rule-based only, or should Jev be tried? Depends on whether it can be called from a static page.
- **OQ-5:** How much of the excuse text and flavor to include in the prototype.
- **OQ-6:** What makes a hub annoying but still fair? The current answer is uneven transfer costs plus the V1 to V5 checks; whether that feels right needs playtesting.
- **OQ-7:** Whether the Split hub (leave the area and come back through a gate) should reuse the checkpoint mechanic or be its own thing.

## 16. References

- `research/sok-pcg.md`: content types, layout algorithms, and quality control.
- `research/sok-pcg-genres.md`: PCG across genres, including Director-style adaptivity.
