# OVERWATCH

News · Intel · Odds. Israel, US politics and OSINT headlines from 20 sources, ranked by topic, plus live Polymarket odds.

A new edition is published at **06:00, 12:00 and 18:00 Israel time** by a GitHub Action (`.github/workflows/editions.yml`) and served on GitHub Pages. No server needed.

- **Run locally:** `node server.js` → http://localhost:7811
- **Build once:** `node server.js --build` (add `--force` to rebuild the current edition)
- **Publish a fresh edition now:** Actions tab → *Publish edition* → *Run workflow*

Sources, topic weights and Polymarket tags are at the top of `server.js`.

## AI (free)

Spin Check notes and the Bias Scanner's line-by-line AI analysis use [Groq](https://console.groq.com)'s free tier (no card needed).

1. Sign up at console.groq.com, open **API Keys**, and create a key.
2. Locally: put it in `.env` as `AI_API_KEY=gsk_...` (this file is never committed).
3. On GitHub: add it as a repository secret named `AI_API_KEY`.

Without a key everything still works; you just don't get the AI notes.

## Bias Scanner

Open the **Bias Scanner** tab, paste the article's link (used only to identify the outlet) and copy-paste the article text. A built-in word list flags left-coded, right-coded and loaded wording in the browser. With an AI key and the local server running, the AI also reads every line and flags framing (attribution, emphasis, sourcing, missing context), quoting only lines that really appear in the text.
