// Spin Check: find the same story across outlets on both sides, attach matching Polymarket odds,
// and (when an AI is reachable) add a facts-only note on how the framing differs.
// AI runs free through GitHub Models inside the GitHub Action. Without it, cards still show
// every outlet's headline side by side.

const STOP = new Set(('the a an and or but of to in on at for with from by as is are was were be been has have had it its this that these those ' +
  'after before over under into amid about says said say new news live update updates report reports reported how why what who will would could ' +
  'not more than first last also just video watch latest day week year years people his her their they them our we you your out up off ' +
  'against while during between amid near some many most other than then there here when where which per back down ahead') .split(' '));
const SHORT_KEEP = new Set(['idf', 'us', 'un', 'gop', 'nato', 'irgc', 'uae', 'eu']);

const LEFT = new Set(['left', 'lean left']);
const RIGHT = new Set(['right', 'lean right']);
const MAX_CHECKS = 3;

const PHRASES = /\b(west bank|gaza strip|white house|united states|united nations|new york|tel aviv|red sea|south lebanon|southern lebanon)\b/g;

function keywords(text) {
  return new Set(text.toLowerCase().replace(/[’']s\b/g, '').replace(PHRASES, m => m.replace(' ', '')).split(/[^a-z0-9]+/)
    .filter(w => (w.length > 3 || SHORT_KEEP.has(w)) && !STOP.has(w))
    .map(w => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)));
}
const overlap = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n; };

// Words that show up in lots of headlines today ("israel", "midterm") say little about whether two
// stories are the same event. Weight shared words by how rare they are.
function rarity(pool) {
  const df = new Map();
  for (const p of pool) for (const w of p.kw) df.set(w, (df.get(w) || 0) + 1);
  return w => Math.log(pool.length / (df.get(w) || 1));
}

function findClusters(articles, now) {
  const pool = articles
    .filter(a => a.desk !== 'osint' && now - a.published < 36 * 36e5)
    .map(a => ({ a, kw: keywords(a.title) }));
  const weight = rarity(pool);
  const RARE = Math.log(pool.length / 6); // a word in at most ~6 headlines
  const sameEvent = (x, y) => {
    let sum = 0, rare = 0, shared = 0;
    for (const w of x) if (y.has(w)) { const wt = weight(w); sum += wt; shared++; if (wt >= RARE) rare++; }
    if (shared / Math.min(x.size, y.size) < 0.3) return 0;
    return rare >= 2 || (shared >= 3 && rare >= 1 && sum >= 9) ? sum : 0;
  };
  const used = new Set();
  const clusters = [];

  // Seeds: the stories this reader cares about most, from his own desks.
  const seeds = pool.filter(p => p.a.desk !== 'compare').sort((x, y) => y.a.score - x.a.score).slice(0, 60);
  for (const seed of seeds) {
    if (used.has(seed.a) || seed.kw.size < 3) continue;
    const bySource = new Map([[seed.a.source, { ...seed, hits: Infinity }]]);
    for (const p of pool) {
      if (p.a === seed.a || used.has(p.a)) continue;
      const hits = sameEvent(seed.kw, p.kw);
      if (!hits) continue;
      const prev = bySource.get(p.a.source);
      if (!prev || hits > prev.hits) bySource.set(p.a.source, { ...p, hits });
    }
    const members = [...bySource.values()].map(m => m.a);
    const leans = members.map(m => m.lean);
    if (members.length < 3 || !leans.some(l => LEFT.has(l)) || !leans.some(l => RIGHT.has(l))) continue;
    members.forEach(m => used.add(m));
    clusters.push({ seed: seed.a, members, kw: seed.kw });
    if (clusters.length === MAX_CHECKS) break;
  }
  return clusters;
}

