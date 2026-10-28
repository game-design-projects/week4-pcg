# Donjon

![Donjon cover: an orange slime waiting down a torch-lit wireframe corridor](crawler/assets/donjon-cover.png)

A Wizardry-style wireframe dungeon crawler where every monster decision comes from **Jev**, TypeSafe's System One model, instead of hand-tuned heuristics. Talk to monsters, recruit them, and keep them loyal. Details, controls and the itch.io build are in [crawler/README.md](crawler/README.md).

**Setup:** `npm install`, then copy `.env.example` to `.env` and put your TypeSafe API key in it (get one at https://console.typesafe.ai/keys). The key stays on the server and is never sent to the browser.

```bash
npm run crawler              # http://localhost:5174
npm test                     # unit tests (node:test, no API calls)
npm run crawler:scenarios    # scripted encounters against the live API (spends credits)
```

Play it on itch.io: https://aalfalasi.itch.io/donjon. GitHub Actions (`.github/workflows/ci.yml`) tests every push and pull request, and publishes `main` there automatically. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

The earlier gate-guard prototype, The South Gate, lives on the `south-gate` branch.

## Week 4: Procedural Content Generation (PCG)

Game Design (CS-UY 4553), week 4 mission: build a game prototype that incorporates PCG. Using Jev is optional; Donjon uses it for every monster decision.

**Team:** Abdulla Saeed Ghanim Abdulla Alfalasi (asg8972), Naxin Chen (nc3840), Steven Li (sl10429).

**What it generates.** Every floor is a new maze, with its own color theme, wall decorations, gold, stairs and monsters. Floors 5, 10, 15... add a champion's hall. Taking the stairs rolls a random boon (the Roll of Fate).

**How the PCG works** (`genFloor` in `crawler/public/game.js`):
- **Maze:** randomized depth-first carving on the odd cells of an N×N grid, which gives a perfect maze. A few walls between two corridors are then knocked through, so there are loops, and a few 3×3 rooms are opened. N grows with depth (`floorRules`).
- **Champion floors:** every 5th floor clears a 5×5 hall at the center, with a red champion standing in the middle.
- **Stairs:** a breadth-first search from the start; the stairs go on the reachable cell farthest away, never inside the champion's hall. Because they are chosen from the search, they can always be reached.
- **Gold:** placed on random reachable cells, never on the start, the stairs or the champion.
- **Look:** each floor picks a palette different from the last one. Torches, chains, banners, windows, niches and cracks are hashed from the wall cell, the floor cell and a per-floor seed, so they stay put as you move.
- **Monsters:** encounters come from a weighted pool per floor. New kinds, pairs and groups, specials and veterans are added as you descend (see "Floors and champions" in `crawler/README.md`).

**What PCG adds.** Each run is a new descent, so the map can't be memorized and the automap matters. The rising size and monster pool pace the difficulty. Seeded decoration gives each floor a recognizable identity. Jev's monsters fill the generated halls with conversations that never repeat.
