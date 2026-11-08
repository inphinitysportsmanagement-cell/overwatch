// Spin Check: find the same story across outlets on both sides, attach matching Polymarket odds,
// and (when an AI key is set, see ai.js) add a facts-only note on how the framing differs.
// Without AI, cards still show every outlet's headline side by side.

const { chatJSON, aiAvailable } = require('./ai');

const STOP = new Set(('the a an and or but of to in on at for with from by as is are was were be been has have had it its this that these those ' +
  'after before over under into amid about says said say new news live update updates report reports reported how why what who will would could ' +
  'not more than first last also just video watch latest day week year years people his her their they them our we you your out up off ' +
  'against while during between amid near some many most other than then there here when where which per back down ahead ' +
  'tens dozens hundreds thousands millions thousand hundred dozen million killed opinion analysis comment explainer') .split(' '));
const SHORT_KEEP = new Set(['idf', 'us', 'un', 'gop', 'nato', 'irgc', 'uae', 'eu']);

const LEFT = new Set(['far left', 'left', 'lean left']);
const RIGHT = new Set(['far right', 'right', 'lean right']);
const MAX_CHECKS = 3;

const PHRASES = /\b(west bank|gaza strip|white house|united states|united nations|new york|tel aviv|red sea|south lebanon|southern lebanon)\b/g;

// Light stemming so "forming"/"form", "picks"/"picked"/"pick", "talks"/"talk" match.
const stem = w => w.length > 5 && w.endsWith('ing') ? w.slice(0, -3)
  : w.length > 4 && w.endsWith('ed') ? w.slice(0, -2)
  : w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;

