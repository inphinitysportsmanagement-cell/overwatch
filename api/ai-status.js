// Vercel function: tells the page whether the AI check is on.
const { aiAvailable } = require('../ai');

module.exports = (req, res) => res.status(200).json({ available: aiAvailable() });
