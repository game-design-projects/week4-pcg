# Changelog

What changed in Late, and why. Versions after 0.1 come from the improvement loop: we run
generated days through the solver and the autopilot (`node tools/sweep.js`), look for days that
are trivial, unfair or dull, change the generator or the rules, and measure again.

## 0.4.1 — UI pass from playtesting: English first, bundled fonts, no overlapping text

Second round of playtest feedback on the pull request: some text overlapped other text or elements (HUD panels,
signs, boards), the interface should be mainly English, and there should be no missing-font fallback.

**Finding the overlaps: `tools/ui-audit.mjs`.** Looking at screenshots does not scale, so the audit measures.
- It plays through the game in Chromium at seven window sizes, from 800×600 and a phone in landscape (844×390)
  up to 2560×1080: Day 0 with the coach, a Monday with the route guide, a Thursday with a hub, trains, the phone
  map, the timetable, help, pause, results, the shop and the week summary.
- On the canvas it wraps the game's own text and panel helpers and records every piece of text drawn in each
  frame. It reports text that overlaps text, text that a panel drawn later hides, and HUD text cut off at the edge.
- It lays out the metro map at the briefing, result and phone sizes and checks the station labels.
- In the HTML screens it measures every line of text for overlaps, clipping and cards whose top would be out
  of reach.
- The first run found 329 problems at 1280×720 alone; they came from about ten causes. Now: none at any of the
  seven sizes.

**What was wrong, and the fixes.**
- The "Unpaid" wall label and the "Gates" label sat on the same line as the hanging signs. "Unpaid area" is now
  painted on the floor and "Gates" sits below the signs.
- Escalator direction lights were 70 px above the escalator mouth, on top of the signs on the concourse and the
  departure boards on the platform. They are now small lights at the mouth.
- Two wayfinding signs at decision points close together drew one over the other. A sign that would cover
  another is now skipped.
- Departure boards were drawn before the train on the far track and before the escalators, which covered them.
  Boards now hang in front.
- Stairs and escalators are drawn in two passes, bodies then labels, so no escalator can cut across another's
  check, lift or timer label.
- Trains slid in and out over the neighbouring passage in hubs, covering its one-way plaque. They are now clipped
  to their platform, as if coming out of the tunnel.
- The one-way plaque hung at head height, where people walking past covered it. It is now painted on the floor.
- The level labels (G, B1…) slid under the clock panel when the street row was near the top.
- On trains, the carriage diagram covered the car labels; it now sits between the line strip and the cars. Long
  station names on the line strip ran into each other; each now gets the room up to its neighbours, with "…".
- On the metro map, labels collided on busier networks. Labels now also avoid other stations' markers, drop
  the Chinese line when crowded, and leave a minor station unlabelled rather than cover another label.
- Long destinations in the briefing timetable were cut off with "…"; they now wrap.

**English first.** Every Chinese string is now English or comes after an English label:
- Station names read "Qingshui Railway Station 清水火车站" on the HUD, map labels, boards, platform walls,
  train windows and the ticker.
- Chinese-only text is gone: the train-front "终点" (now END), the lift "电梯/开" (LIFT/OPEN), the exit tag
  "出口B" (Exit B, with 出口 below), the stale-sign mark "旧" (old), "进站" (Now), and two excuse lines.
- Help no longer relies on 单向通行 and 安检.
- Chinese stays as flavour where it helps the setting: station names, "One way ← 单向通行", "ON TIME 准时",
  weekday tags ("Thu 周四") and the logo.

**No font fallback.** The game used to ask Google Fonts for one font and leave everything else, Chinese included,
to whatever the player's system had. Chinese could show as empty boxes, and text measured differently on every
machine. All fonts are now bundled in `assets/fonts` (152 KB, SIL Open Font License, licences included):
- Inter for the interface
- Pixelify Sans for the clock
- a subset of Noto Sans SC with every Chinese character the game can draw, including every syllable the
  station-name generator uses (212 characters)

