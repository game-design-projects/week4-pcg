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

## References

- [`research/sok-pcg.md`](research/sok-pcg.md): PCG content types, layout algorithms, and quality-control strategies.
- [`research/sok-pcg-genres.md`](research/sok-pcg-genres.md): PCG across genres, including Director-style adaptivity.
