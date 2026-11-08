// One place to talk to the AI.
// With no key, it uses Pollinations' free public endpoint (no account, no key; OpenAI-compatible).
// With a key in .env (next to this file) (AI_API_KEY=gsk_...), it uses Groq's free tier instead, which is
// faster and has higher limits. On GitHub, add the same value as a repository secret named AI_API_KEY.
// Any OpenAI-compatible provider works by also setting AI_BASE_URL and AI_MODEL.

const fs = require('fs');
const path = require('path');

try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const config = () => process.env.AI_API_KEY
  ? { base: process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1', key: process.env.AI_API_KEY, model: process.env.AI_MODEL || 'llama-3.3-70b-versatile' }
  : { base: process.env.AI_BASE_URL || 'https://text.pollinations.ai/openai', key: null, model: process.env.AI_MODEL || 'openai' };

const aiAvailable = () => process.env.SPIN_AI !== 'off';
// The keyless model is small: good at spotting slanted lines, unreliable at saying which side they favor.
const aiCanJudgeSide = () => !!config().key;

// The keyless endpoint allows one reply every 45 seconds per computer, so requests wait their turn.
let queue = Promise.resolve();
let lastFree = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// On Vercel a build has a time limit, so AI calls that can't finish before the deadline are skipped
// (those Spin Checks still show every outlet's headline, just without the AI note).
let deadline = Infinity;
const setAIDeadline = t => { deadline = t; };
const checkDeadline = (needMs = 30000) => { if (Date.now() + needMs > deadline) throw new Error('out of time for AI this build'); };

function chatJSON(system, user, opts = {}) {
  if (config().key) { checkDeadline(); return request(system, user, opts); }
  const run = queue.then(async () => {
    checkDeadline(Math.max(0, lastFree + 46000 - Date.now()) + 30000);
    await sleep(Math.max(0, lastFree + 46000 - Date.now()));
    try { return await request(system, user, opts); } finally { lastFree = Date.now(); }
  });
  queue = run.catch(() => {});
  return run;
}

async function request(system, user, { maxTokens = 1500, timeout = 90000 } = {}, retried = false) {
  const c = config();
  const url = c.base.endsWith('/openai') ? c.base : `${c.base}/chat/completions`; // Pollinations takes the request at /openai itself
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...(c.key && { Authorization: `Bearer ${c.key}` }), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: c.model,
      temperature: 0.2,
      // The keyless model has a fixed reply budget and "thinks" before answering, so keep the thinking short.
      ...(c.key ? { max_tokens: maxTokens } : { reasoning_effort: 'low' }),
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(Math.max(1000, Math.min(timeout, deadline - Date.now()))),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    if (!c.key && !retried && (res.status === 402 || res.status === 429)) { // limit from an earlier run of the server
      checkDeadline(76000);
      await sleep(46000);
      return request(system, user, { maxTokens, timeout }, true);
    }
    throw new Error(res.status === 429 ? 'The free AI limit was hit. Try again in a minute.' : `AI request failed (HTTP ${res.status}): ${detail}`);
  }
  const text = (await res.json()).choices?.[0]?.message?.content || '';
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1); // some models wrap JSON in ```json fences
  return JSON.parse(json || text);
}

module.exports = { chatJSON, aiAvailable, aiCanJudgeSide, setAIDeadline };