`tools/build_fonts.py` rebuilds the fonts from the text in the code and fails if any character is not covered.
A test fails if the code ever uses a character outside the bundled set, or an emoji; the five emoji in the UI
became text. The page now makes no network requests at all, and the headless playtest checks that.

## 0.4.0 — playtest feedback: a tutorial day and a route guide for Monday

From playtesting (feedback on the pull request): **there was nothing to teach the controls**, and **the first day
was too hard** — a new player got lost on Monday. The suggestion was to guide the player early and take the
guidance away as the week goes on, which fits the "less information every day" idea.

**Day 0, a tutorial.** Before the week there is now a guided first day, offered first on the title screen to a new
player. It is a normal generated day on a small, forgiving setting: three lines, one change of line, no
checkpoints or closures and 15 minutes to spare (`difficulty.tutorialParams`). The seed is fixed (`DAY-ZERO`) so
everyone learns on the same day. It was picked from eight candidates as the one whose guided route passes stairs,
an escalator, fare gates, two-lane passages and a change of line. A coach (`src/ui/coach.js`) shows nine short
lessons, each the first time its situation comes up, and keeps each one on screen until you have done the thing
once: walking, stairs and escalators, fare gates, two lanes, boarding, on the train, the phone map, the timetable,
and your stop. The result screen lists what you learned and leads straight into Monday.

**A route guide that fades over the week.** `src/core/guide.js` works out, from wherever you stand, the next
thing to do to reach the office ("Walk ← to entrance B", "↓ Board Line 6 → Gangtiemen", "Ride to Wanquan Plaza
(4 stops) · walk → to car 5"). It plans with the same solver that checks each day, at a human pace (time to read
the signs, a margin to step onto a train) with average queues. It plans again whenever you change floor, lane or
train, so walking the wrong way does not break it; a new plan takes under a millisecond. How much of the guide you
see is a display setting, like everything else that fades through the week:
- Monday (and Day 0): the whole path. Chevrons on the floor, the stairs to take, the train to board, the door
  to get off at and the stop on the line strip, plus a NAV line under the station name.
- Tuesday: only the signs for your next line or exit light up.
- Wednesday on: nothing (the Transit app aid brings the lit signs back).

**Measured.** A hesitant player (10 s at every stair or gate) who does *only* what the guide says is on time on
40/40 Monday and 40/40 Tuesday days of the sweep (p10 margin 249 s and 323 s). The tests check this, check that
the guide recovers after you walk the wrong way first, and check that Day 0 meets everything the coach teaches.
`node tools/playtest.mjs --tutorial` plays Day 0 in the browser as a new player (9/9 lessons), then Monday, both
by following the on-screen guide.

**Found on the way.**
- Closing the timetable with T reopened it at once, and closing it with Esc opened the pause menu. The key that
  closed an overlay was still queued. Keys pressed while an overlay is open are now dropped when it closes.
- The solver's plan from a spot between two graph nodes left out the first short walk to the nearest node.
  This never mattered for the autopilot, which only re-plans on a node, but it broke the guide: in its first test
  run only 20 of 120 guided days reached the office on time. The guide now adds that first walk back.
- A daily or seed day played after a week day recorded the week's Director adjustment in its telemetry, which
  would have regenerated the wrong day. Only week days carry one now.
- On a train the time-in-hand meter covered the start of the line strip; it now sits below it.

No generator change for the week: still `g3`, and every seed gives the same day as in 0.3.

## 0.3.1 — fixes found while playing for the screenshots

No generator change (still `g3`: every seed gives the same day as in 0.3.0).

- The in-game help still said "you get off where you got on", which stopped being true in 0.2 when walking
  through the carriages became a rule. It now explains the doors as they work, and mentions closures.
- On a train, the top of the screen showed the station you boarded at for the whole ride. It now names the
  stop you are at or coming to, next to the line and its direction.
- A day that cost more than it paid showed "¥-3"; money now reads "−¥3" on the result, the week summary, the
  shop and the HUD.
- The line strip above the train doors let the gangway show through it, and a one-way plaque could sit on top
  of a wayfinding sign. Both redrawn.
- README rewritten to match what exists, with screenshots.

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