function matchMarket(cluster, odds) {
  const kw = new Set(cluster.members.flatMap(m => [...keywords(m.title)]));
  let best = null, bestHits = 1;
  for (const m of odds) {
    const hits = overlap(keywords(m.title + ' ' + m.outcomes.map(o => o.name).join(' ')), kw);
    if (hits > bestHits) { best = m; bestHits = hits; }
  }
  if (!best) return null;
  const top = best.outcomes[0];
  return { title: best.title, url: best.url, outcome: best.binary ? null : top.name, chance: top.chance, change: top.change };
}

const LEAN_ORDER = ['left', 'lean left', 'center', 'lean right', 'right', null];
const byLean = (a, b) => LEAN_ORDER.indexOf(a.lean) - LEAN_ORDER.indexOf(b.lean);

const SYSTEM = `You compare how news outlets covered one event. You only use the headlines and summaries given.
Rules:
- Describe framing as facts: what each outlet leads with, includes, or leaves out, and notable word choices. Name outlets.
- Never say who is right, never use words like "biased", "propaganda", "lie", or "misleading".
- "confirmed" claims must be stated consistently by at least two outlets from different leans, or attributed in the text to an official statement. Give the basis (which outlets / which official source).
- "unverified" claims are ones that appear in only one outlet or are disputed between outlets.
- Do not add any facts that are not in the input.
- Some outlets may be about a different event. List those in "exclude" and ignore them.
Return JSON: {"exclude": ["outlet name", ...], "headline": "neutral 6-12 word description of the event", "spin": "1-2 short sentences on how the framing differs", "confirmed": [{"claim": "...", "basis": "..."}], "unverified": ["..."]}. Max 3 confirmed, max 2 unverified.`;

async function aiNote(cluster) {
  const token = process.env.GITHUB_TOKEN;
  if (!token || process.env.SPIN_AI === 'off') return null;
  const input = cluster.members.map(m => `[${m.source} | lean: ${m.lean || 'n/a'}]\nHeadline: ${m.title}\nSummary: ${m.summary}`).join('\n\n');
  try {
    const res = await fetch('https://models.github.ai/inference/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.SPIN_MODEL || 'openai/gpt-4.1-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: input }],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const out = JSON.parse((await res.json()).choices[0].message.content);
    const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    return {
      exclude: (Array.isArray(out.exclude) ? out.exclude : []).filter(x => typeof x === 'string'),
      headline: str(out.headline, 120),
      spin: str(out.spin, 360),
      confirmed: (Array.isArray(out.confirmed) ? out.confirmed : []).slice(0, 3)
        .map(c => ({ claim: str(c?.claim, 160), basis: str(c?.basis, 80) })).filter(c => c.claim && c.basis),
      unverified: (Array.isArray(out.unverified) ? out.unverified : []).slice(0, 2).map(u => str(u, 160)).filter(Boolean),
    };
  } catch (err) {
    console.warn(`[spin] AI note skipped: ${err.message}`);
    return null;
  }
}

async function buildSpinChecks(articles, odds, now = Date.now()) {
  const clusters = findClusters(articles, now);
  return Promise.all(clusters.map(async c => {
    let ai = await aiNote(c);
    if (ai?.exclude.length) {
      const kept = c.members.filter(m => !ai.exclude.includes(m.source));
      const leans = kept.map(m => m.lean);
      if (kept.length < 3 || !leans.some(l => LEFT.has(l)) || !leans.some(l => RIGHT.has(l))) return null;
      if (kept.length < c.members.length) { c.members = kept; ai = await aiNote(c); } // re-run on the true set
    }
    return {
      headline: ai?.headline || c.seed.title,
      spin: ai?.spin || null,
      confirmed: ai?.confirmed || [],
      unverified: ai?.unverified || [],
      ai: !!ai,
      outlets: c.members.sort(byLean).map(m => ({ source: m.source, lean: m.lean, title: m.title, link: m.link })),
      market: matchMarket(c, odds),
    };
  })).then(list => list.filter(Boolean));
}

module.exports = { buildSpinChecks };
