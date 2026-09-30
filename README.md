# Week 4: Procedural Content Generation (PCG)

## Team

- Abdulla Saeed Ghanim Abdulla Alfalasi (asg8972)
- Naxin Chen (nc3840)
- Steven Li (sl10429)

## Mission

Build a game prototype that incorporates PCG: generate the levels, or something else. Using Jev is optional.

## What we're building

**Late** (working title): a puzzle game about being late for work. Each day the player has to get from home to the office across a multi-level subway transfer network before clock-in. Along the way they deal with one-way corridors, opposing lanes of foot traffic, escalators that change direction, train timetables, and checkpoints that force them to stand and wait. The whole commute is generated: the network, the station layouts, the timetables, the disruptions, and the checkpoints.

The game is played over a five-day work week. Difficulty rises through the week by giving the player less information (a timetable shown once and then hidden, signs that go out of date) and by adding checkpoints.

**Status:** design stage. There is no playable prototype yet. Requirements and ideas are in [`idea.md`](idea.md).

## How our PCG works

Every day starts from a seed and a difficulty vector (number of levels, number of transfers, share of one-way corridors, schedule slack, number of checkpoints, and how much information is hidden). The generator then runs a fixed pipeline:

1. **Network skeleton:** lines and stations laid out on a coarse grid; where lines cross, a transfer station.
2. **Station interiors:** a floor plan for each level of each transfer station, with stairs, escalators, and lifts linking the levels.
3. **Corridor rules:** each passage is two-way, one-way, or an opposing-lane corridor; escalator direction follows a schedule.
4. **Timetables:** headways per line, regular or irregular depending on difficulty.
5. **Disruptions and checkpoints:** placed on chokepoints that the shortest routes must pass through.

From midweek on, the route also passes through a **hub station**: one where many lines meet and moving between them is awkward (long passages, one-way mazes, separate parts joined by a gate, or many levels). Hubs are generated from several linked blocks with an uneven transfer-cost table, instead of a single floor plan.

Each generated day is checked to be winnable (a perfect player can arrive on time with some spare time, and cannot get trapped) and is regenerated if not; the exact checks will be worked out during implementation.

We also add a Director that adjusts disruption and checkpoint intensity from how the player has been doing. It changes parameters only and does not generate space.

Randomness comes from a seeded generator, so the same seed gives the same day.

## How PCG adds to our game

- **Variety:** each day is a different network and timetable, so the player cannot memorize a route and has to read the situation.
- **Controlled difficulty:** difficulty is a set of parameters rather than hand-ordered levels, and the allowed spare time shrinks through the week (Monday is forgiving, Friday is tight).
- **Fairness:** because each generated day is checked to be winnable, being late is meant to be the player's fault and never the generator's.
- **Adaptivity:** the Director eases or tightens conditions based on recent performance.

What is not procedural: the rules, the items, the art, and the text templates are hand-made. Hiding information from the player (the timetable shown once, out-of-date signs) is a difficulty setting in how the game is displayed, not generated content.

## How to run

The prototype is not implemented yet. The plan is a static web page with no build step: open `index.html` in a browser. rot.js (2.2.1) may be vendored into the repo for its seeded RNG and map generators.

## Research notes

- [`research/sok-pcg.md`](research/sok-pcg.md): comparison of PCG content types, layout algorithms, and quality-control strategies.
- [`research/sok-pcg-genres.md`](research/sok-pcg-genres.md): how PCG is used across game genres.
