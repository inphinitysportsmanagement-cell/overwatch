// JNMC (Jewish Network for Media Correctness): Israel news, bias checks & odds. Zero dependencies.
//   node server.js          → local site on :7811, rebuilds each edition automatically
//   node server.js --build  → build public/edition.json once and exit (used by the GitHub Action)
// Editions run 3x a day (06:00, 12:00, 18:00 in the TZ the process runs in — Israel time in CI).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildSpinChecks } = require('./spin');
const { chatJSON, aiAvailable, aiCanJudgeSide } = require('./ai');

const PORT = process.env.PORT || 7811;
const EDITION_HOURS = [6, 12, 18];
const EDITION_NAMES = { 6: 'Morning Edition', 12: 'Midday Edition', 18: 'Evening Edition' };
const CACHE_FILE = path.join(__dirname, 'public', 'edition.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124 Safari/537.36';

// lean: the outlet's overall lean, from AllSides (5-point scale, news coverage; checked Nov 2026), or from
// Media Bias/Fact Check for outlets AllSides doesn't rate. "far left" / "far right" extend it into a
// 7-point horseshoe for outlets those raters flag as strongly one-sided or questionable.
// rated: who the rating comes from, shown to readers.
// paywall: most articles need a subscription; marked on the site and ranked a little lower.
// desk 'compare' = outlets used only for Spin Check, not shown in the main feed.
const SOURCES = [
  // Israel & Middle East
  { name: 'Times of Israel', desk: 'israel', lean: 'center', rated: 'AllSides', url: 'https://www.timesofisrael.com/feed/' },
  { name: 'Jerusalem Post', desk: 'israel', lean: 'center', rated: 'AllSides', url: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx' },
  { name: 'JNS', desk: 'israel', lean: 'lean right', rated: 'Media Bias/Fact Check', url: 'https://www.jns.org/feed/' },
  { name: 'Israel National News', desk: 'israel', lean: 'lean right', rated: 'Media Bias/Fact Check', url: 'https://www.israelnationalnews.com/Rss.aspx' },
  { name: 'Jewish Insider', desk: 'israel', lean: 'center', rated: 'AllSides', url: 'https://www.jewishinsider.com/feed/' },
  { name: 'Ynet News', desk: 'israel', lean: 'lean left', rated: 'Media Bias/Fact Check', url: 'https://www.ynetnews.com/Integration/StoryRss3089.xml' },
  // US politics (right of center)
  { name: 'The Daily Wire', desk: 'politics', lean: 'right', rated: 'AllSides', url: 'https://www.dailywire.com/feeds/rss.xml' },
  { name: 'Washington Free Beacon', desk: 'politics', lean: 'right', rated: 'AllSides', url: 'https://freebeacon.com/feed/' },
  { name: 'National Review', desk: 'politics', lean: 'lean right', rated: 'AllSides', url: 'https://www.nationalreview.com/feed/' },
  { name: 'Washington Examiner', desk: 'politics', lean: 'lean right', rated: 'AllSides', url: 'https://www.washingtonexaminer.com/feed' },
  { name: 'The Free Press', desk: 'politics', lean: 'lean right', rated: 'AllSides', paywall: true, url: 'https://www.thefp.com/feed' },
  { name: 'New York Post', desk: 'politics', lean: 'right', rated: 'AllSides', url: 'https://nypost.com/feed/' },
  { name: 'Fox News', desk: 'politics', lean: 'right', rated: 'AllSides', url: 'https://moxie.foxnews.com/google-publisher/latest.xml' },
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
  { name: 'Mondoweiss', desk: 'compare', lean: 'far left', rated: 'Media Bias/Fact Check', url: 'https://mondoweiss.net/feed/' },
  { name: 'Electronic Intifada', desk: 'compare', lean: 'far left', rated: 'Media Bias/Fact Check', url: 'https://electronicintifada.net/rss.xml' },
  { name: '+972 Magazine', desk: 'compare', lean: 'left', rated: 'Media Bias/Fact Check', url: 'https://www.972mag.com/feed/' },
  { name: 'Haaretz', desk: 'compare', lean: 'lean left', rated: 'Media Bias/Fact Check', paywall: true, url: 'https://www.haaretz.com/srv/haaretz-latest-headlines' },
  { name: 'The Forward', desk: 'compare', lean: 'lean left', rated: 'Media Bias/Fact Check', url: 'https://forward.com/feed/' },
  { name: 'CBS News', desk: 'compare', lean: 'lean left', rated: 'AllSides', url: 'https://www.cbsnews.com/latest/rss/world' },
  { name: 'NBC News', desk: 'compare', lean: 'lean left', rated: 'AllSides', url: 'https://feeds.nbcnews.com/nbcnews/public/world' },
  { name: 'Washington Post', desk: 'compare', lean: 'lean left', rated: 'AllSides', paywall: true, url: 'https://feeds.washingtonpost.com/rss/world' },
  { name: 'Los Angeles Times', desk: 'compare', lean: 'lean left', rated: 'AllSides', url: 'https://www.latimes.com/world-nation/rss2.0.xml' },
  { name: 'Drop Site News', desk: 'compare', lean: 'left', rated: 'Media Bias/Fact Check', url: 'https://www.dropsitenews.com/feed' },
  { name: 'Common Dreams', desk: 'compare', lean: 'left', rated: 'AllSides', url: 'https://www.commondreams.org/feeds/feed.rss' },
  { name: 'The Intercept', desk: 'compare', lean: 'left', rated: 'AllSides', url: 'https://theintercept.com/feed/?rss' },
  { name: 'Democracy Now', desk: 'compare', lean: 'left', rated: 'AllSides', url: 'https://www.democracynow.org/democracynow.rss' },
  { name: 'The Guardian', desk: 'compare', lean: 'left', rated: 'AllSides', url: 'https://www.theguardian.com/world/israel/rss' },
  { name: 'New York Times', desk: 'compare', lean: 'lean left', rated: 'AllSides', paywall: true, url: 'https://rss.nytimes.com/services/xml/rss/nyt/MiddleEast.xml' },
  { name: 'NPR', desk: 'compare', lean: 'lean left', rated: 'AllSides', url: 'https://feeds.npr.org/1004/rss.xml' },
  { name: 'Al Jazeera', desk: 'compare', lean: 'lean left', rated: 'AllSides', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { name: 'BBC', desk: 'compare', lean: 'center', rated: 'AllSides', also: ['bbc.com'], url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml' },
  { name: 'Axios', desk: 'compare', lean: 'lean left', rated: 'AllSides', url: 'https://www.axios.com/feeds/feed.rss' },
  { name: 'Daily Caller', desk: 'compare', lean: 'lean right', rated: 'AllSides', url: 'https://dailycaller.com/feed/' },
  { name: 'The Post Millennial', desk: 'compare', lean: 'right', rated: 'AllSides', url: 'https://thepostmillennial.com/feed' },
  { name: 'The Blaze', desk: 'compare', lean: 'right', rated: 'AllSides', url: 'https://www.theblaze.com/feeds/feed.rss' },
  { name: 'Breitbart', desk: 'compare', lean: 'far right', rated: 'Media Bias/Fact Check', url: 'https://www.breitbart.com/feed/' },
  { name: 'American Greatness', desk: 'compare', lean: 'right', rated: 'AllSides', url: 'https://amgreatness.com/feed/' },
];

// Topics that push a story up the front page. Weight = how much it matters to this reader.
// The site is Israel-only: a story needs at least one "core" topic to make the edition.
const INTERESTS = [
  { tag: 'Israel', weight: 5, core: true, re: /\b(israel\w*|idf|netanyahu|knesset|jerusalem|tel aviv|mossad|iron dome|shin bet)\b/i },
  { tag: 'Gaza', weight: 4, core: true, re: /\b(gaza\w*|hamas|rafah|khan younis|islamic jihad)\b/i },
  { tag: 'Hostages', weight: 5, core: true, re: /\b(hostages?|captives?|abducted)\b/i },
  { tag: 'West Bank', weight: 3, core: true, re: /\b(west bank|judea|samaria|settlers?|settlements?|jenin|nablus|ramallah|palestinian authority)\b/i },
  { tag: 'Iran', weight: 4, core: true, re: /\b(iran\w*|irgc|tehran|khamenei|ayatollah)\b/i },
  { tag: 'Hezbollah', weight: 4, core: true, re: /\b(hezbollah|lebanon|lebanese|beirut|nasrallah)\b/i },
  { tag: 'Houthis', weight: 3, core: true, re: /\b(houthi\w*|yemen\w*|red sea)\b/i },
  { tag: 'Antisemitism', weight: 4, core: true, re: /\b(antisemit\w*|anti-semit\w*|jew-hat\w*|kristallnacht|holocaust|farrakhan|nation of islam|swastikas?|hate crimes?)\b/i },
  { tag: 'Jewish World', weight: 2, core: true, re: /\b(jews|jewish|synagogues?|zionis\w*|rabbis?|aipac)\b/i },
  { tag: 'Military', weight: 2, re: /\b(missiles?|drones?|airstrikes?|strikes?|navy|warship|satellite imagery|osint|intelligence)\b/i },
  { tag: 'Shapiro', weight: 3, re: /\b(ben shapiro)\b/i },
];
const isIsraelStory = a => INTERESTS.some(i => i.core && a.tags.includes(i.tag));

// Polymarket tags for the Odds column: the region only.
const ODDS_TAGS = [
  { tag: 'israel', desk: 'mideast' }, { tag: 'iran', desk: 'mideast' }, { tag: 'middle-east', desk: 'mideast' }, { tag: 'gaza', desk: 'mideast' },
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
    return { title, summary, link, image: findImage(item), source: src.name, desk: src.desk, lean: src.lean || null, ...(src.paywall && { paywall: true }), published: isNaN(date) ? Date.now() : +date };
  }).filter(a => a.title && a.link.startsWith('http'));
}

// A topic counts if it's in the headline, or named at least twice in the summary. One passing mention
// in a summary ("…a Jewish conservative…") doesn't make a story about that topic.
const mentions = (re, text) => (text.match(new RegExp(re.source, 'gi')) || []).length;
function score(a, now) {
  const tags = INTERESTS.filter(i => i.re.test(a.title) || mentions(i.re, a.summary) >= 2);
  const titleHits = INTERESTS.filter(i => i.re.test(a.title)).reduce((s, i) => s + i.weight, 0);
  const hoursOld = Math.max(0, (now - a.published) / 36e5);
  a.tags = tags.map(t => t.tag);
  a.score = titleHits * 2 + tags.reduce((s, i) => s + i.weight, 0) + (a.image ? 2 : 0) - hoursOld * 0.6 - (a.paywall ? 4 : 0); // free-to-read first
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
        // Israel-only site: keep markets about Israel, its neighbors and enemies; skip parlays ("combo", "X & Y").
        if (!/israel|iran|gaza|hamas|hezbollah|lebanon|houthi|hormuz|netanyahu|abraham accords|palestin|knesset|west bank|idf/i.test(e.title) || /combo|\s&\s/i.test(e.title)) continue;
        const mideast = true;
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

// Feeds sometimes point at placeholder or missing pictures; check each one so the page never leads with a blank.
// Many feeds (JNS, Jerusalem Post, FDD…) carry no photo. Every article page names a share/preview image
// (og:image, what social sites show for a link), so use that. Only the top of each page is read.
async function addPreviewImages(articles, max = 140) {
  const todo = articles.filter(a => !a.image && !a.link.includes('t.me/')).slice(0, max);
  const meta = html => {
    for (const re of [/<meta[^>]+(?:property|name)=["'](?:og:image|og:image:url|twitter:image)["'][^>]*content=["']([^"']+)["']/i,
                      /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|og:image:url|twitter:image)["']/i]) {
      const m = html.match(re);
      if (m) return decode(m[1]).trim();
    }
    return null;
  };
  let found = 0;
  for (let i = 0; i < todo.length; i += 20) {
    await Promise.all(todo.slice(i, i + 20).map(async a => {
      try {
        const res = await fetch(a.link, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(7000) });
        if (!res.ok || !res.body) return;
        // Read only until </head> (or 700 KB); the image tag is always in the head.
        const reader = res.body.getReader(), dec = new TextDecoder();
        let html = '';
        while (html.length < 700000 && !/<\/head>/i.test(html)) {
          const { done, value } = await reader.read();
          if (done) break;
          html += dec.decode(value, { stream: true });
        }
        reader.cancel().catch(() => {});
        const img = meta(html);
        if (img && /^https?:\/\//.test(img) && !/(logo|placeholder|favicon)[^/]*$/i.test(img.split('?')[0])) { a.image = img; found++; }
      } catch {}
    }));
  }
  console.log(`[edition] preview images: ${found} added for ${todo.length} stories without one`);
}

async function dropDeadImages(articles) {
  const urls = [...new Set(articles.map(a => a.image).filter(Boolean))];
  const dead = new Set();
  for (let i = 0; i < urls.length; i += 24) {
    await Promise.all(urls.slice(i, i + 24).map(async u => {
      try {
        const r = await fetch(u, { method: 'GET', headers: { 'User-Agent': UA, Range: 'bytes=0-0' }, signal: AbortSignal.timeout(6000) });
        if (!r.ok || !(r.headers.get('content-type') || 'image').startsWith('image')) dead.add(u);
        r.body?.cancel().catch(() => {});
      } catch { dead.add(u); }
    }));
  }
  for (const a of articles) if (dead.has(a.image)) a.image = null;
  console.log(`[edition] images: ${urls.length - dead.size} ok, ${dead.size} dead`);
}

// Every feed's stories from the last 3 days that are about Israel, best first (includes the compare-only outlets).
async function gather() {
  const results = await Promise.allSettled(SOURCES.map(fetchFeed));
  const sourceStatus = await Promise.all(SOURCES.map(async (s, i) => {
    const items = results[i].value || [];
    return {
      name: s.name, desk: s.desk, lean: s.lean || null, rated: s.rated || null, paywall: !!s.paywall, ok: results[i].status === 'fulfilled', count: items.length,
      domains: [...new Set([s.url, s.telegram && 'https://t.me', items[0]?.link].filter(Boolean)
        .map(u => new URL(u).hostname.replace(/^(www|rss|feeds|moxie)\./, '')).concat(s.also || []))],
      frameable: !!s.telegram || (items[0] ? await canFrame(items[0].link) : false), // Telegram uses its embed page
    };
  }));

  const now = Date.now();
  const seenTitles = new Set();
  const articles = results
    .flatMap(r => (r.status === 'fulfilled' ? r.value : []))
    .filter(a => now - a.published < 3 * 864e5) // last 3 days
    .filter(a => !/\b(sponsored|paid (content|post)|advertorial|partner content)\b/i.test(a.title)) // ads dressed as articles
    .filter(a => { const k = a.title.toLowerCase().slice(0, 60); if (seenTitles.has(k)) return false; seenTitles.add(k); return true; })
    .map(a => score(a, now))
    .filter(isIsraelStory)
    .sort((a, b) => b.score - a.score);
  return { articles, sourceStatus, now };
}

async function buildEdition(slot = currentSlot()) {
  const started = Date.now();
  console.log(`[edition] building ${EDITION_NAMES[slot.getHours()]} for ${slot.toDateString()}…`);
  const { articles, sourceStatus, now } = await gather();
  await addPreviewImages(articles);
  await dropDeadImages(articles);

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
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(next)); } catch {} // read-only on Vercel; the function keeps it in memory
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
} else if (require.main === module) { // on Vercel, api/*.js load this file for analyzeArticle only
  ensureEdition().catch(err => console.error('[edition] failed', err));
  setInterval(() => ensureEdition().catch(err => console.error('[edition] failed', err)), 60_000); // catches each 6/12/18 rollover
  serve();
}

// ---------- AI line analysis for the Bias Scanner (local server, needs an AI key) ----------

const SCAN_SYSTEM = `You are a media-bias analyst. You read one news article and point out specific lines where the outlet's own framing leans left, leans right, or is loaded. Hold both sides to the same standard: flag pro-Israel or right-leaning framing as readily as pro-Palestinian or left-leaning framing.
Look for: word choice; attribution asymmetry (one side "said", the other "claimed"); passive voice that hides who acted; selective emphasis or ordering; one-sided sourcing; missing context a reader needs; opinion presented as news.
Rules:
- Flag the outlet's own words. Quotes from people only count if the choice of quotes is one-sided (type "sourcing").
- "quote" must be copied EXACTLY from the numbered paragraph, 4 to 30 words.
- Don't flag accurate, neutral reporting. A few solid findings beat many weak ones. At most 12.
- For each finding, first write "why", then "hurts": the group the OUTLET is criticizing with this wording. Not every group the line mentions: "Israel-hating congresswoman" criticizes the congresswoman (a progressive), so it hurts "us_left", not Israel; "Israel's brutal siege" criticizes Israel, so it hurts "israel". Pick exactly one:
  "israel" (Israel, the IDF, the Israeli government, Zionists, Jews)
  "pro_palestinian" (Palestinians, Hamas, Iran and its proxies, pro-Palestinian activists)
  "us_right" (Republicans, Trump, conservatives)
  "us_left" (Democrats, progressives, socialists)
  "none" (emotive or sensational, but not aimed at a side)
- In "summary", describe who is portrayed how. Do not use the words "left" or "right".
Return JSON: {"summary": "2 sentences on the article's overall framing", "findings": [{"p": paragraph number, "quote": "...", "why": "one sentence: who this wording criticizes and how", "hurts": "israel|pro_palestinian|us_right|us_left|none", "type": "word choice|attribution|passive voice|emphasis|sourcing|missing context|opinion as news", "neutral": "a more neutral wording"}], "missing": ["context a fair version would add", at most 3]}`;

// Small models mix up "left" and "right", so the AI only says who a line makes look worse and we work out the side here.
const HURTS_TO_LEAN = { israel: 'left', us_right: 'left', pro_palestinian: 'right', us_left: 'right', none: 'loaded' };

const norm = t => t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

// ---------- AI overview for the article viewer ----------
// Built only from the feed's headline + short summary (and other outlets' headlines on the same story),
// never from the article's full text. Short bullets in our own words, so nothing is republished.
const OVERVIEW_SYSTEM = `You write a short, neutral news overview for a reader who is about to open an article.
Use ONLY the headlines and summaries given. Do not add facts, numbers, names or quotes that are not in them. Write in your own words; never copy a sentence.
Every point must be directly supported by the given text. Do not guess causes, consequences or background. Two solid points beat four with guesses.
Return JSON: {"points": ["2 to 4 short bullet points (max 22 words each) on what happened"], "differs": "if several outlets are given: one sentence on how their headlines frame it differently, naming outlets. Otherwise an empty string."}`;
const overviewCache = new Map();
async function overviewStory({ title = '', summary = '', source = '', others = [] }) {
  title = String(title).slice(0, 300); summary = String(summary).slice(0, 400);
  if (!title) throw new Error('No headline given.');
  const key = title + '|' + others.length;
  if (overviewCache.has(key)) return overviewCache.get(key);
  const lines = [`Outlet: ${source}\nHeadline: ${title}\nSummary: ${summary}`,
    ...others.slice(0, 8).map(o => `Outlet: ${String(o.source).slice(0, 60)} (${o.lean || 'unrated'})\nHeadline: ${String(o.title).slice(0, 300)}`)];
  // The small free model sometimes names the list differently or returns one string; accept those, and retry once.
  const parse = out => {
    let pts = out?.points ?? out?.bullets ?? out?.overview ?? [];
    if (typeof pts === 'string') pts = pts.split(/\n+|(?<=\.)\s+(?=[A-Z])/);
    return {
      points: (Array.isArray(pts) ? pts : []).map(x => (typeof x === 'string' ? x : x?.text || x?.point || '')).map(x => x.replace(/^[-•*\d.\s]+/, '').trim())
        .filter(Boolean).slice(0, 4).map(x => x.slice(0, 220)),
      differs: others.length && typeof out?.differs === 'string' ? out.differs.trim().slice(0, 300) : '',
    };
  };
  let result = parse(await chatJSON(OVERVIEW_SYSTEM, lines.join('\n\n'), { maxTokens: 500, timeout: 60000 }).catch(() => null));
  if (!result.points.length) result = parse(await chatJSON(OVERVIEW_SYSTEM, lines.join('\n\n'), { maxTokens: 500, timeout: 60000 }));
  if (!result.points.length) throw new Error('The AI gave no overview. Try again.');
  overviewCache.set(key, result);
  if (overviewCache.size > 500) overviewCache.delete(overviewCache.keys().next().value);
  return result;
}

// ---------- "Ask about this story" chat in the article viewer ----------
// Answers only from the headlines and feed summaries we have for the story (never fetched article text).
const ASK_SYSTEM = `You answer a reader's questions about one news story, in a chat inside a news site.
You only know the headlines and short summaries given below, from one or more outlets. Rules:
- Answer only from that text. If it doesn't say, reply that the headlines and summaries don't cover it and suggest reading the full article. Never guess or add outside facts.
- Be brief: 1-3 sentences, plain words. You may name which outlet said what.
- Stay neutral. Don't take sides or say who is right. You may describe how outlets frame it differently.
- Never write out or recreate the article's text.
Return JSON: {"answer": "..."}`;
async function askStory({ question = '', history = [], title = '', summary = '', source = '', others = [] }) {
  question = String(question).trim().slice(0, 400);
  if (!question) throw new Error('Type a question first.');
  if (!title) throw new Error('No story given.');
  const story = [`Outlet: ${String(source).slice(0, 60)}\nHeadline: ${String(title).slice(0, 300)}\nSummary: ${String(summary).slice(0, 400)}`,
    ...others.slice(0, 8).map(o => `Outlet: ${String(o.source).slice(0, 60)} (${o.lean || 'unrated'})\nHeadline: ${String(o.title).slice(0, 300)}`)].join('\n\n');
  const past = (Array.isArray(history) ? history : []).slice(-6)
    .map(t => `${t.role === 'ai' ? 'You' : 'Reader'}: ${String(t.text).slice(0, 400)}`).join('\n');
  const out = await chatJSON(ASK_SYSTEM, `STORY\n${story}\n\n${past ? `CHAT SO FAR\n${past}\n\n` : ''}READER'S QUESTION\n${question}`, { maxTokens: 300, timeout: 60000 });
  const answer = typeof out?.answer === 'string' ? out.answer.trim().slice(0, 700) : '';
  if (!answer) throw new Error('The AI gave no answer. Try again.');
  return { answer };
}

async function analyzeArticle({ paragraphs = [], source = '', lean = '' }) {
  const paras = paragraphs.filter(p => typeof p === 'string').slice(0, 80);
  let budget = 24000;
  const kept = paras.filter(p => (budget -= p.length) > 0);
  if (!kept.length) throw new Error('No text to analyze.');
  const user = `Outlet: ${source || 'unknown'}${lean ? ` (generally rated ${lean})` : ''}\n\n` + kept.map((p, i) => `[${i + 1}] ${p}`).join('\n\n');
  const out = await chatJSON(SCAN_SYSTEM, user, { maxTokens: 2000, timeout: 90000 });
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  // Keep only findings whose quote really appears in the article; the AI must not invent lines.
  const findings = (Array.isArray(out.findings) ? out.findings : []).slice(0, 12).map(f => {
    const quote = str(f?.quote, 300);
    const lean = HURTS_TO_LEAN[f?.hurts] && (aiCanJudgeSide() ? HURTS_TO_LEAN[f.hurts] : 'loaded');
    if (!quote || !lean) return null;
    let p = Number(f.p) - 1;
    if (!(kept[p] && norm(kept[p]).includes(norm(quote)))) p = kept.findIndex(t => norm(t).includes(norm(quote)));
    if (p < 0) return null;
    return { p, quote, lean, type: str(f.type, 40) || 'framing', why: str(f.why, 300), neutral: str(f.neutral, 200) };
  }).filter(Boolean);
  return {
    summary: str(out.summary, 500),
    // Overall lean from the findings: -3 (left) … 3 (right), damped when there are only a few.
    lean: !aiCanJudgeSide() ? null : (() => {
      const net = findings.filter(f => f.lean === 'right').length - findings.filter(f => f.lean === 'left').length;
      const sided = findings.filter(f => f.lean !== 'loaded').length;
      return Math.max(-3, Math.min(3, Math.round(net * 3 / Math.max(sided, 3))));
    })(),
    findings,
    missing: (Array.isArray(out.missing) ? out.missing : []).slice(0, 3).map(m => str(m, 200)).filter(Boolean),
    dropped: (Array.isArray(out.findings) ? Math.min(out.findings.length, 12) : 0) - findings.length,
  };
}

const readBody = req => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', c => { data += c; if (data.length > 400000) { reject(new Error('Too much text.')); req.destroy(); } });
  req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('Bad request.')); } });
});

// ---------- http (local only) ----------

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };

function serve() {
  http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/ai-status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ available: aiAvailable() }));
    }
    if (url.pathname === '/api/ask' && req.method === 'POST') {
      try {
        const result = await askStory(await readBody(req));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }
    if (url.pathname === '/api/overview' && req.method === 'POST') {
      try {
        const result = await overviewStory(await readBody(req));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }
    if (url.pathname === '/api/analyze' && req.method === 'POST') {
      try {
        const result = await analyzeArticle(await readBody(req));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }
    if (url.pathname === '/edition.json' || url.pathname === '/api/edition') {
      const e = await ensureEdition().catch(() => edition);
      res.writeHead(e ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      return res.end(JSON.stringify(e || { error: 'Edition not ready yet.' }));
    }
    const file = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }).listen(PORT, () => console.log(`JNMC running → http://localhost:${PORT}`));
}

module.exports = { analyzeArticle, overviewStory, askStory, buildEdition, gather, currentSlot, CACHE_FILE };
