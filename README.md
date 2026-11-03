# OVERWATCH

News · Intel · Odds, Israel only. Every story about Israel, Gaza and the hostages, Iran and its proxies, and antisemitism, from 39 outlets across the political spectrum, plus live Polymarket odds for the region.

A new edition is published at **06:00, 12:00 and 18:00 Israel time** by a GitHub Action (`.github/workflows/editions.yml`) and served on GitHub Pages. No server needed.

- **Run locally:** `node server.js` → http://localhost:7811
- **Build once:** `node server.js --build` (add `--force` to rebuild the current edition)
- **Publish a fresh edition now:** Actions tab → *Publish edition* → *Run workflow*

Sources, topic weights and Polymarket tags are at the top of `server.js`.

## AI (free)

Spin Check notes and the Bias Scanner's line-by-line AI analysis work with no setup: without a key they use [Pollinations](https://pollinations.ai)' free public AI (no account), which allows one answer every 45 seconds, so a scan takes up to a minute.

For faster answers, add a free [Groq](https://console.groq.com) key (no card needed):

1. Sign up at console.groq.com, open **API Keys**, and create a key.
2. Locally: put it in `.env` as `AI_API_KEY=gsk_...` (this file is never committed).
3. On GitHub: add it as a repository secret named `AI_API_KEY`.

Set `SPIN_AI=off` to turn the AI off entirely.

## Bias Check

- **On every story:** each headline and summary is checked against a word list in the browser. Cards show a small flag (left-coded, right-coded or loaded wording). Opening a story shows the flagged words with neutral alternatives, other outlets' versions of the same story, and an optional AI check.
- **Bias Check page** (`/#bias-check`): paste any article and the check runs as soon as you paste. The link is optional; without it the outlet is spotted from the byline when possible. The word list labels lines left, right or loaded. The AI also points out slanted lines (attribution, emphasis, sourcing, missing context), quoting only lines that really appear in the text. The free keyless AI doesn't label sides, because the small model mixes them up; with a Groq key the AI labels sides too.
