# Week 4: Procedural Content Generation (PCG)

## Team

- Abdulla Saeed Ghanim Abdulla Alfalasi (asg8972)
- Naxin Chen (nc3840)
- Steven Li (sl10429)

## Mission

Build a game prototype that incorporates PCG: generate the levels, or something else. Using Jev is optional.

## What we're building

**Cave Diving** (working title): a game about a solo cave diver in a generated, flooded cave. The player follows a guideline in, reaches a goal, and has to get back out before their air runs out. The tension is deciding when to turn back: every step in costs air, and so does the way out. Kicked-up silt cuts visibility in tight spots, which makes the return harder, and over time the game shows the player less and less of the map.

This is prototype 2. Prototype 1 (a subway transfer game called Late) is developed separately on the `pcg-prototype` branch.

**Status:** design stage. There is no playable prototype yet. The art concept is being made first, with ChatGPT image generation. Requirements and ideas are in [`idea.md`](idea.md).

## How our PCG works

Every dive starts from a seed and difficulty settings (cave size, number of branches, number of tight squeezes, starting air, and how much information is hidden). The generator is planned as a pipeline:

1. **Cave graph:** a main passage with side branches, loops and dead ends.
2. **Cave shape:** the graph is turned into passages, squeezes and chambers, and checked for connectivity.
3. **Goal and guideline:** the goal is placed, and the guideline anchors and junctions are laid out along the main route.
4. **Conditions:** starting air, visibility and where silt is a problem.

Each generated dive is checked to be winnable (a route to the goal and back exists within the air budget, and the player cannot get permanently trapped) and is regenerated if not; the exact checks will be worked out during implementation.

Randomness comes from a seeded generator, so the same seed gives the same cave.

## How PCG adds to our game

- **Variety:** each dive is a different cave, so the player cannot memorize a route and has to decide, on the spot, how far to go.
- **Controlled difficulty:** difficulty is a set of parameters (cave complexity, air margin, how much is shown) rather than hand-ordered levels.
- **Fairness:** because each generated dive is checked to be winnable, a failed dive is meant to come from the player's decisions and not from an impossible cave.
- **Adaptivity (optional):** a Director-style layer could ease or tighten conditions based on recent performance.

What is not procedural: the rules, the art, and the text templates are hand-made. Hiding information from the player (the map shown once, then only the line and the lamp) is a difficulty setting in how the game is displayed, not generated content.

## Art

The art concept and sprite sheets were made first with ChatGPT image generation and are kept separate from the game code, in `resources/`. The direction is 2D, in teal, ink blue and slate grey, with amber reserved for the guideline and the diver's lamp.

- `resources/cave_concept_1.png`: side-view scene of the diver following the guideline, with a narrow lamp cone and silt behind.
- `resources/cave_concept_2.png`: top-down survey-style map with depth bands, a guideline with markers, a dashed jump between lines, and faint outlines of unexplored areas.
- `resources/cave_sprite.png`: diver sprite sheet (idle, swim, up and down, squeeze, reach and clip, stirring silt).
- `resources/cave_sprite2.png`: cave tiles, rock and stalactite props, guideline pieces, silt puff frames, lamp cones and bubbles.

## How to run

The prototype is not implemented yet. The plan is a static web page with no build step: open `index.html` in a browser. rot.js (2.2.1) may be vendored into the repo for its seeded RNG and map generators.

## Research notes

- [`research/sok-pcg.md`](research/sok-pcg.md): comparison of PCG content types, layout algorithms, and quality-control strategies.
- [`research/sok-pcg-genres.md`](research/sok-pcg-genres.md): how PCG is used across game genres.
