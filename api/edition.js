// Vercel function: builds the live edition itself, so the site stays fresh with no GitHub Action
// and no computer left on. Vercel's CDN caches each build for REFRESH_MIN minutes; after that, the
// next visitor still gets the cached copy instantly while a new one is built in the background.
process.env.TZ = 'Asia/Jerusalem'; // edition names (Morning / Midday / Evening) follow Israel time

const fs = require('fs');
const { buildEdition, currentSlot, CACHE_FILE } = require('../server');
const { setAIDeadline } = require('../ai');

const REFRESH_MIN = 15;
const AI_BUDGET_MS = 35_000; // AI notes are a bonus: never let them hold up fresh news (the free AI can stall)

let latest = null;   // kept between requests while this instance stays warm
let building = null;

const fallback = () => { try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return null; } };

async function fresh() {
  if (latest && Date.now() - latest.builtAt < REFRESH_MIN * 60_000) return latest;
  if (!building) {
    setAIDeadline(Date.now() + AI_BUDGET_MS);
    building = buildEdition(currentSlot()).then(e => (latest = e)).finally(() => (building = null));
  }
  return building;
}

module.exports = async (req, res) => {
  try {
    const e = await fresh();
    // After 15 min the next visitor still gets this copy instantly (for up to a week) while a new one builds.
    res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${REFRESH_MIN * 60}, stale-while-revalidate=604800`);
    res.status(200).json(e);
  } catch (err) {
    console.error('[edition] build failed', err);
    const e = latest || fallback(); // last good build, or the copy saved in the repo
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
    if (e) res.status(200).json({ ...e, stale: true });
    else res.status(503).json({ error: 'Edition is being built. Try again in a minute.' });
  }
};
