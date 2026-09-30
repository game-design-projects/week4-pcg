// Late — the pure game core for Node (tests, tools, the leaderboard Worker).
// In the browser the same files load as classic <script>s into window.Late.
'use strict';

module.exports = {
  rules: require('./rules.js'),
  rng: require('./rng.js'),
  names: require('./names.js'),
  network: require('./network.js'),
  interior: require('./interior.js'),
  timetable: require('./timetable.js'),
  solver: require('./solver.js'),
  difficulty: require('./difficulty.js'),
  day: require('./day.js'),
  sim: require('./sim.js'),
  autopilot: require('./autopilot.js'),
  display: require('./display.js'),
  wayfinding: require('./wayfinding.js'),
  excuses: require('./excuses.js'),
};