function keywords(text) {
  return new Set(text.toLowerCase().replace(/[’']s\b/g, '').replace(PHRASES, m => m.replace(' ', '')).split(/[^a-z0-9]+/)
    .filter(w => (w.length > 3 || SHORT_KEEP.has(w)) && !STOP.has(w))
    .map(stem));
}
const overlap = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n; };

const MAX_STORIES = 14;
const LEAN_SIDE = l => (LEFT.has(l) ? 'left' : RIGHT.has(l) ? 'right' : l === 'center' ? 'center' : null);

// Groups headlines from different outlets that are about the same story. Big stories come first:
// the story covered by the most outlets is grouped, then the next, and so on.
function findClusters(articles, now) {
  const pool = articles
    .filter(a => a.lean && now - a.published < 48 * 36e5) // rated outlets only (OSINT channels have no lean)
    .map(a => ({ a, kw: keywords(a.title) }))
    .filter(p => p.kw.size >= 2);
  const df = new Map();
  for (const p of pool) for (const w of p.kw) df.set(w, (df.get(w) || 0) + 1);
  // Words in lots of today's headlines ("israel", "trump") say little; a name like "eisenkot" says a lot,
  // even when it's the biggest story of the day.
  const idf = w => Math.log((pool.length + 1) / (df.get(w) || 1));
  const GENERIC_DF = Math.max(8, pool.length * 0.2); // the top story itself can be in ~15% of headlines
  const strong = w => (df.get(w) || 0) <= GENERIC_DF && !GENERIC.has(w);
  const mass = kw => [...kw].reduce((s, w) => s + idf(w), 0);
  const sim = (x, y) => {
    let shared = 0, sharedStrong = 0;
    for (const w of x.kw) if (y.kw.has(w)) { shared += idf(w); if (strong(w)) sharedStrong++; }
    if (sharedStrong < 2) return 0;
    return shared / Math.min(x.mass, y.mass);
  };
  for (const p of pool) p.mass = mass(p.kw);

  const SAME = 0.34;
  const neighbors = pool.map(x => pool.filter(y => y !== x && y.a.source !== x.a.source && sim(x, y) >= SAME));
  const used = new Set();
  const clusters = [];
  const order = pool.map((p, i) => i).sort((i, j) => new Set(neighbors[j].map(n => n.a.source)).size - new Set(neighbors[i].map(n => n.a.source)).size);
  for (const i of order) {
    const seed = pool[i];
    if (used.has(seed.a)) continue;
    const bySource = new Map([[seed.a.source, { p: seed, s: Infinity }]]);
    // The seed's matches, plus close matches of those (one step), so one story isn't split in two.
    const near = new Set(neighbors[i]);
    for (const n of neighbors[i]) for (const m of neighbors[pool.indexOf(n)]) if (m !== seed && sim(seed, m) >= SAME * 0.6) near.add(m);
    for (const n of near) {
      if (used.has(n.a)) continue;
      const s = sim(seed, n), prev = bySource.get(n.a.source);
      if (!prev || s > prev.s) bySource.set(n.a.source, { p: n, s });
    }
    const members = [...bySource.values()].map(m => m.p.a);
    // 3+ outlets, or 2 that lean different ways (that's still a left-vs-right comparison).
    const sides = new Set(members.map(m => LEAN_SIDE(m.lean)));
    const fit = Math.min(...[...bySource.values()].map(m => m.s));
    if (members.length < 2 || (members.length === 2 && (sides.size < 2 || fit < 0.5))) continue; // a pair must be a close match
    members.forEach(m => used.add(m));
    // Lead with the most-covered, highest-interest headline from the reader's own desks.
    const lead = members.filter(m => m.desk !== 'compare').sort((x, y) => y.score - x.score)[0] || seed.a;
    clusters.push({ seed: lead, members, kw: seed.kw, fit });
  }
  // Two groups that share the story's key words (e.g. "eisenkot" + "form") are one story told twice: merge them.
  const signature = c => {
    const count = new Map();
    for (const m of c.members) for (const w of keywords(m.title)) if (strong(w)) count.set(w, (count.get(w) || 0) + 1);
    return new Set([...count].filter(([, n]) => n >= Math.max(2, c.members.length / 2)).map(([w]) => w));
  };
  for (let i = 0; i < clusters.length; i++) {
    for (let j = clusters.length - 1; j > i; j--) {
      if (overlap(signature(clusters[i]), signature(clusters[j])) < 2) continue;
      const have = new Set(clusters[i].members.map(m => m.source));
      clusters[i].members.push(...clusters[j].members.filter(m => !have.has(m.source)));
      clusters.splice(j, 1);
    }
  }
  return clusters.slice(0, MAX_STORIES);
}

// Words every Israel story shares; a market has to match the story on something more specific.
const GENERIC = new Set(['israel', 'israeli', 'iran', 'iranian', 'trump', 'us', 'unitedstate', 'netanyahu', 'end', 'year', 'war', 'government', 'election', 'deal', 'agree']);

function matchMarket(cluster, odds) {
  const kw = new Set(cluster.members.flatMap(m => [...keywords(m.title)]).filter(w => !GENERIC.has(w)));
  let best = null, bestHits = 1; // at least two specific words in common
  for (const m of odds) {
    const hits = overlap(keywords(m.title + ' ' + m.outcomes.map(o => o.name).join(' ')), kw);
    if (hits > bestHits) { best = m; bestHits = hits; }
  }
  if (!best) return null;
  const top = best.outcomes[0];
  return { title: best.title, url: best.url, outcome: best.binary ? null : top.name, chance: top.chance, change: top.change };
}

const LEAN_ORDER = ['far left', 'left', 'lean left', 'center', 'lean right', 'right', 'far right', null];
const byLean = (a, b) => LEAN_ORDER.indexOf(a.lean) - LEAN_ORDER.indexOf(b.lean);

const SYSTEM = `You compare how news outlets covered one event. You only use the headlines and summaries given.
Rules:
- First decide the event: one specific happening (an announcement, attack, vote, poll, report). A different story on a related topic is NOT the same event, even if it shares names or places. List every outlet whose headline is about a different event in "exclude".
- Describe framing as facts: what each outlet leads with, includes, or leaves out, and notable word choices. Name the outlets; don't describe them as left- or right-leaning.
- Never say who is right, never use words like "biased", "propaganda", "lie", or "misleading".
- "confirmed" claims must be stated consistently by at least two outlets from different leans, or attributed in the text to an official statement. Give the basis (which outlets / which official source).
- "unverified" claims are ones that appear in only one outlet or are disputed between outlets.
- Do not add any facts that are not in the input.
- Horseshoe check: if far-left and far-right outlets are both present and frame the event in a similar way (same emphasis or same target), describe that in "horseshoe". Otherwise leave it empty.
Return JSON: {"event": "the one event, in a few words", "exclude": ["outlet name", ...], "headline": "neutral 6-12 word description of the event", "spin": "1-2 short sentences on how the framing differs", "confirmed": [{"claim": "...", "basis": "..."}], "unverified": ["..."], "horseshoe": ""}. Max 3 confirmed, max 2 unverified.`;

async function aiNote(cluster) {
  if (!aiAvailable()) return null;
  const input = cluster.members.map(m => `[${m.source} | lean: ${m.lean || 'n/a'}]\nHeadline: ${m.title}\nSummary: ${m.summary}`).join('\n\n');
  try {
    const out = await chatJSON(SYSTEM, input, { maxTokens: 700, timeout: 90000 });
    const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    return {
      exclude: (Array.isArray(out.exclude) ? out.exclude : []).filter(x => typeof x === 'string'),
      headline: str(out.headline, 120),
      spin: str(out.spin, 360),
      confirmed: (Array.isArray(out.confirmed) ? out.confirmed : []).slice(0, 3)
        .map(c => ({ claim: str(c?.claim, 160), basis: str(c?.basis, 80) })).filter(c => c.claim && c.basis)
        .filter((c, i, all) => all.findIndex(x => x.claim === c.claim) === i),
      horseshoe: str(out.horseshoe, 280),
      unverified: (Array.isArray(out.unverified) ? out.unverified : []).slice(0, 2).map(u => str(u, 160)).filter(Boolean),
    };
  } catch (err) {
    console.warn(`[spin] AI note skipped: ${err.message}`);
    return null;
  }
}

async function buildSpinChecks(articles, odds, now = Date.now()) {
  const clusters = findClusters(articles, now);
  return Promise.all(clusters.map(async (c, i) => {
    // AI notes for the biggest stories only (the free AI answers about once a minute).
    let ai = i < MAX_CHECKS && c.members.length >= 3 ? await aiNote(c) : null;
    if (ai?.exclude.length) {
      const kept = c.members.filter(m => !ai.exclude.includes(m.source));
      if (kept.length < 2 || new Set(kept.map(m => LEAN_SIDE(m.lean))).size < 2) return null;
      if (kept.length < c.members.length) { c.members = kept; ai = await aiNote(c); } // re-run on the true set
    }
    return {
      headline: ai?.headline || c.seed.title,
      spin: ai?.spin || null,
      confirmed: ai?.confirmed || [],
      unverified: ai?.unverified || [],
      // A horseshoe note only makes sense when both ends of the spectrum covered the story.
      horseshoe: c.members.some(m => m.lean === 'far left') && c.members.some(m => m.lean === 'far right') ? ai?.horseshoe || null : null,
      ai: !!ai,
      outlets: c.members.sort(byLean).map(m => ({ source: m.source, lean: m.lean, title: m.title, link: m.link, summary: m.summary, image: m.image, published: m.published })),
      market: matchMarket(c, odds),
    };
  })).then(list => list.filter(Boolean));
}

module.exports = { buildSpinChecks, findClusters };
