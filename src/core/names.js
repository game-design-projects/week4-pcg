// Late — bilingual station names for a fictional city (汉字 + pinyin).
// Names are glued from morphemes in the style of a Chinese metro map, so they
// sound plausible without being real stations. A short blocklist keeps the
// generator from landing on famous real ones by accident.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.Late = root.Late || {}).names = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [汉字, pinyin syllables]
  const PREFIX = [
    ['柳树', 'liu shu'], ['清水', 'qing shui'], ['金台', 'jin tai'], ['银杏', 'yin xing'], ['松林', 'song lin'],
    ['杏花', 'xing hua'], ['桃李', 'tao li'], ['龙泉', 'long quan'], ['凤鸣', 'feng ming'], ['白云', 'bai yun'],
    ['青塔', 'qing ta'], ['红星', 'hong xing'], ['双榆', 'shuang yu'], ['三元', 'san yuan'], ['五福', 'wu fu'],
    ['七星', 'qi xing'], ['九华', 'jiu hua'], ['万泉', 'wan quan'], ['千鹤', 'qian he'], ['太平', 'tai ping'],
    ['永安', 'yong an'], ['光华', 'guang hua'], ['长乐', 'chang le'], ['大钟', 'da zhong'], ['牡丹', 'mu dan'],
    ['海棠', 'hai tang'], ['紫竹', 'zi zhu'], ['云岗', 'yun gang'], ['星火', 'xing huo'], ['春晖', 'chun hui'],
    ['晨光', 'chen guang'], ['朝霞', 'zhao xia'], ['锦绣', 'jin xiu'], ['丰收', 'feng shou'], ['百花', 'bai hua'],
    ['玉泉', 'yu quan'], ['碧水', 'bi shui'], ['翠柳', 'cui liu'], ['荷花', 'he hua'], ['樱桃', 'ying tao'],
    ['橡树', 'xiang shu'], ['梧桐', 'wu tong'], ['芦苇', 'lu wei'], ['钢铁', 'gang tie'], ['纺织', 'fang zhi'],
    ['灯塔', 'deng ta'], ['瓦窑', 'wa yao'], ['砖厂', 'zhuan chang'], ['煤市', 'mei shi'], ['花市', 'hua shi'],
    ['钟楼', 'zhong lou'], ['状元', 'zhuang yuan'], ['书院', 'shu yuan'], ['马场', 'ma chang'], ['石佛', 'shi fo'],
    ['铁匠', 'tie jiang'], ['酒仙', 'jiu xian'], ['琉璃', 'liu li'], ['珠市', 'zhu shi'], ['燕归', 'yan gui'],
  ];
  // A few in-jokes for commuters; at most one per city.
  const JOKE = [['迟到', 'chi dao'], ['加班', 'jia ban'], ['打卡', 'da ka'], ['摸鱼', 'mo yu'], ['早安', 'zao an']];
  const SUFFIX1 = [
    ['桥', 'qiao'], ['门', 'men'], ['寺', 'si'], ['庄', 'zhuang'], ['园', 'yuan'], ['村', 'cun'], ['街', 'jie'],
    ['路', 'lu'], ['口', 'kou'], ['营', 'ying'], ['坊', 'fang'], ['里', 'li'], ['湖', 'hu'], ['河', 'he'],
    ['屯', 'tun'], ['店', 'dian'], ['湾', 'wan'], ['坡', 'po'], ['井', 'jing'], ['苑', 'yuan'], ['居', 'ju'],
  ];
  const SUFFIX2 = [['公园', 'Park'], ['广场', 'Plaza'], ['大街', 'Avenue'], ['新城', 'New Town'], ['码头', 'Wharf'], ['体育场', 'Stadium']];
  const HUB = [['火车站', 'Railway Station'], ['中心', 'Centre'], ['广场', 'Plaza'], ['枢纽', 'Interchange']];
  const DIRS = [['东', 'dong'], ['西', 'xi'], ['南', 'nan'], ['北', 'bei']];
  const NUMS = [['二', 'er'], ['三', 'san'], ['四', 'si'], ['五', 'wu'], ['六', 'liu'], ['七', 'qi'], ['八', 'ba'], ['九', 'jiu']];
  const MID1 = [['直', 'zhi'], ['安', 'an'], ['华', 'hua'], ['宁', 'ning'], ['平', 'ping'], ['兴', 'xing'], ['德', 'de'], ['胜', 'sheng'], ['阜', 'fu'], ['广', 'guang']];
  const TERMINUS = [['新城', 'New Town'], ['机场', 'Airport'], ['大学城', 'University Town'], ['工业园', 'Industrial Park']];

  // Real, well-known Beijing stations the morphemes could spell. Skipped.
  const BLOCKLIST = new Set(['大钟寺', '中关村', '国贸', '西直门', '东直门', '石榴庄', '双井', '三元桥', '和平里', '永安里', '光华路', '牡丹园', '紫竹院', '菜市口', '太平桥', '五福', '玉泉路', '白云路', '花市', '珠市口', '钟楼', '安华桥', '德胜门', '阜成门', '广安门', '西安门', '北新桥']);

  /** Join pinyin syllables the way metro signs do: "Liushuqiao", "Yong'anli". */
  function joinPinyin(syllables) {
    let out = '';
    syllables.forEach((s, i) => {
      if (i > 0 && /^[aoe]/.test(s)) out += "'";
      out += s;
    });
    return out.charAt(0).toUpperCase() + out.slice(1);
  }

  const syl = (parts) => parts.flatMap((p) => p[1].split(' '));

  function makeNamer(rng) {
    const used = new Set();
    let joked = false;

    function build(kind) {
      if (kind === 'hub') {
        const p = rng.pick(PREFIX);
        const h = rng.pick(HUB);
        return { zh: p[0] + h[0], en: `${joinPinyin(syl([p]))} ${h[1]}` };
      }
      if (kind === 'terminus' && rng.chance(0.45)) {
        const p = rng.pick(PREFIX);
        const s = rng.pick(TERMINUS);
        return { zh: p[0] + s[0], en: `${joinPinyin(syl([p]))} ${s[1]}` };
      }
      const pattern = rng.weighted([['p2s1', 6], ['p2s2', 1.4], ['dirnum', 1], ['dirmid', 1.6]]);
      if (pattern === 'p2s1') {
        const joke = !joked && rng.chance(0.08);
        const p = joke ? rng.pick(JOKE) : rng.pick(PREFIX);
        let s = rng.pick(SUFFIX1);
        if (p[0].endsWith(s[0])) s = SUFFIX1[(SUFFIX1.indexOf(s) + 1) % SUFFIX1.length];
        if (joke) joked = true;
        return { zh: p[0] + s[0], en: joinPinyin(syl([p, s])) };
      }
      if (pattern === 'p2s2') {
        const p = rng.pick(PREFIX);
        const s = rng.pick(SUFFIX2);
        return { zh: p[0] + s[0], en: `${joinPinyin(syl([p]))} ${s[1]}` };
      }
      if (pattern === 'dirnum') {
        const d = rng.pick(DIRS);
        const n = rng.pick(NUMS);
        const s = rng.pick(SUFFIX1);
        return { zh: d[0] + n[0] + s[0], en: joinPinyin(syl([d, n, s])) };
      }
      const d = rng.pick(DIRS);
      const m = rng.pick(MID1);
      const s = rng.pick(SUFFIX1);
      return { zh: d[0] + m[0] + s[0], en: joinPinyin(syl([d, m, s])) };
    }

    return function name(kind) {
      for (let i = 0; i < 60; i++) {
        const n = build(kind);
        if (!used.has(n.zh) && !BLOCKLIST.has(n.zh) && !used.has(n.en)) {
          used.add(n.zh);
          used.add(n.en);
          return n;
        }
      }
      const n = build(kind);
      const suffix = used.size;
      return { zh: `${n.zh}${suffix}`, en: `${n.en} ${suffix}` };
    };
  }

  return { makeNamer, joinPinyin, BLOCKLIST };
});
