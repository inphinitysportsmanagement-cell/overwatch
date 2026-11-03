// One place to talk to the AI. Defaults to Groq's free tier (OpenAI-compatible API, no card needed).
// Put your key in OVERWATCH/.env as:  AI_API_KEY=gsk_...
// (On GitHub, add the same value as a repository secret named AI_API_KEY.)
// Any OpenAI-compatible provider works by also setting AI_BASE_URL and AI_MODEL.

const fs = require('fs');
const path = require('path');

try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const config = () => ({
  base: process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1',
  key: process.env.AI_API_KEY,
  model: process.env.AI_MODEL || 'llama-3.3-70b-versatile',
});

const aiAvailable = () => !!config().key && process.env.SPIN_AI !== 'off';

async function chatJSON(system, user, { maxTokens = 1500, timeout = 60000 } = {}) {
  const c = config();
  if (!c.key) throw new Error('No AI key set (AI_API_KEY).');
  const res = await fetch(`${c.base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: c.model,
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(res.status === 429 ? 'The free AI limit was hit. Try again in a minute.' : `AI request failed (HTTP ${res.status}): ${detail}`);
  }
  const text = (await res.json()).choices?.[0]?.message?.content || '';
  return JSON.parse(text);
}

module.exports = { chatJSON, aiAvailable };
