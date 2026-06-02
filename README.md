# APEX Capital — Personal Investment Terminal

An AI-powered hedge fund terminal that analyzes stocks, builds trade ideas sized for a **$10,000 personal portfolio**, and tracks your positions with live prices.

Built with React + Recharts. Powered by Claude (Anthropic API) with live web search.

---

## What it does

- **Terminal** — Chat with APEX, an AI hedge fund PM. Ask for trade ideas, macro scans, sector analysis. Responses include inline charts and structured play cards with entry/target/stop.
- **Portfolio** — Add plays from the terminal to a live portfolio tracker. Equity positions get real-time prices automatically. Options contracts fetch live premium prices from Yahoo Finance.
- **Watchlist** — Save tickers and fire a full thesis analysis with one click.
- **Thesis Log** — Every substantial APEX response is auto-saved for reference.

---

## Setup (5 minutes)

### 1. Install Node.js

If you don't have it: https://nodejs.org — download and install the **LTS** version.

Verify it worked:
```bash
node --version   # should show v18 or higher
npm --version
```

### 2. Get the project

**Option A — Clone from GitHub (recommended):**
```bash
git clone https://github.com/YOUR_USERNAME/apex-capital.git
cd apex-capital
```

**Option B — Download ZIP:**
Download and unzip the project, then open Terminal and `cd` into the folder.

### 3. Install dependencies

```bash
npm install
```

### 4. Get an Anthropic API key

1. Go to https://console.anthropic.com
2. Sign up / log in
3. Go to **API Keys** → **Create Key**
4. Copy the key (starts with `sk-ant-...`)

> You get free credits when you sign up. A typical session costs a few cents.

### 5. Run the app

```bash
npm run dev
```

Then open your browser and go to: **http://localhost:5173**

### 6. Enter your API key in the app

Click **🔑 SET KEY** in the top-right corner, paste your Anthropic API key, and click **SAVE**. The key is stored locally in your browser — it never leaves your machine.

---

## Usage tips

- Use the **quick action buttons** (Top 3 Ideas, Week Ahead, etc.) to get started fast
- Hit **+ ADD** on any play card to track it in the Portfolio tab
- **Morning Brief** appears in the terminal once you have open positions — one click gives you an update on all of them
- Portfolio positions auto-fetch live prices every 60 seconds
- Click **ASK APEX ›** on any portfolio card for a hold/trim/exit recommendation

---

## Troubleshooting

**The page is blank / app crashes**
→ Open browser DevTools (F12), check the Console tab for errors. Most likely the API key is missing or invalid.

**"API error 401"**
→ Your API key is wrong. Click 🔑 SET KEY and re-enter it.

**"Connection failed"**
→ Make sure `npm run dev` is still running in your terminal.

**Live prices not loading**
→ Yahoo Finance occasionally rate-limits. Hit ↻ REFRESH in the Portfolio tab to retry.

---

## Tech stack

- **React 18** + **Vite** (frontend)
- **Recharts** (charts)
- **Anthropic Claude** (`claude-sonnet-4-6`) with web search
- **Yahoo Finance** (live prices via Vite proxy — no extra API key needed)
- All data stored in browser `localStorage` — no backend, no database

---

## Important notes

- This is a **personal research tool**, not financial advice
- All trade ideas are for educational purposes only
- Your API key is stored only in your browser's localStorage
- No data is sent anywhere except to Anthropic's API when you send a message
