// Vercel function: "Ask about this story" chat (answers from headlines and feed summaries only).
const { askStory } = require('../server');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    res.status(200).json(await askStory(body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
