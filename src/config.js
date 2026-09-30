// Where this game's own Worker lives once it is deployed (see "Telemetry and
// the leaderboard" in the README). null means nothing is ever sent, and the
// game plays exactly the same.
(function (root) {
  'use strict';
  root.CaveConfig = root.CaveConfig || {
    TELEMETRY_ENDPOINT: null,    // e.g. 'https://cave-diving-telemetry.<account>.workers.dev/v1/sessions'
    LEADERBOARD_ENDPOINT: null,  // e.g. 'https://cave-diving-telemetry.<account>.workers.dev/v1/scores'
  };
})(window);
