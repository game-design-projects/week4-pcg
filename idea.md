# Idea: Late (working title)

Requirements and ideas for the Week 4 PCG prototype. This is not a spec: nothing here is implemented, and details (numbers, exact rules, exact checks) are left to be decided while building.

## Overview

The player is late for work. Each in-game day they must get from home to the office through a generated, multi-level subway transfer network before clock-in. The challenge is finding a route through a confusing space: one-way corridors, opposing-lane foot traffic, escalators that change direction, train timetables, and checkpoints that force a wait.

## Requirements

- The core scenario is a subway transfer maze with opposing lanes and multiple levels.
- The background story is that the player is late for work.
- The network is fictional. Real station names (for example the Zhongguancun to Guomao route) are only a metaphor for "a journey with awkward transfers".
- Some stations are notorious hubs: many lines, and very troublesome transfers.
- Difficulty rises by giving the player less information (for example having to remember the timetable) and by adding identity-check checkpoints that force the player to stand and wait.
- The network and its details are generated, so each day is different.
- Built as a web page in HTML and JS.
- Anonymous, opt-in telemetry and a public leaderboard, following the approach of our Week 3 game (a small Cloudflare Worker with a D1 database). The game must stay fully playable with both switched off or unreachable.

## Ideas (all tentative)

**The world.** Places linked by passages: walkways that are two-way, one-way, or opposing-lane; stairs; escalators whose direction changes over time; lifts; and trains that run on a timetable. Several levels per station, possibly drawn as side-by-side floor panels instead of 3D.

**What gets generated.** The line layout and stations; the floor plans and level links inside each station; which passages are one-way or opposing-lane; timetables (regular or irregular); disruptions and checkpoints, placed where good routes have to pass.

**Hub stations.** Built from several linked blocks instead of one floor plan, with uneven transfer costs between lines. Some flavors to try:
- Sprawl: very long passages between blocks.
- Maze: many one-way corridors and look-alike junctions.
- Split: two parts a walk apart, joined by leaving through a gate and coming back in.
- Deep: many levels linked by chains of escalators and lifts.

**Less information over time.** The timetable shown only once; the map shown for a few seconds and then hidden; signs that are sometimes out of date; eventually only station names. This is a display setting, not generated content.

**Checkpoints.** Forced waiting of a random length. Some may need a pass picked up elsewhere.

**A week as the run.** Five days, each a new network, getting harder toward Friday: bigger networks, less information, more checkpoints, hubs from midweek, and less spare time.

**Adaptivity.** A Director-style layer that eases or tightens conditions between days depending on how the player has been doing. It adjusts settings and does not generate space. Using Jev for this is optional.

**Seeds.** The same seed gives the same day, and the seed is shown so a day can be replayed.

**Scoring.** How early or late the player arrives. A wage counter that lateness reduces, spent on small aids between days (for example one that keeps information visible longer).

**Anonymous telemetry (reusing the Week 3 pattern).** Week 3 (`game-design-projects/week3`) recorded each finished session locally first, then sent it to a Cloudflare Worker that stores it in D1, only after the player opted in on a first-run card. The Worker never reads or stores IP, User-Agent or geo; the only identifier is a random player id kept in the browser. We would do the same, with our own Worker and database rather than sharing Week 3's. What it is for here is checking the generator, not just the player:
- Which seeds and difficulty settings players fail or abandon, to see whether "hard by the numbers" matches "hard to play" (an open question below).
- How often the winnable-check had to regenerate a day, and how the parameters were set.
- Where players lose time (wrong turns, waiting, hubs), and how long a day takes.
- Whether hiding information actually raises difficulty.
A session record would carry the seed and settings, so any day can be regenerated and studied later. Data can also stay local and be exported by hand, as in Week 3.

**Leaderboard (reusing the Week 3 pattern).** Week 3 accepted a score only when the player pressed Submit, replayed the submitted moves on the server with the game's own rules code, and computed the score itself instead of trusting the client. The same idea fits here because a day is fully determined by its seed: the client submits the seed, the settings and the list of actions, and the Worker regenerates the day and replays them. Ideas for boards:
- One board per shared seed, for example a daily seed, ranked by how early the player arrived.
- Possibly a best-week board (sum over the five days).
- One line per player per board, a chosen nickname, and no player id shown. Moderation by deleting a row with a secret token.
Submitting is the consent for the leaderboard, separate from the telemetry opt-in. The pieces that need the game rules to run in the Worker (the generator and the movement rules) have to be importable without the browser, which affects how we structure the code.

**Hand-made.** Rules, aids, art, sound, and text templates such as the excuse sent to the boss after a late day.

**Tech.** A static page with no build step, drawn on a canvas. rot.js may help with seeded randomness and floor-plan generation.

## Checking generated days

Each generated day should be checked to be winnable (a perfect player can get there on time, with some spare time, and cannot get trapped), and regenerated if not. The exact checks are to be worked out during implementation.

## Open questions

- Whether rot.js generators fit the floor plans, or a hand-written generator is better. Untested.
- How to make a hub annoying but still fair.
- How long a day should last in real time.
- Whether the difficulty measures we can compute match how hard the day feels to players.
- Whether Jev can be called from a static page.
- Whether replaying a whole day in a Worker is cheap enough, and how to keep a shared seed's board fair when players may retry (one attempt per seed, or best of many).
- What to record so a generated day can be reproduced: seed only, or seed plus generator version (a change to the generator would invalidate old boards).
- Whether the telemetry needs to tell which players are repeats, given that the id is only a random value in the browser.

## References

- [`research/sok-pcg.md`](research/sok-pcg.md): PCG content types, layout algorithms, and quality-control strategies.
- [`research/sok-pcg-genres.md`](research/sok-pcg-genres.md): PCG across genres, including Director-style adaptivity.
- [Week 3 repo](https://github.com/game-design-projects/week3): the Cloudflare Worker + D1 telemetry collector and server-validated leaderboard we are borrowing from (`server/telemetry/`, `src/telemetry/`, `src/leaderboard.js`, and the consent card in `src/ui/consent.js`).
