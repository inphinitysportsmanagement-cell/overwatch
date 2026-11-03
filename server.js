// OVERWATCH — news, intel & odds. Zero dependencies.
//   node server.js          → local site on :7811, rebuilds each edition automatically
//   node server.js --build  → build public/edition.json once and exit (used by the GitHub Action)
// Editions run 3x a day (06:00, 12:00, 18:00 in the TZ the process runs in — Israel time in CI).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildSpinChecks } = require('./spin');

const PORT = process.env.PORT || 7811;
const EDITION_HOURS = [6, 12, 18];
const EDITION_NAMES = { 6: 'Morning Edition', 12: 'Midday Edition', 18: 'Evening Edition' };
const CACHE_FILE = path.join(__dirname, 'public', 'edition.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124 Safari/537.36';

// lean: 7-point horseshoe scale (far left … center … far right), roughly following common media-bias
// charts (AllSides / Ad Fontes). Shown as a label only.
// desk 'compare' = outlets used only for Spin Check, not shown in the main feed.
const SOURCES = [
  // Israel & Middle East
  { name: 'Times of Israel', desk: 'israel', lean: 'center', url: 'https://www.timesofisrael.com/feed/' },
  { name: 'Jerusalem Post', desk: 'israel', lean: 'lean right', url: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx' },
  { name: 'JNS', desk: 'israel', lean: 'right', url: 'https://www.jns.org/feed/' },
  { name: 'Israel National News', desk: 'israel', lean: 'right', url: 'https://www.israelnationalnews.com/Rss.aspx' },
  { name: 'Jewish Insider', desk: 'israel', lean: 'center', url: 'https://www.jewishinsider.com/feed/' },
  { name: 'Ynet News', desk: 'israel', lean: 'center', url: 'https://www.ynetnews.com/Integration/StoryRss3089.xml' },
  // US politics (right of center)
  { name: 'The Daily Wire', desk: 'politics', lean: 'right', url: 'https://www.dailywire.com/feeds/rss.xml' },
  { name: 'Washington Free Beacon', desk: 'politics', lean: 'right', url: 'https://freebeacon.com/feed/' },
  { name: 'National Review', desk: 'politics', lean: 'right', url: 'https://www.nationalreview.com/feed/' },
  { name: 'Washington Examiner', desk: 'politics', lean: 'lean right', url: 'https://www.washingtonexaminer.com/feed' },
  { name: 'The Free Press', desk: 'politics', lean: 'center', url: 'https://www.thefp.com/feed' },
  { name: 'New York Post', desk: 'politics', lean: 'lean right', url: 'https://nypost.com/feed/' },
  { name: 'Fox News', desk: 'politics', lean: 'right', url: 'https://moxie.foxnews.com/google-publisher/latest.xml' },
  // OSINT, defense & intel
  { name: 'OSINTdefender', desk: 'osint', telegram: 'OSINTdefender' },
  { name: 'Long War Journal', desk: 'osint', url: 'https://www.longwarjournal.org/feed/' },
  { name: 'FDD', desk: 'osint', url: 'https://www.fdd.org/feed/' },
  { name: 'The War Zone', desk: 'osint', url: 'https://www.twz.com/feed' },
  { name: 'Bellingcat', desk: 'osint', url: 'https://www.bellingcat.com/feed/' },
  { name: 'USNI News', desk: 'osint', url: 'https://news.usni.org/feed' },
  { name: 'Breaking Defense', desk: 'osint', url: 'https://breakingdefense.com/feed/' },
  { name: 'War on the Rocks', desk: 'osint', url: 'https://warontherocks.com/feed/' },
  // The rest of the horseshoe, for Spin Check only
  { name: 'Mondoweiss', desk: 'compare', lean: 'far left', url: 'https://mondoweiss.net/feed/' },
  { name: 'Electronic Intifada', desk: 'compare', lean: 'far left', url: 'https://electronicintifada.net/rss.xml' },
  { name: 'Drop Site News', desk: 'compare', lean: 'far left', url: 'https://www.dropsitenews.com/feed' },
  { name: 'Common Dreams', desk: 'compare', lean: 'far left', url: 'https://www.commondreams.org/feeds/feed.rss' },
  { name: 'The Intercept', desk: 'compare', lean: 'left', url: 'https://theintercept.com/feed/?rss' },
  { name: 'Democracy Now', desk: 'compare', lean: 'left', url: 'https://www.democracynow.org/democracynow.rss' },
  { name: 'The Guardian', desk: 'compare', lean: 'left', url: 'https://www.theguardian.com/world/israel/rss' },
  { name: 'CNN', desk: 'compare', lean: 'lean left', url: 'http://rss.cnn.com/rss/edition_meast.rss' },
  { name: 'New York Times', desk: 'compare', lean: 'lean left', url: 'https://rss.nytimes.com/services/xml/rss/nyt/MiddleEast.xml' },
  { name: 'NPR', desk: 'compare', lean: 'lean left', url: 'https://feeds.npr.org/1004/rss.xml' },
  { name: 'Al Jazeera', desk: 'compare', lean: 'lean left', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { name: 'BBC', desk: 'compare', lean: 'center', url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml' },
  { name: 'Axios', desk: 'compare', lean: 'center', url: 'https://www.axios.com/feeds/feed.rss' },
  { name: 'Daily Caller', desk: 'compare', lean: 'right', url: 'https://dailycaller.com/feed/' },
  { name: 'The Post Millennial', desk: 'compare', lean: 'right', url: 'https://thepostmillennial.com/feed' },
  { name: 'The Blaze', desk: 'compare', lean: 'right', url: 'https://www.theblaze.com/feeds/feed.rss' },
  { name: 'Breitbart', desk: 'compare', lean: 'far right', url: 'https://www.breitbart.com/feed/' },
  { name: 'American Greatness', desk: 'compare', lean: 'far right', url: 'https://amgreatness.com/feed/' },
];

// Topics that push a story up the front page. Weight = how much it matters to this reader.
const INTERESTS = [
  { tag: 'Israel', weight: 5, re: /\b(israel\w*|idf|netanyahu|knesset|jerusalem|tel aviv|mossad|iron dome)\b/i },
  { tag: 'Iran', weight: 4, re: /\b(iran\w*|irgc|tehran|khamenei|hezbollah|houthi\w*|lebanon)\b/i },
  { tag: 'Gaza', weight: 4, re: /\b(gaza|hamas|hostages?|west bank|judea|samaria|rafah)\b/i },
  { tag: 'Antisemitism', weight: 4, re: /\b(antisemit\w*|anti-semit\w*|jew\w*|synagogue|zionis\w*)\b/i },
  { tag: 'Shapiro', weight: 6, re: /\b(ben shapiro|shapiro)\b/i },
  { tag: 'Midterms', weight: 3, re: /\b(midterms?|election|ballot|senate race|house race|polls?|gop|republicans?|democrats?)\b/i },
  { tag: 'Trump', weight: 2, re: /\b(trump|white house|vance|rubio|hegseth)\b/i },
  { tag: 'Military', weight: 3, re: /\b(missile|drone|strike|airstrike|navy|pentagon|army|warship|satellite imagery|osint|intelligence)\b/i },
  { tag: 'Russia/Ukraine', weight: 2, re: /\b(russia\w*|ukrain\w*|putin|zelensky\w*|kremlin)\b/i },
  { tag: 'China', weight: 2, re: /\b(china|chinese|beijing|taiwan|xi jinping|ccp|pla)\b/i },
];

const ODDS_TAGS = [
  { tag: 'israel', desk: 'mideast' }, { tag: 'iran', desk: 'mideast' }, { tag: 'middle-east', desk: 'mideast' },
  { tag: 'elections', desk: 'us' }, { tag: 'politics', desk: 'us' }, { tag: 'trump', desk: 'us' },
  { tag: 'geopolitics', desk: 'world' }, { tag: 'ukraine', desk: 'world' }, { tag: 'china', desk: 'world' },
];

// ---------- edition schedule ----------

function currentSlot(now = new Date()) {
  const d = new Date(now);
  const h = [...EDITION_HOURS].reverse().find(x => d.getHours() >= x);
  if (h === undefined) { d.setDate(d.getDate() - 1); d.setHours(EDITION_HOURS.at(-1), 0, 0, 0); }
  else d.setHours(h, 0, 0, 0);
  return d;
}
function nextSlot(now = new Date()) {
  const d = new Date(now);
  const h = EDITION_HOURS.find(x => d.getHours() < x);
  if (h === undefined) { d.setDate(d.getDate() + 1); d.setHours(EDITION_HOURS[0], 0, 0, 0); }
  else d.setHours(h, 0, 0, 0);
  return d;
}

// ---------- RSS ----------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
function decode(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&(\w+);/g, (m, n) => ENTITIES[n] ?? m);
}
const strip = s => decode(decode(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const tag = (xml, name) => (xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i')) || [])[1];

function findImage(item) {
  const m =
    item.match(/<media:content[^>]+url="([^"]+)"/i) ||
    item.match(/<media:thumbnail[^>]+url="([^"]+)"/i) ||
    item.match(/<enclosure[^>]+url="([^"]+\.(?:jpe?g|png|webp)[^"]*)"/i) ||
    decode(item).match(/<img[^>]+src="([^"]+)"/i);
  return m ? decode(m[1]) : null;
}

async function get(url, ms = 15000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

async function fetchTelegram(src) {
  const html = await (await get(`https://t.me/s/${src.telegram}`)).text();
  return html.split('tgme_widget_message_wrap').slice(1).reverse().map(part => {
    const text = strip((part.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '')
      .replace(/^(#\w+\s*)+/, '').replace(/\s*Subscribe to @\w+.*$/i, '').trim();
    const post = (part.match(/data-post="([^"]+)"/) || [])[1];
    const time = (part.match(/<time[^>]+datetime="([^"]+)"/) || [])[1];
    const image = (part.match(/message_photo_wrap[^>]+background-image:url\('([^']+)'\)/) || [])[1] || null;
    if (!text || !post) return null;
    const title = text.length > 160 ? text.slice(0, 157).replace(/\s+\S*$/, '') + '…' : text;
    return { title, summary: text.slice(0, 280), link: `https://t.me/${post}`, embed: `https://t.me/${post}?embed=1`, image, source: src.name, desk: src.desk, lean: null, published: time ? +new Date(time) : Date.now() };
  }).filter(Boolean).slice(0, 25);
}

async function fetchFeed(src) {
  if (src.telegram) return fetchTelegram(src);
  const xml = await (await get(src.url)).text();
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  return items.slice(0, 25).map(item => {
    const title = strip(tag(item, 'title'));
    const summary = strip(tag(item, 'description') || '').slice(0, 280);
    const link = strip(tag(item, 'link') || tag(item, 'guid') || '');
    const date = new Date(strip(tag(item, 'pubDate') || tag(item, 'dc:date') || '') || Date.now());
    return { title, summary, link, image: findImage(item), source: src.name, desk: src.desk, lean: src.lean || null, published: isNaN(date) ? Date.now() : +date };
  }).filter(a => a.title && a.link.startsWith('http'));
}

function score(a, now) {
  const text = `${a.title} ${a.summary}`;
  const tags = INTERESTS.filter(i => i.re.test(text));
  const titleHits = INTERESTS.filter(i => i.re.test(a.title)).reduce((s, i) => s + i.weight, 0);
  const hoursOld = Math.max(0, (now - a.published) / 36e5);
  a.tags = tags.map(t => t.tag);
  a.score = titleHits * 2 + tags.reduce((s, i) => s + i.weight, 0) + (a.image ? 2 : 0) - hoursOld * 0.6;
  return a;
}

// Can this outlet's articles be shown inside our page (iframe)? Checked once per source per edition.
async function canFrame(link) {
  try {
    const res = await fetch(link, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    res.body?.cancel();
    const xfo = (res.headers.get('x-frame-options') || '').toLowerCase();
    const fa = ((res.headers.get('content-security-policy') || '').match(/frame-ancestors([^;]*)/i) || [])[1];
    return res.ok && !xfo && (fa === undefined || /(^|\s)\*(\s|$)/.test(fa));
  } catch { return false; }
}

// ---------- Polymarket ----------

const pct = p => Math.round(parseFloat(p) * 1000) / 10;

async function fetchOdds() {
  const seen = new Map();
  await Promise.all(ODDS_TAGS.map(async ({ tag, desk }) => {
    try {
      const url = `https://gamma-api.polymarket.com/events?active=true&closed=false&tag_slug=${tag}&limit=12&order=volume24hr&ascending=false`;
      const events = await (await get(url)).json();
      for (const e of events) {
        if (seen.has(e.id)) continue;
        const open = (e.markets || []).filter(m => m.active && !m.closed && m.outcomePrices);
        if (!open.length) continue;
        let outcomes;
        if (open.length === 1) {
          const m = open[0];
          const names = JSON.parse(m.outcomes), prices = JSON.parse(m.outcomePrices);
          outcomes = names.map((n, i) => ({ name: n, chance: pct(prices[i]), change: i === 0 && m.oneDayPriceChange != null ? pct(m.oneDayPriceChange) : null }));
        } else {
          outcomes = open
            .map(m => ({ name: m.groupItemTitle || m.question, chance: pct(JSON.parse(m.outcomePrices)[0]), change: m.oneDayPriceChange != null ? pct(m.oneDayPriceChange) : null }))
            .filter(o => o.chance >= 0.5)
            .sort((a, b) => b.chance - a.chance);
        }
        if (!outcomes.length) continue;
        const mideast = /israel|iran|gaza|hamas|hezbollah|lebanon|houthi|yemen|syria|saudi|middle east|netanyahu/i.test(e.title);
        seen.set(e.id, {
          id: e.id, desk: mideast ? 'mideast' : desk, title: e.title, image: e.icon || e.image, url: `https://polymarket.com/event/${e.slug}`,
          volume24h: Math.round(e.volume24hr || 0), volume: Math.round(e.volume || 0), endDate: e.endDate,
          binary: open.length === 1, outcomes: outcomes.slice(0, 5),
        });
      }
    } catch (err) { console.warn(`[odds] ${tag}: ${err.message}`); }
  }));
  return [...seen.values()].sort((a, b) => b.volume24h - a.volume24h);
}

// ---------- edition build ----------

let edition = null;
let building = null;

async function buildEdition(slot = currentSlot()) {
  const started = Date.now();
  console.log(`[edition] building ${EDITION_NAMES[slot.getHours()]} for ${slot.toDateString()}…`);
  const results = await Promise.allSettled(SOURCES.map(fetchFeed));
  const sourceStatus = await Promise.all(SOURCES.map(async (s, i) => {
    const items = results[i].value || [];
    return {
      name: s.name, desk: s.desk, lean: s.lean || null, ok: results[i].status === 'fulfilled', count: items.length,
      frameable: !!s.telegram || (items[0] ? await canFrame(items[0].link) : false), // Telegram uses its embed page
    };
  }));

  const now = Date.now();
  const seenTitles = new Set();
  const articles = results
    .flatMap(r => (r.status === 'fulfilled' ? r.value : []))
    .filter(a => now - a.published < 3 * 864e5) // last 3 days
    .filter(a => { const k = a.title.toLowerCase().slice(0, 60); if (seenTitles.has(k)) return false; seenTitles.add(k); return true; })
    .map(a => score(a, now))
    .sort((a, b) => b.score - a.score);

  const odds = await fetchOdds();
  const spin = await buildSpinChecks(articles, odds, now);

  const next = {
    name: EDITION_NAMES[slot.getHours()],
    slot: +slot,
    builtAt: now,
    nextEdition: +nextSlot(slot),
    buildMs: Date.now() - started,
    sources: sourceStatus,
    articles: articles.filter(a => a.desk !== 'compare'),
    spin,
    odds,
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(next));
  console.log(`[edition] done: ${next.articles.length} stories, ${spin.length} spin checks (${spin.filter(c => c.ai).length} with AI), ${odds.length} markets, ${sourceStatus.filter(s => s.ok).length}/${SOURCES.length} sources in ${next.buildMs}ms`);
  return next;
}

async function ensureEdition(force = false) {
  const slot = +currentSlot();
  if (!force && edition && edition.slot >= slot) return edition;
  if (!building) building = buildEdition(new Date(slot)).then(e => (edition = e)).finally(() => (building = null));
  return building;
}

try { edition = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch {}

if (process.argv.includes('--build')) {
  ensureEdition(process.argv.includes('--force'))
    .then(e => console.log(`[edition] current: ${e.name} ${new Date(e.slot).toString()}`))
    .catch(err => { console.error('[edition] failed', err); process.exit(1); });
} else {
  ensureEdition().catch(err => console.error('[edition] failed', err));
  setInterval(() => ensureEdition().catch(err => console.error('[edition] failed', err)), 60_000); // catches each 6/12/18 rollover
  serve();
}

// ---------- http (local only) ----------

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };

function serve() {
  http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/edition.json') await ensureEdition().catch(() => {});
    const file = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }).listen(PORT, () => console.log(`OVERWATCH running → http://localhost:${PORT}`));
}
