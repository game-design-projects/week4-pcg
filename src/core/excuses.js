// Late — the message you send the boss after a late day. Hand-written
// templates, filled from what actually went wrong in the simulation log, so
// the excuse is procedural but true(ish).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rng.js'), require('./rules.js'));
  else {
    const L = (root.Late = root.Late || {});
    L.excuses = factory(L.rng, L.rules);
  }
})(typeof self !== 'undefined' ? self : this, function (RNG, R) {
  'use strict';

  const OPENERS = ['Sorry boss,', 'So sorry,', 'Hi, quick one:', 'Morning! Bad news:', 'So sorry, boss (不好意思),'];
  const CLOSERS = ['On my way!', 'Almost there.', 'Will stay late to make up for it.', 'Coffee is on me.', 'Nearly there (马上到)!'];

  const TEMPLATES = {
    checkpoint: ['the {label} at {station} took {wait}. They checked my bag twice.', 'I queued {wait} at the {label} in {station}. I now know every tile on that floor.'],
    escalator: ['the escalator at {station} reversed right in front of me.', 'every escalator at {station} was going the other way. All of them.'],
    oneway: ['a one-way corridor at {station} sent me the long way round.', '{station} has a one-way passage. I was going the other way.'],
    closed: ['they closed a passage at {station} for works. Nobody told me.', 'a barrier at {station} said "closed until further notice". It was not kidding.'],
    fare: ['I accidentally left the station at {station} and had to pay to get back in.', 'I went out the wrong gate at {station}. Twice.'],
    against: ['I spent {wait} walking against the crowd at {station}.', 'the crowd at {station} was all going the other way. So was I, apparently.'],
    wrongline: ['I got on Line {line} going the wrong way. Saw a lot of {station}.', 'I rode Line {line} to {station} by mistake. Nice station though.'],
    hub: ['{station} is a labyrinth. I think I saw a minotaur near exit {exit}.', '{station}. That is the whole excuse. You know what it is like.'],
    generic: ['the metro was being the metro.', 'my alarm, the lift, the train, the other train. In that order.'],
    overslept: ['my alarm was set for 8 PM. Again.', 'I was up in time, I promise. I just stood outside my building thinking about the day.', 'the cat sat on my phone.'],
    lostat: ['it all went wrong at {station} around {clock}. I checked.', 'by {clock} at {station} it was already over. I just did not know it yet.'],
  };

  const REPLIES = [
    { upTo: 120, lines: ['ok.', 'Noted.', 'Fine, just come in quietly.'] },
    { upTo: 600, lines: ['See me when you get in.', 'Again?', 'Meeting moved to 9:30. You are welcome.'] },
    { upTo: Infinity, lines: ['We need to talk.', 'Have you considered moving closer?', 'HR has been cc\'d.'] },
  ];

  const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => (v[k] !== undefined ? v[k] : k));

  /**
   * @param day   the generated day
   * @param state the finished simulation state (state.log, state.stats, state.result)
   * @returns {{text: string, reply: string, cause: string}}
   */
  function excuseFor(day, state, lostAt) {
    const rng = RNG.makeRng(`excuse|${day.seed}|${state.tick}`);
    const name = (id) => {
      const s = day.network.stations.find((x) => x.id === id);
      return s ? s.name.en : 'the station';
    };
    const causes = [];
    const cps = state.log.filter((e) => e.type === 'checkpoint');
    if (cps.length) {
      const worst = cps.reduce((a, b) => (b.wait > a.wait ? b : a));
      causes.push(['checkpoint', worst.wait, { label: worst.label.toLowerCase(), station: name(worst.st), wait: R.fmtDuration(worst.wait) }]);
    }
    if (state.stats.against > 20) causes.push(['against', state.stats.against, { station: name(state.log.length ? state.log[state.log.length - 1].st : day.home.station), wait: R.fmtDuration(state.stats.against) }]);
    const fares = state.log.filter((e) => e.type === 'fare');
    if (fares.length) causes.push(['fare', 90 * fares.length, { station: name(fares[0].st) }]);
    const par = day.par ? day.par.lines : [];
    const boards = state.log.filter((e) => e.type === 'board');
    const odd = boards.find((b) => !par.includes(b.line));
    if (odd) {
      const next = state.log.find((e) => e.type === 'alight' && e.t > odd.t);
      causes.push(['wrongline', 240, { line: odd.line.replace('L', ''), station: name(next ? next.at : odd.st) }]);
    }
    const hub = day.network.stations.find((s) => s.id === day.network.hubId);
    if (hub && state.log.some((e) => e.st === hub.id)) {
      const I = day.interiors[hub.id];
      causes.push(['hub', 60, { station: hub.name.en, exit: I.exits.length ? rng.pick(I.exits).letter : 'B' }]);
    }
    if (state.stats.blocked > 3) causes.push(['oneway', 30 + state.stats.blocked, { station: name(state.log.length ? state.log[0].st : day.home.station) }]);
    if (lostAt) {
      const home = lostAt.st === day.home.station && lostAt.seg === 0 && lostAt.mode === 'walk';
      if (home) causes.push(['overslept', 1e6, {}]);
      else causes.push(['lostat', 45, { station: name(lostAt.st), clock: R.fmtClock(lostAt.t) }]);
    }
    causes.sort((a, b) => b[1] - a[1]);
    const [cause, , vars] = causes[0] || ['generic', 0, {}];
    const text = `${rng.pick(OPENERS)} ${fill(rng.pick(TEMPLATES[cause]), vars)} ${rng.pick(CLOSERS)}`;
    const late = state.result ? -state.result.margin : 0;
    const reply = rng.pick(REPLIES.find((r) => late <= r.upTo).lines);
    return { text, reply, cause };
  }

  return { excuseFor, TEMPLATES };
});
