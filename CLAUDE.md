# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install --cache /tmp/npm-cache   # install deps (use --cache flag to avoid permission issues)
npm run dev -- --port 5199           # run dev server (use a high port to avoid conflicts)
npm run build                        # production build — use this to check for errors before committing
git add . && git commit -m "..." && git push   # deploy: repo is live at github.com/Jvalle24/APEX-Capital
```

## Architecture

Single-file React app: all code lives in `src/apex-capital.jsx` (~1,800 lines). No CSS files — all styling is inline `style={{}}` objects using the `C` (colors) and `F` (fonts) token objects defined at the top.

**Data flow:**
1. User sends message → `callApex()` POSTs to Anthropic API (`claude-sonnet-4-6`) with `web_search_20250305` tool enabled
2. Response text contains embedded `CHART` and `PLAY_SUMMARY` code blocks
3. `MarkdownRenderer` splits response on chart blocks and renders prose + `ApexChart` components inline
4. `parsePlaySummary()` extracts the pipe-delimited `PLAY_SUMMARY` block into structured play objects
5. `PlaySummaryCard` renders each play; on mount it calls `useLivePlayPrices()` to fetch real option premiums from Yahoo Finance and replaces APEX's estimated entry with the live market price

**Vite proxies (critical — no backend exists):**
- `/api/price/:symbol` → `https://query1.finance.yahoo.com/v8/finance/chart/:symbol` — used for both stock prices and option premiums (OCC symbols like `NVDA270115C00200000`)
- `/api/chat` → `https://api.anthropic.com/v1/messages` — only used when no API key is set in the UI; when a key is present, the browser calls Anthropic directly with `anthropic-dangerous-direct-browser-access: true`

**OCC symbol parsing:**
`parseOCCSymbol(ticker, contractText)` converts APEX's natural-language contract descriptions (e.g. `"Jan2027 $200C"`) into Yahoo Finance OCC symbols. It assumes standard monthly expiry (third Friday). Spreads (`$X/$Y`) return `null` and fall back to manual price entry. `parseEntryPremiumFromContract()` extracts the `@ ~$18.50` premium as a fallback when APEX's ENTRY field contains a stock price instead of a premium.

**Portfolio persistence:**
All state (portfolio positions, thesis log, watchlist) is stored in `localStorage` under keys `apex_portfolio`, `apex_thesis_log`, `apex_watchlist`. A mount guard (`didMount` ref) prevents the initial render from overwriting saved data. A 5-minute interval writes a full backup to `apex_backup`. On mount, if any primary key is empty but a recent backup exists (<1hr old), state is auto-restored.

**System prompt:**
`buildSystemPrompt()` is called fresh on every API request (not a constant) so it always injects the current date/time. This is essential for grounding web search results to today's prices.

**Key rendering components:**
- `MarkdownRenderer` / `TextBlock` — parses `##`, `-`, `**bold**`, `★` stars, `---` dividers; splits on `CHART` blocks
- `ApexChart` — Recharts wrapper (bar, line, area, multi_bar, multi_line); color mapped from `accent|red|blue|amber` keys
- `PlaySummaryCard` — renders suggested plays; fetches live prices via `useLivePlayPrices()`; `+ ADD` inline form pre-fills suggested dollar amount
- `PortfolioView` + `PortfolioPositionCard` — live price polling every 60s; target/stop alert banners; ASK APEX button builds a context-aware prompt; Morning Brief button aggregates all positions
- `ExportDropdown` — 4-format export (clipboard, .md, .txt, .json); markdown export produces a pipe table; JSON export includes parsed `plays` array

**PLAY_SUMMARY format (pipe-delimited):**
```
TICKER|DIRECTION|VEHICLE|CONTRACT|SIZE%|ENTRY|TARGET|STOP|CONVICTION
```
For OPTIONS: ENTRY/TARGET/STOP = option premium prices (not stock price). For EQUITY: stock prices. SIZE% is % of $10,000. The app auto-corrects ENTRY using `parseEntryPremiumFromContract()` if APEX sends a stock price instead of a premium.
