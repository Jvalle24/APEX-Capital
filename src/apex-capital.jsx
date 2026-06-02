import { useState, useEffect, useRef, useCallback } from 'react'
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

// ─── OCC symbol parser ───────────────────────────────────────────────────────
// Converts e.g. ticker="NVDA", contract="1 contract Jan2027 $200C @ ~$18.50 = $1,850 total"
// → "NVDA270115C00200000"  (Yahoo Finance OCC option symbol)
const MONTH_MAP = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 }

function getThirdFriday(year, month) {
  // month is 1-based
  const dayOfWeekFirst = new Date(year, month - 1, 1).getDay() // 0=Sun…5=Fri
  const daysToFirstFriday = (5 - dayOfWeekFirst + 7) % 7
  return 1 + daysToFirstFriday + 14 // third Friday
}

// Extract the option entry premium from a contract description string
// e.g. "1 contract Jan2027 $200C @ ~$18.50 = $1,850 total" → 18.50
function parseEntryPremiumFromContract(contractText) {
  if (!contractText) return null
  const m = contractText.match(/@\s*~?\$?([\d.]+)/)
  return m ? parseFloat(m[1]) : null
}

function parseOCCSymbol(ticker, contractText) {
  if (!contractText || !ticker) return null
  // Skip spreads — two strikes means two legs, OCC doesn't cover the combo
  if (/\d+\/\d+/.test(contractText) || /spread/i.test(contractText)) return null

  // Match: MonthYYYY  $STRIKE  C|P  (call/put optional suffix)
  const m = contractText.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{4})\s*\$?([\d.]+)\s*([CP])\b/i
  )
  if (!m) return null

  const month = MONTH_MAP[m[1].toLowerCase().slice(0, 3)]
  if (!month) return null
  const year = parseInt(m[2])
  const strike = parseFloat(m[3])
  const type = m[4].toUpperCase() // C or P

  const yy = String(year).slice(2)
  const mm = String(month).padStart(2, '0')
  const dd = String(getThirdFriday(year, month)).padStart(2, '0')
  const strikeStr = String(Math.round(strike * 1000)).padStart(8, '0')

  return `${ticker}${yy}${mm}${dd}${type}${strikeStr}`
}

// ─── Design tokens ───────────────────────────────────────────────────────────
const C = {
  bg:      '#0a0a0f',
  surface: '#12121a',
  card:    '#1a1a28',
  border:  '#2a2a3a',
  muted:   '#4a4a6a',
  text:    '#e8e8f0',
  sub:     '#8888aa',
  green:   '#00e5a0',
  red:     '#ff4757',
  amber:   '#ffb347',
  blue:    '#4facfe',
  purple:  '#a78bfa',
}

const F = {
  serif:  "'DM Serif Display', serif",
  mono:   "'JetBrains Mono', monospace",
  sans:   "'DM Sans', sans-serif",
}

// ─── System prompt ────────────────────────────────────────────────────────────
function buildSystemPrompt() {
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })

  return `You are APEX — an elite hedge fund portfolio manager who manages a personal $10,000 investment account. You combine macro analysis, technical setups, and options flow to find asymmetric opportunities. You are direct, decisive, and data-driven. You never hedge with disclaimers — you give actual actionable positions.

TODAY'S DATE AND TIME: ${dateStr} at ${timeStr}
This is the exact current date. All prices, news, and data you cite must be from TODAY or the most recent trading session. Your training data is outdated — never quote a price from memory. Always use web search to get live data.

PRICE DATA RULES — MANDATORY:
- ALWAYS run a web search before quoting any stock price, option premium, index level, or market stat
- Search for "[TICKER] stock price today" or "[TICKER] current price ${dateStr}" to get the latest quote
- If a ticker's last close is what you found, state it as "closed at $X on [date]" — never present it as the current price if the market is open
- Never use prices from your training data — they are always stale
- If web search returns no result for a price, say so explicitly rather than guessing

OPTIONS CONTRACT RULES — MANDATORY, NO EXCEPTIONS:
- NEVER invent or estimate option strikes, premiums, or expiry dates — every contract detail must come from a real options chain found via web search
- Before suggesting ANY contract: search "[TICKER] options chain [expiry month] [year]" and use only strikes and premiums you find in the results
- Weeklies, monthlies, and LEAPS are all fine — but the expiry date must be a real listed expiration, not a made-up date
- The premium you quote must be the actual market price (bid/ask midpoint) found via search — if you cannot verify the exact premium, give a range (e.g. "$11–$13") and say it is approximate
- If search returns no options data, say so explicitly — do not fill in numbers from memory

ANTI-HALLUCINATION RULES — ALL DATA:
Every single number you cite must be verified by web search. This includes:
- Stock prices → search "[TICKER] stock price today ${dateStr}"
- Option premiums and strikes → search "[TICKER] options chain"
- Earnings dates → search "[TICKER] earnings date ${dateStr}"
- Revenue, EPS, guidance figures → search "[TICKER] earnings results" or "[TICKER] financials"
- Analyst price targets → search "[TICKER] analyst price target ${dateStr}"
- Index levels (SPY, QQQ, VIX, etc.) → search current level before citing
- Macro data (CPI, PCE, Fed rate, etc.) → search for the latest release
- News and catalysts → search "[TICKER] news ${dateStr}"
If you are not certain a number came from a live search result, do not state it as fact — flag it as unverified or skip it.

PORTFOLIO RULES:
- Total account size: $10,000
- Prefer straight calls and puts for simplicity and liquidity — do NOT suggest call spreads or bull call spreads
- For bullish plays: use straight calls (single leg) only
- For bearish plays: use straight puts or put spreads only — NO short-selling common shares
- Every options position includes: number of contracts, expiry, strike, premium per contract, total dollar cost
- Every equity position includes: number of shares, price per share, total dollar cost
- Note when assuming fractional share capability
- Warn if a position would be <$200 (too small to be practical)
- Sum of all position sizes must not exceed $10,000
- Always show cash reserve remaining after positions

RESPONSE FORMAT:
- Use ## for section headers
- Use ### for sub-headers
- Use **bold** for key terms, tickers, and numbers
- Use - for bullet lists
- Use ★ (filled) and ☆ (empty) for conviction ratings (1–5 stars)
- Use --- to separate major sections

CHARTS: When data would benefit from visualization, embed a chart using this exact format:
\`\`\`CHART
TYPE: bar|line|area|multi_bar|multi_line
TITLE: Chart Title
LABELS: label1,label2,label3
VALUES: 10,20,30
COLOR: accent|red|blue|amber
\`\`\`
For multi-series: VALUES_1: 10,20,30 | Series Name  (one line per series, no VALUES key)

PLAY SUMMARY: End EVERY response that includes trade ideas with a PLAY_SUMMARY block (one row per position):
\`\`\`PLAY_SUMMARY
TICKER|DIRECTION|VEHICLE|CONTRACT|SIZE%|ENTRY|TARGET|STOP|CONVICTION
\`\`\`
CONTRACT field: full spec, e.g. "1 contract Jan2027 $200C @ ~$18.50 = $1,850 total" or "5 shares @ ~$195/share = $975 total"
SIZE% is percentage of $10,000 account (e.g. 18.5 means 18.5% = $1,850)
CONVICTION is 1–5 integer

CRITICAL — ENTRY/TARGET/STOP rules:
- For EQUITY positions: ENTRY/TARGET/STOP = stock price (e.g. 195.00 / 230.00 / 182.00)
- For OPTIONS positions (calls, puts, spreads): ENTRY/TARGET/STOP = option PREMIUM price, NOT the stock price
  - ENTRY = option premium you're paying now (e.g. 18.50 for a $200C @ $18.50)
  - TARGET = option premium at which you'd take profit (e.g. 35.00 = premium doubled)
  - STOP = option premium at which you'd cut the loss (e.g. 9.00 = 50% stop on premium)
  This is essential — the app tracks live option premium prices and calculates P&L using these values.`
}

// ─── Parsers ──────────────────────────────────────────────────────────────────
function parseChartBlock(raw) {
  const lines = raw.trim().split('\n')
  const obj = {}
  lines.forEach(l => {
    const idx = l.indexOf(':')
    if (idx === -1) return
    const key = l.slice(0, idx).trim().toUpperCase()
    const val = l.slice(idx + 1).trim()
    obj[key] = val
  })

  const type = obj.TYPE || 'bar'
  const title = obj.TITLE || ''
  const color = obj.COLOR || 'accent'

  if (type === 'multi_bar' || type === 'multi_line') {
    const series = []
    Object.keys(obj).forEach(k => {
      if (!k.startsWith('VALUES_')) return
      const parts = obj[k].split('|')
      const vals = parts[0].split(',').map(v => parseFloat(v.trim()))
      const name = parts[1] ? parts[1].trim() : k
      series.push({ name, values: vals })
    })
    const labels = obj.LABELS ? obj.LABELS.split(',').map(l => l.trim()) : []
    const data = labels.map((label, i) => {
      const row = { label }
      series.forEach(s => { row[s.name] = s.values[i] ?? 0 })
      return row
    })
    return { type, title, color, data, series: series.map(s => s.name) }
  }

  const labels = obj.LABELS ? obj.LABELS.split(',').map(l => l.trim()) : []
  const values = obj.VALUES ? obj.VALUES.split(',').map(v => parseFloat(v.trim())) : []
  const data = labels.map((label, i) => ({ label, value: values[i] ?? 0 }))
  return { type, title, color, data, series: null }
}

function parsePlaySummary(text) {
  const match = text.match(/```PLAY_SUMMARY\n([\s\S]*?)```/)
  if (!match) return []
  return match[1].trim().split('\n').filter(l => {
    const t = l.trim()
    return t && !t.startsWith('TICKER')
  }).map(l => {
    const [ticker, direction, vehicle, contract, size, entry, target, stop, conviction] = l.split('|').map(s => s?.trim())
    return { ticker, direction, vehicle, contract, size: parseFloat(size) || 0, entry, target, stop, conviction: parseInt(conviction) || 3 }
  })
}

function getBodyWithoutPlaySummary(text) {
  return text.replace(/```PLAY_SUMMARY[\s\S]*?```/g, '').trimEnd()
}

// ─── InlineMarkdown ───────────────────────────────────────────────────────────
function InlineMarkdown({ text }) {
  const parts = []
  let remaining = text
  let key = 0

  while (remaining.length) {
    const boldIdx = remaining.indexOf('**')
    if (boldIdx === -1) {
      parts.push(<span key={key++}>{remaining}</span>)
      break
    }
    if (boldIdx > 0) {
      parts.push(<span key={key++}>{remaining.slice(0, boldIdx)}</span>)
    }
    const closeIdx = remaining.indexOf('**', boldIdx + 2)
    if (closeIdx === -1) {
      parts.push(<span key={key++}>{remaining.slice(boldIdx)}</span>)
      break
    }
    parts.push(<strong key={key++} style={{ color: C.text, fontWeight: 600 }}>{remaining.slice(boldIdx + 2, closeIdx)}</strong>)
    remaining = remaining.slice(closeIdx + 2)
  }

  return <>{parts.map((p, i) => {
    if (typeof p === 'string') {
      return <span key={i}>{p}</span>
    }
    return p
  })}</>
}

// ─── MarkdownRenderer ─────────────────────────────────────────────────────────
function MarkdownRenderer({ content }) {
  const chartRegex = /```CHART\n([\s\S]*?)```/g
  const segments = []
  let lastIndex = 0
  let match

  while ((match = chartRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', raw: content.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'chart', raw: match[1] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < content.length) {
    segments.push({ type: 'text', raw: content.slice(lastIndex) })
  }

  return (
    <div>
      {segments.map((seg, si) => {
        if (seg.type === 'chart') {
          const parsed = parseChartBlock(seg.raw)
          return <ApexChart key={si} {...parsed} />
        }
        return <TextBlock key={si} text={seg.raw} />
      })}
    </div>
  )
}

function TextBlock({ text }) {
  const lines = text.split('\n')
  const elements = []
  let i = 0
  let listItems = []

  const flushList = () => {
    if (listItems.length) {
      elements.push(
        <ul key={`ul-${i}`} style={{ margin: '8px 0 8px 0', paddingLeft: 0, listStyle: 'none' }}>
          {listItems.map((item, li) => (
            <li key={li} style={{ display: 'flex', gap: 8, marginBottom: 4, color: C.sub, fontSize: 14, lineHeight: 1.6 }}>
              <span style={{ color: C.green, flexShrink: 0, marginTop: 1 }}>▸</span>
              <span><InlineMarkdown text={item} /></span>
            </li>
          ))}
        </ul>
      )
      listItems = []
    }
  }

  while (i < lines.length) {
    const line = lines[i]

    if (/^---+$/.test(line.trim())) {
      flushList()
      elements.push(<hr key={`hr-${i}`} style={{ border: 'none', borderTop: `1px solid ${C.border}`, margin: '16px 0' }} />)
      i++; continue
    }

    if (line.startsWith('### ')) {
      flushList()
      elements.push(
        <h3 key={`h3-${i}`} style={{ fontFamily: F.serif, fontSize: 15, color: C.blue, marginTop: 14, marginBottom: 6 }}>
          <InlineMarkdown text={line.slice(4)} />
        </h3>
      )
      i++; continue
    }

    if (line.startsWith('## ')) {
      flushList()
      elements.push(
        <h2 key={`h2-${i}`} style={{ fontFamily: F.serif, fontSize: 18, color: C.green, marginTop: 18, marginBottom: 8 }}>
          <InlineMarkdown text={line.slice(3)} />
        </h2>
      )
      i++; continue
    }

    if (line.startsWith('# ')) {
      flushList()
      elements.push(
        <h1 key={`h1-${i}`} style={{ fontFamily: F.serif, fontSize: 22, color: C.text, marginTop: 20, marginBottom: 10 }}>
          <InlineMarkdown text={line.slice(2)} />
        </h1>
      )
      i++; continue
    }

    if (/^\d+\.\s/.test(line)) {
      flushList()
      const numMatch = line.match(/^(\d+)\.\s(.*)/)
      elements.push(
        <div key={`ol-${i}`} style={{ display: 'flex', gap: 10, marginBottom: 4, color: C.sub, fontSize: 14, lineHeight: 1.6 }}>
          <span style={{ color: C.amber, fontFamily: F.mono, fontSize: 12, flexShrink: 0, marginTop: 2 }}>{numMatch[1]}.</span>
          <span><InlineMarkdown text={numMatch[2]} /></span>
        </div>
      )
      i++; continue
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      listItems.push(line.slice(2))
      i++; continue
    }

    flushList()

    if (line.trim() === '') {
      elements.push(<div key={`sp-${i}`} style={{ height: 8 }} />)
      i++; continue
    }

    // Star ratings on their own line
    if (/^[★☆]+$/.test(line.trim())) {
      elements.push(
        <div key={`stars-${i}`} style={{ fontSize: 18, color: C.amber, letterSpacing: 2, margin: '4px 0' }}>
          {line.trim()}
        </div>
      )
      i++; continue
    }

    elements.push(
      <p key={`p-${i}`} style={{ fontSize: 14, lineHeight: 1.7, color: C.sub, margin: '4px 0' }}>
        <InlineMarkdown text={line} />
      </p>
    )
    i++
  }

  flushList()
  return <>{elements}</>
}

// ─── ApexChart ────────────────────────────────────────────────────────────────
const CHART_COLORS = [C.green, C.blue, C.amber, C.red, C.purple]

function colorFromKey(key) {
  return key === 'red' ? C.red : key === 'blue' ? C.blue : key === 'amber' ? C.amber : C.green
}

function ApexChart({ type, title, color, data, series }) {
  const fill = colorFromKey(color)

  const axisStyle = { fontFamily: F.mono, fontSize: 10, fill: C.muted }
  const gridStyle = { stroke: C.border, strokeDasharray: '3 3' }
  const tooltipStyle = {
    contentStyle: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, fontFamily: F.mono, fontSize: 12 },
    labelStyle: { color: C.text },
    itemStyle: { color: C.green },
  }

  const chartProps = {
    data,
    margin: { top: 4, right: 8, left: -16, bottom: 0 },
  }

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      padding: '16px 16px 8px',
      margin: '14px 0',
    }}>
      {title && (
        <div style={{ fontFamily: F.mono, fontSize: 11, color: C.sub, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
          {title}
        </div>
      )}
      <ResponsiveContainer width="100%" height={200}>
        {type === 'line' ? (
          <LineChart {...chartProps}>
            <CartesianGrid {...gridStyle} />
            <XAxis dataKey="label" tick={axisStyle} />
            <YAxis tick={axisStyle} />
            <Tooltip {...tooltipStyle} />
            <Line type="monotone" dataKey="value" stroke={fill} strokeWidth={2} dot={{ fill, r: 3 }} />
          </LineChart>
        ) : type === 'area' ? (
          <AreaChart {...chartProps}>
            <defs>
              <linearGradient id="agrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={fill} stopOpacity={0.3} />
                <stop offset="95%" stopColor={fill} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid {...gridStyle} />
            <XAxis dataKey="label" tick={axisStyle} />
            <YAxis tick={axisStyle} />
            <Tooltip {...tooltipStyle} />
            <Area type="monotone" dataKey="value" stroke={fill} fill="url(#agrad)" strokeWidth={2} />
          </AreaChart>
        ) : type === 'multi_line' ? (
          <LineChart {...chartProps}>
            <CartesianGrid {...gridStyle} />
            <XAxis dataKey="label" tick={axisStyle} />
            <YAxis tick={axisStyle} />
            <Tooltip {...tooltipStyle} />
            <Legend wrapperStyle={{ fontFamily: F.mono, fontSize: 10, color: C.sub }} />
            {series && series.map((s, idx) => (
              <Line key={s} type="monotone" dataKey={s} stroke={CHART_COLORS[idx % CHART_COLORS.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        ) : type === 'multi_bar' ? (
          <BarChart {...chartProps}>
            <CartesianGrid {...gridStyle} />
            <XAxis dataKey="label" tick={axisStyle} />
            <YAxis tick={axisStyle} />
            <Tooltip {...tooltipStyle} />
            <Legend wrapperStyle={{ fontFamily: F.mono, fontSize: 10, color: C.sub }} />
            {series && series.map((s, idx) => (
              <Bar key={s} dataKey={s} fill={CHART_COLORS[idx % CHART_COLORS.length]} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        ) : (
          <BarChart {...chartProps}>
            <CartesianGrid {...gridStyle} />
            <XAxis dataKey="label" tick={axisStyle} />
            <YAxis tick={axisStyle} />
            <Tooltip {...tooltipStyle} />
            <Bar dataKey="value" fill={fill} radius={[3, 3, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

// ─── Live option price fetcher for play cards ─────────────────────────────────
// Fetches the real market premium for a suggested option contract the moment
// APEX responds — so the user always sees the actual price, not APEX's estimate.
function useLivePlayPrices(plays) {
  const [livePrices, setLivePrices] = useState({}) // keyed by play index

  useEffect(() => {
    if (!plays?.length) return
    let cancelled = false

    async function fetchAll() {
      const results = await Promise.all(
        plays.map(async (play, i) => {
          const isEq = /equity|stock|share/i.test(play.vehicle || '')
          if (isEq) {
            // For equity: fetch stock price
            try {
              const res = await window.fetch(`/api/price/${play.ticker}?interval=1d&range=1d`)
              const data = await res.json()
              const meta = data?.chart?.result?.[0]?.meta
              if (meta?.regularMarketPrice) return { i, price: meta.regularMarketPrice, type: 'stock' }
            } catch {}
            return { i, price: null }
          } else {
            // For options: parse OCC symbol and fetch real premium
            const occ = parseOCCSymbol(play.ticker, play.contract)
            if (!occ) return { i, price: null, occ: null }
            try {
              const res = await window.fetch(`/api/price/${encodeURIComponent(occ)}?interval=1d&range=1d`)
              const data = await res.json()
              const meta = data?.chart?.result?.[0]?.meta
              if (meta?.regularMarketPrice) return { i, price: meta.regularMarketPrice, occ, type: 'option' }
            } catch {}
            return { i, price: null, occ, type: 'option' }
          }
        })
      )
      if (cancelled) return
      const map = {}
      results.forEach(r => { map[r.i] = r })
      setLivePrices(map)
    }

    fetchAll()
    return () => { cancelled = true }
  }, [plays?.map(p => p.contract + p.ticker).join('|')]) // eslint-disable-line

  return livePrices
}

// ─── PlaySummaryCard ──────────────────────────────────────────────────────────
function Stars({ n }) {
  return (
    <span style={{ fontFamily: F.mono, fontSize: 13, letterSpacing: 1, color: C.amber }}>
      {Array.from({ length: 5 }, (_, i) => i < n ? '★' : '☆').join('')}
    </span>
  )
}

function PlaySummaryCard({ plays, onAddToPortfolio, portfolioPositions = [] }) {
  const [addingIdx, setAddingIdx] = useState(null)
  const [addAmount, setAddAmount] = useState('')
  const livePlayPrices = useLivePlayPrices(plays)

  if (!plays.length) return null

  const totalPct = plays.reduce((s, p) => s + p.size, 0)
  const totalDollar = (totalPct / 100) * 10000
  const cashReserve = 10000 - totalDollar
  const overAllocated = totalPct > 100

  function handleOpenAdd(i, play) {
    setAddingIdx(i)
    // Pre-fill with suggested dollar amount; live price shown separately
    setAddAmount(String(Math.round((play.size / 100) * 10000)))
  }

  function handleConfirmAdd(play, livePrice) {
    const dollar = parseFloat(addAmount)
    if (!isNaN(dollar) && dollar > 0 && onAddToPortfolio) {
      // Use live premium as entry if available, else fall back to APEX's estimate
      const entryOverride = livePrice != null ? String(livePrice) : undefined
      onAddToPortfolio({ ...play, dollarInvested: dollar, ...(entryOverride ? { entry: entryOverride } : {}) })
    }
    setAddingIdx(null)
    setAddAmount('')
  }

  return (
    <div style={{ marginTop: 16 }}>
      {plays.map((play, i) => {
        const isLong = play.direction?.toUpperCase() === 'LONG'
        const dirColor = isLong ? C.green : C.red
        const dollar = (play.size / 100) * 10000
        const alreadyAdded = portfolioPositions.some(
          p => p.ticker === play.ticker && p.entry === play.entry && p.status === 'open'
        )

        // Live price from Yahoo Finance (real market data)
        const liveData = livePlayPrices[i]
        const livePrice = liveData?.price ?? null
        const isEq = /equity|stock|share/i.test(play.vehicle || '')
        const hasFetchedLive = liveData !== undefined // fetch attempted
        const liveAvailable = livePrice != null

        // Use live price for entry in R/R calc if available, else APEX's estimate
        const effectiveEntry = liveAvailable ? livePrice : parseFloat(play.entry)
        const targetNum = parseFloat(play.target)
        const stopNum = parseFloat(play.stop)
        let rrRatio = null
        let upPct = null
        let downPct = null
        if (!isNaN(effectiveEntry) && !isNaN(targetNum) && !isNaN(stopNum) && effectiveEntry > 0) {
          const reward = Math.abs(targetNum - effectiveEntry)
          const risk = Math.abs(effectiveEntry - stopNum)
          rrRatio = risk > 0 ? (reward / risk).toFixed(1) : null
          upPct = ((reward / effectiveEntry) * 100).toFixed(1)
          downPct = ((risk / effectiveEntry) * 100).toFixed(1)
        }

        return (
          <div key={i} style={{
            background: C.card,
            border: `1px solid ${alreadyAdded ? C.green + '60' : C.border}`,
            borderRadius: 10,
            marginBottom: 10,
            overflow: 'hidden',
          }}>
            {/* Header bar */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              borderBottom: `1px solid ${C.border}`,
              flexWrap: 'wrap',
            }}>
              <span style={{ fontFamily: F.mono, fontSize: 18, fontWeight: 700, color: C.text, letterSpacing: 1 }}>
                {play.ticker}
              </span>
              <span style={{
                fontFamily: F.mono, fontSize: 11, fontWeight: 700,
                color: dirColor, background: dirColor + '20',
                borderRadius: 4, padding: '2px 8px', letterSpacing: 1,
              }}>
                {play.direction?.toUpperCase()}
              </span>
              <span style={{ fontFamily: F.mono, fontSize: 11, color: C.muted, background: C.surface, borderRadius: 4, padding: '2px 8px' }}>
                {play.vehicle}
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: F.mono, fontSize: 13, color: dirColor, fontWeight: 600 }}>
                    {play.size}%
                  </div>
                  <div style={{ fontFamily: F.mono, fontSize: 11, color: C.muted }}>
                    ${dollar.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </div>
                </div>
                <Stars n={play.conviction} />
                {onAddToPortfolio && (
                  alreadyAdded ? (
                    <span style={{ fontFamily: F.mono, fontSize: 10, color: C.green, background: C.green + '15', borderRadius: 6, padding: '4px 10px' }}>
                      ✓ IN PORTFOLIO
                    </span>
                  ) : (
                    <button
                      onClick={() => addingIdx === i ? setAddingIdx(null) : handleOpenAdd(i, play)}
                      style={{
                        background: addingIdx === i ? C.green + '20' : C.surface,
                        border: `1px solid ${addingIdx === i ? C.green : C.border}`,
                        borderRadius: 6, color: addingIdx === i ? C.green : C.sub,
                        fontFamily: F.mono, fontSize: 11, fontWeight: 700,
                        padding: '4px 12px', cursor: 'pointer', whiteSpace: 'nowrap',
                      }}
                    >
                      + ADD
                    </button>
                  )
                )}
              </div>
            </div>

            {/* Inline add form */}
            {addingIdx === i && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
                background: C.green + '08',
              }}>
                <span style={{ fontFamily: F.mono, fontSize: 11, color: C.green }}>AMOUNT TO INVEST</span>
                <span style={{ fontFamily: F.mono, fontSize: 13, color: C.muted }}>$</span>
                <input
                  autoFocus
                  type="number"
                  value={addAmount}
                  onChange={e => setAddAmount(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleConfirmAdd(play); if (e.key === 'Escape') setAddingIdx(null) }}
                  style={{
                    width: 100, background: C.card, border: `1px solid ${C.green}`,
                    borderRadius: 6, color: C.text, fontFamily: F.mono, fontSize: 13,
                    padding: '5px 10px', outline: 'none',
                  }}
                />
                <span style={{ fontFamily: F.mono, fontSize: 11, color: C.muted }}>
                  (suggested: ${Math.round(dollar).toLocaleString()})
                </span>
                <button
                  onClick={() => handleConfirmAdd(play, livePrice)}
                  style={{
                    background: C.green, border: 'none', borderRadius: 6,
                    color: '#000', fontFamily: F.mono, fontSize: 11, fontWeight: 700,
                    padding: '5px 14px', cursor: 'pointer',
                  }}
                >
                  CONFIRM
                </button>
                <button
                  onClick={() => setAddingIdx(null)}
                  style={{
                    background: 'none', border: `1px solid ${C.border}`, borderRadius: 6,
                    color: C.muted, fontFamily: F.mono, fontSize: 11,
                    padding: '5px 10px', cursor: 'pointer',
                  }}
                >
                  CANCEL
                </button>
              </div>
            )}

            {/* Contract detail + live price */}
            {play.contract && (
              <div style={{ padding: '8px 14px', borderBottom: `1px solid ${C.border}`, background: C.blue + '08', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <span style={{ fontFamily: F.mono, fontSize: 10, color: C.blue, letterSpacing: 1, textTransform: 'uppercase', flexShrink: 0 }}>
                  CONTRACT DETAIL
                </span>
                <span style={{ fontFamily: F.mono, fontSize: 12, color: C.text, flex: 1 }}>
                  {play.contract}
                </span>
                {/* Live market price badge */}
                {!isEq && (
                  <span style={{
                    fontFamily: F.mono, fontSize: 11, flexShrink: 0,
                    padding: '2px 10px', borderRadius: 5,
                    background: liveAvailable ? C.green + '20' : C.amber + '15',
                    border: `1px solid ${liveAvailable ? C.green : C.amber}`,
                    color: liveAvailable ? C.green : C.amber,
                  }}>
                    {!hasFetchedLive
                      ? '⟳ fetching live…'
                      : liveAvailable
                        ? `● LIVE $${livePrice.toFixed(2)}`
                        : '⚠ price unavailable'}
                  </span>
                )}
                {isEq && liveAvailable && (
                  <span style={{ fontFamily: F.mono, fontSize: 11, color: C.green, background: C.green + '20', border: `1px solid ${C.green}`, borderRadius: 5, padding: '2px 10px', flexShrink: 0 }}>
                    ● LIVE ${livePrice.toFixed(2)}
                  </span>
                )}
              </div>
            )}

            {/* Entry / Target / Stop */}
            <div style={{ display: 'flex', gap: 0 }}>
              {[
                { label: 'ENTRY', val: liveAvailable ? livePrice.toFixed(2) : play.entry, col: liveAvailable ? C.green : C.sub, live: liveAvailable },
                { label: 'TARGET', val: play.target, col: C.green },
                { label: 'STOP', val: play.stop, col: C.red },
              ].map(({ label, val, col, live }) => (
                <div key={label} style={{
                  flex: 1, padding: '10px 14px',
                  borderRight: `1px solid ${C.border}`,
                  borderTop: `1px solid ${C.border}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                    <span style={{ fontFamily: F.mono, fontSize: 10, color: C.muted, letterSpacing: 1 }}>{label}</span>
                    {live && <span style={{ fontFamily: F.mono, fontSize: 9, color: C.green, background: C.green + '20', borderRadius: 3, padding: '0 4px' }}>LIVE</span>}
                  </div>
                  <div style={{ fontFamily: F.mono, fontSize: 14, color: col, fontWeight: 600 }}>{val ?? '—'}</div>
                </div>
              ))}

              {/* R/R ratio */}
              <div style={{ flex: 1.2, padding: '10px 14px', borderTop: `1px solid ${C.border}` }}>
                <div style={{ fontFamily: F.mono, fontSize: 10, color: C.muted, marginBottom: 4, letterSpacing: 1 }}>R/R RATIO</div>
                {rrRatio ? (
                  <>
                    <div style={{ fontFamily: F.mono, fontSize: 14, color: C.amber, fontWeight: 600 }}>{rrRatio}x</div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 6, height: 4, borderRadius: 2, overflow: 'hidden', background: C.border }}>
                      <div style={{ flex: parseFloat(downPct), background: C.red, borderRadius: 2 }} />
                      <div style={{ flex: parseFloat(upPct), background: C.green, borderRadius: 2 }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                      <span style={{ fontFamily: F.mono, fontSize: 9, color: C.red }}>-{downPct}%</span>
                      <span style={{ fontFamily: F.mono, fontSize: 9, color: C.green }}>+{upPct}%</span>
                    </div>
                  </>
                ) : (
                  <div style={{ fontFamily: F.mono, fontSize: 14, color: C.muted }}>—</div>
                )}
              </div>
            </div>
          </div>
        )
      })}

      {/* Portfolio footer */}
      <div style={{
        background: C.surface,
        border: `1px solid ${overAllocated ? C.red : C.border}`,
        borderRadius: 10,
        padding: '12px 16px',
        marginTop: 4,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.muted, marginBottom: 2 }}>TOTAL DEPLOYED</div>
            <div style={{ fontFamily: F.mono, fontSize: 15, color: overAllocated ? C.red : C.text, fontWeight: 600 }}>
              ${totalDollar.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              <span style={{ fontSize: 11, color: C.muted, marginLeft: 6 }}>({totalPct.toFixed(1)}%)</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.muted, marginBottom: 2 }}>CASH RESERVE</div>
            <div style={{ fontFamily: F.mono, fontSize: 15, color: cashReserve < 0 ? C.red : C.green, fontWeight: 600 }}>
              ${Math.max(0, cashReserve).toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
          </div>
        </div>
        {/* Allocation bar */}
        <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${Math.min(totalPct, 100)}%`,
            background: overAllocated ? C.red : totalPct > 80 ? C.amber : C.green,
            borderRadius: 3,
            transition: 'width 0.4s ease',
          }} />
        </div>
        {overAllocated && (
          <div style={{ fontFamily: F.mono, fontSize: 11, color: C.red, marginTop: 6 }}>
            ⚠ Over-allocated by {(totalPct - 100).toFixed(1)}% (${((totalPct - 100) / 100 * 10000).toLocaleString('en-US', { maximumFractionDigits: 0 })})
          </div>
        )}
      </div>
    </div>
  )
}

// ─── PortfolioView ────────────────────────────────────────────────────────────
function PortfolioView({ positions, onUpdate, onClose, onDelete, onAskApex }) {
  const open = positions.filter(p => p.status === 'open')
  const closed = positions.filter(p => p.status === 'closed')

  // ── Live price fetching ──────────────────────────────────────────────────
  const [livePrices, setLivePrices] = useState({})       // keyed by ticker symbol
  const [liveOptionPrices, setLiveOptionPrices] = useState({}) // keyed by pos.id
  const [pricesLoading, setPricesLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [priceError, setPriceError] = useState(false)

  async function fetchYahooChart(symbol) {
    const res = await window.fetch(`/api/price/${encodeURIComponent(symbol)}?interval=1d&range=1d`)
    const data = await res.json()
    const meta = data?.chart?.result?.[0]?.meta
    if (!meta) return null
    const prev = meta.chartPreviousClose ?? meta.previousClose
    const price = meta.regularMarketPrice
    const change = prev ? price - prev : null
    const changePct = prev ? (change / prev) * 100 : null
    return { symbol: meta.symbol ?? symbol, price, change, changePct, marketState: meta.marketState }
  }

  const refreshPrices = useCallback(async () => {
    const positions = open  // snapshot inside callback
    if (!positions.length) return
    setPricesLoading(true)
    setPriceError(false)

    try {
      // ── 1. Underlying stock prices (batch parallel) ─────────────────────────
      const tickers = [...new Set(positions.map(p => p.ticker))]
      const stockResults = await Promise.all(tickers.map(sym => fetchYahooChart(sym).catch(() => null)))
      const stockMap = {}
      stockResults.forEach(q => { if (q?.symbol) stockMap[q.symbol] = q })
      setLivePrices(stockMap)

      // ── 2. Option contract prices (per non-equity position) ─────────────────
      const optionPositions = positions.filter(p => !/equity|stock|share/i.test(p.vehicle || ''))
      const optionResults = await Promise.all(
        optionPositions.map(async pos => {
          const occ = parseOCCSymbol(pos.ticker, pos.contract)
          if (!occ) return { id: pos.id, occ: null, quote: null }
          const quote = await fetchYahooChart(occ).catch(() => null)
          return { id: pos.id, occ, quote }
        })
      )
      const optMap = {}
      optionResults.forEach(({ id, occ, quote }) => {
        optMap[id] = { occ, quote }
      })
      setLiveOptionPrices(optMap)

      setLastUpdated(new Date())
    } catch {
      setPriceError(true)
    } finally {
      setPricesLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open.map(p => p.id).join(',')])

  // Fetch on mount + when open positions change, then refresh every 60s
  useEffect(() => {
    refreshPrices()
    const id = setInterval(refreshPrices, 60000)
    return () => clearInterval(id)
  }, [refreshPrices])

  const totalInvested = open.reduce((s, p) => s + p.dollarInvested, 0)
  const isEquity = (v) => /equity|stock|share/i.test(v || '')

  const totalPnl = open.reduce((s, p) => {
    const liveStockQuote = livePrices[p.ticker]
    const liveOptQuote = liveOptionPrices[p.id]?.quote
    let rawCur
    if (isEquity(p.vehicle) && liveStockQuote?.price != null) {
      rawCur = liveStockQuote.price
    } else if (!isEquity(p.vehicle) && liveOptQuote?.price != null) {
      rawCur = liveOptQuote.price
    } else {
      rawCur = parseFloat(p.currentPrice)
    }
    const ent = parseFloat(p.entry)
    if (!isNaN(rawCur) && !isNaN(ent) && ent > 0) {
      const pct = p.direction?.toUpperCase() === 'LONG'
        ? (rawCur - ent) / ent
        : (ent - rawCur) / ent
      return s + pct * p.dollarInvested
    }
    return s
  }, 0)
  const realizedPnl = closed.reduce((s, p) => s + (p.realizedPnl || 0), 0)
  const cashUsed = open.reduce((s, p) => s + p.dollarInvested, 0)
  const cashRemaining = 10000 - cashUsed
  const hasPnl = totalPnl !== 0

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
      {/* Live price status bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
        padding: '8px 14px', background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 8,
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: priceError ? C.red : pricesLoading ? C.amber : C.green,
            display: 'inline-block',
            boxShadow: pricesLoading ? 'none' : `0 0 6px ${priceError ? C.red : C.green}`,
          }} />
          <span style={{ fontFamily: F.mono, fontSize: 10, color: C.sub }}>
            {priceError ? 'PRICE FEED ERROR' : pricesLoading ? 'REFRESHING...' : 'LIVE PRICES'}
          </span>
        </span>
        {lastUpdated && (
          <span style={{ fontFamily: F.mono, fontSize: 10, color: C.muted }}>
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
        <button
          onClick={refreshPrices}
          disabled={pricesLoading}
          style={{
            marginLeft: 'auto', background: 'none', border: `1px solid ${C.border}`,
            borderRadius: 5, color: C.sub, fontFamily: F.mono, fontSize: 10,
            padding: '3px 10px', cursor: pricesLoading ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.green; e.currentTarget.style.color = C.green }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.sub }}
        >
          ↻ REFRESH
        </button>
        {/* Live price pills */}
        {Object.entries(livePrices).map(([sym, q]) => (
          <span key={sym} style={{ fontFamily: F.mono, fontSize: 11, color: C.text }}>
            <span style={{ color: C.muted }}>{sym} </span>
            <span style={{ fontWeight: 700 }}>${q.price?.toFixed(2)}</span>
            <span style={{ marginLeft: 4, color: q.change >= 0 ? C.green : C.red, fontSize: 10 }}>
              {q.change >= 0 ? '+' : ''}{q.changePct?.toFixed(2)}%
            </span>
          </span>
        ))}
      </div>

      {/* Summary bar */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20,
      }}>
        {[
          { label: 'INVESTED', value: `$${totalInvested.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, color: C.text },
          { label: 'UNREALIZED P&L', value: hasPnl ? `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(0)}` : '—', color: hasPnl ? (totalPnl >= 0 ? C.green : C.red) : C.muted },
          { label: 'REALIZED P&L', value: realizedPnl !== 0 ? `${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toFixed(0)}` : '—', color: realizedPnl !== 0 ? (realizedPnl >= 0 ? C.green : C.red) : C.muted },
          { label: 'CASH REMAINING', value: `$${Math.max(0, cashRemaining).toLocaleString('en-US', { maximumFractionDigits: 0 })}`, color: cashRemaining < 0 ? C.red : C.green },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.muted, marginBottom: 6, letterSpacing: 1 }}>{label}</div>
            <div style={{ fontFamily: F.mono, fontSize: 18, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Allocation bar */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontFamily: F.mono, fontSize: 10, color: C.muted }}>PORTFOLIO ALLOCATION</span>
          <span style={{ fontFamily: F.mono, fontSize: 10, color: C.muted }}>{((cashUsed / 10000) * 100).toFixed(1)}% deployed</span>
        </div>
        <div style={{ height: 8, background: C.border, borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
          {open.map((p, i) => {
            const pct = (p.dollarInvested / 10000) * 100
            const color = p.direction?.toUpperCase() === 'LONG' ? C.green : C.red
            return (
              <div key={p.id} title={`${p.ticker}: ${pct.toFixed(1)}%`} style={{
                width: `${Math.min(pct, 100)}%`, background: color,
                opacity: 0.7 + (i % 3) * 0.1,
                borderRight: `1px solid ${C.bg}`,
              }} />
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          {open.map(p => (
            <span key={p.id} style={{ fontFamily: F.mono, fontSize: 10, color: C.sub }}>
              <span style={{ color: p.direction?.toUpperCase() === 'LONG' ? C.green : C.red }}>■</span>
              {' '}{p.ticker} {((p.dollarInvested / 10000) * 100).toFixed(1)}%
            </span>
          ))}
        </div>
      </div>

      {/* Open positions */}
      {open.length === 0 && closed.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: C.muted, fontFamily: F.mono, fontSize: 12 }}>
          No positions yet. Click <strong style={{ color: C.green }}>+ ADD</strong> on any play card in the Terminal to track it here.
        </div>
      )}

      {open.length > 0 && (
        <>
          {/* Open positions header with Morning Brief */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontFamily: F.mono, fontSize: 11, color: C.muted, letterSpacing: 1 }}>
              OPEN POSITIONS ({open.length})
            </span>
            {onAskApex && (
              <button
                onClick={() => {
                  const lines = open.map(pos => {
                    const liveStk = livePrices[pos.ticker]
                    const liveOpt = liveOptionPrices[pos.id]?.quote
                    const isEq = /equity|stock|share/i.test(pos.vehicle || '')
                    const cur = isEq ? liveStk?.price : liveOpt?.price
                    const ent = parseFloat(pos.entry)
                    const pnlStr = cur && ent ? ` | P&L: ${(((isEq ? cur - ent : cur - ent) / ent) * 100).toFixed(1)}%` : ''
                    return `- ${pos.ticker} ${pos.direction} ${pos.vehicle} | Entry: $${pos.entry} | Current: ${cur ? `$${cur.toFixed(2)}` : 'n/a'}${pnlStr} | Target: $${pos.target} | Stop: $${pos.stop}`
                  }).join('\n')
                  onAskApex(`PORTFOLIO MORNING BRIEF — scan all my open positions and give me a prioritized action list for today. Any breaking news, technicals, or macro shifts that affect these? Rank by urgency.\n\n${lines}`)
                }}
                style={{
                  marginLeft: 'auto', background: C.purple + '20',
                  border: `1px solid ${C.purple}`, borderRadius: 6,
                  color: C.purple, fontFamily: F.mono, fontSize: 11, fontWeight: 700,
                  padding: '5px 14px', cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.background = C.purple + '35'}
                onMouseLeave={e => e.currentTarget.style.background = C.purple + '20'}
              >
                ✦ MORNING BRIEF
              </button>
            )}
          </div>

          {open.map(pos => (
            <PortfolioPositionCard
              key={pos.id} pos={pos}
              liveQuote={livePrices[pos.ticker]}
              liveOptionData={liveOptionPrices[pos.id]}
              onUpdate={onUpdate} onClose={onClose} onDelete={onDelete}
              onAskApex={onAskApex}
            />
          ))}
        </>
      )}

      {closed.length > 0 && (
        <>
          <div style={{ fontFamily: F.mono, fontSize: 11, color: C.muted, letterSpacing: 1, margin: '20px 0 10px' }}>
            CLOSED POSITIONS ({closed.length})
          </div>
          {closed.map(pos => (
            <PortfolioPositionCard key={pos.id} pos={pos} onUpdate={onUpdate} onClose={onClose} onDelete={onDelete} closed />
          ))}
        </>
      )}
    </div>
  )
}

function PortfolioPositionCard({ pos, liveQuote, liveOptionData, onUpdate, onClose, onDelete, onAskApex, closed }) {
  const [editingPrice, setEditingPrice] = useState(false)
  const [priceInput, setPriceInput] = useState(pos.currentPrice || '')
  const [showCloseForm, setShowCloseForm] = useState(false)
  const [exitPrice, setExitPrice] = useState('')
  const [showNotes, setShowNotes] = useState(!!pos.notes)
  const [notesText, setNotesText] = useState(pos.notes || '')

  const isLong = pos.direction?.toUpperCase() === 'LONG'
  const dirColor = isLong ? C.green : C.red
  const isEq = /equity|stock|share/i.test(pos.vehicle || '')

  const hasLiveStock  = liveQuote?.price != null
  const hasLiveOption = !isEq && liveOptionData?.quote?.price != null
  const liveOptQuote  = liveOptionData?.quote
  const occSymbol     = liveOptionData?.occ

  const entryNum  = parseFloat(pos.entry)
  const targetNum = parseFloat(pos.target)
  const stopNum   = parseFloat(pos.stop)

  const effectiveCurrentNum = hasLiveOption
    ? liveOptQuote.price
    : (isEq && hasLiveStock)
      ? liveQuote.price
      : parseFloat(pos.currentPrice)

  let pnlPct = null
  let pnlDollar = null
  if (!isNaN(effectiveCurrentNum) && !isNaN(entryNum) && entryNum > 0) {
    pnlPct = isLong
      ? (effectiveCurrentNum - entryNum) / entryNum * 100
      : (entryNum - effectiveCurrentNum) / entryNum * 100
    pnlDollar = (pnlPct / 100) * pos.dollarInvested
  }
  const pnlColor = pnlDollar == null ? C.muted : pnlDollar >= 0 ? C.green : C.red

  // ── Alerts ─────────────────────────────────────────────────────────────────
  const targetHit = !closed && !isNaN(effectiveCurrentNum) && !isNaN(targetNum) && effectiveCurrentNum >= targetNum
  const stopHit   = !closed && !isNaN(effectiveCurrentNum) && !isNaN(stopNum)   && effectiveCurrentNum <= stopNum

  function commitPrice() {
    setEditingPrice(false)
    onUpdate(pos.id, { currentPrice: priceInput })
  }

  function handleClose() {
    const exit = parseFloat(exitPrice)
    const entry = parseFloat(pos.entry)
    if (!isNaN(exit) && !isNaN(entry) && entry > 0) {
      const pct = isLong ? (exit - entry) / entry : (entry - exit) / entry
      const realizedPnl = pct * pos.dollarInvested
      onClose(pos.id, { exitPrice: String(exit), realizedPnl, closedDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) })
    }
    setShowCloseForm(false)
  }

  return (
    <div style={{
      background: closed ? C.surface : C.card,
      border: `1px solid ${targetHit ? C.green : stopHit ? C.red : closed ? C.border : (pnlDollar != null ? (pnlDollar >= 0 ? C.green + '40' : C.red + '40') : C.border)}`,
      borderRadius: 10, marginBottom: 10, overflow: 'hidden',
      opacity: closed ? 0.7 : 1,
    }}>
      {/* Alert banner */}
      {(targetHit || stopHit) && (
        <div style={{
          background: targetHit ? C.green + '20' : C.red + '20',
          borderBottom: `1px solid ${targetHit ? C.green : C.red}`,
          padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 14 }}>{targetHit ? '🎯' : '🛑'}</span>
          <span style={{ fontFamily: F.mono, fontSize: 11, fontWeight: 700, color: targetHit ? C.green : C.red }}>
            {targetHit ? `TARGET HIT — ${pos.ticker} has reached your $${pos.target} target` : `STOP ALERT — ${pos.ticker} is at or below your $${pos.stop} stop`}
          </span>
          {onAskApex && (
            <button
              onClick={() => onAskApex(`URGENT: My ${pos.ticker} ${pos.direction} ${pos.vehicle} position has ${targetHit ? `hit my target of $${pos.target}` : `triggered my stop at $${pos.stop}`}. Current price: $${effectiveCurrentNum?.toFixed(2)}. Entry: $${pos.entry}. P&L: ${pnlPct?.toFixed(1)}% ($${pnlDollar?.toFixed(0)}). Should I exit now, scale out, or hold? What's the current setup?`)}
              style={{
                marginLeft: 'auto', background: targetHit ? C.green : C.red,
                border: 'none', borderRadius: 5, color: '#000',
                fontFamily: F.mono, fontSize: 10, fontWeight: 700,
                padding: '4px 10px', cursor: 'pointer',
              }}
            >
              ASK APEX
            </button>
          )}
        </div>
      )}
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: F.mono, fontSize: 17, fontWeight: 700, color: C.text }}>{pos.ticker}</span>
        <span style={{ fontFamily: F.mono, fontSize: 11, fontWeight: 700, color: dirColor, background: dirColor + '20', borderRadius: 4, padding: '2px 8px' }}>
          {pos.direction?.toUpperCase()}
        </span>
        <span style={{ fontFamily: F.mono, fontSize: 11, color: C.muted, background: C.bg, borderRadius: 4, padding: '2px 8px' }}>
          {pos.vehicle}
        </span>
        <span style={{ fontFamily: F.mono, fontSize: 11, color: C.muted }}>
          {pos.addedDate}
        </span>
        {closed && pos.closedDate && (
          <span style={{ fontFamily: F.mono, fontSize: 11, color: C.muted }}>→ {pos.closedDate}</span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: F.mono, fontSize: 13, color: C.text, fontWeight: 600 }}>
              ${pos.dollarInvested.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.muted }}>invested</div>
          </div>
          {pnlDollar != null && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: F.mono, fontSize: 14, color: pnlColor, fontWeight: 700 }}>
                {pnlDollar >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
              </div>
              <div style={{ fontFamily: F.mono, fontSize: 11, color: pnlColor }}>
                {pnlDollar >= 0 ? '+' : ''}${pnlDollar.toFixed(0)}
              </div>
            </div>
          )}
          {closed && pos.realizedPnl != null && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: F.mono, fontSize: 13, color: pos.realizedPnl >= 0 ? C.green : C.red, fontWeight: 700 }}>
                {pos.realizedPnl >= 0 ? '+' : ''}${pos.realizedPnl.toFixed(0)}
              </div>
              <div style={{ fontFamily: F.mono, fontSize: 10, color: C.muted }}>realized</div>
            </div>
          )}
        </div>
      </div>

      {/* Contract */}
      {pos.contract && (
        <div style={{ padding: '7px 14px', borderBottom: `1px solid ${C.border}`, background: C.blue + '08' }}>
          <span style={{ fontFamily: F.mono, fontSize: 10, color: C.blue, letterSpacing: 1, marginRight: 8 }}>CONTRACT</span>
          <span style={{ fontFamily: F.mono, fontSize: 11, color: C.text }}>{pos.contract}</span>
        </div>
      )}

      {/* Price row */}
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {/* Entry */}
        <div style={{ flex: 1, padding: '10px 14px', borderRight: `1px solid ${C.border}`, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontFamily: F.mono, fontSize: 10, color: C.muted, marginBottom: 4 }}>ENTRY</div>
          <div style={{ fontFamily: F.mono, fontSize: 14, color: C.sub, fontWeight: 600 }}>{pos.entry ?? '—'}</div>
        </div>

        {/* Current price cell */}
        <div
          style={{
            flex: 1, padding: '10px 14px', borderRight: `1px solid ${C.border}`,
            borderTop: `1px solid ${C.border}`,
            cursor: (!closed && !isEq && !hasLiveOption) ? 'pointer' : 'default',
          }}
          onClick={() => !closed && !isEq && !hasLiveOption && setEditingPrice(true)}
        >
          {/* Label row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
            {(isEq ? hasLiveStock : hasLiveOption) && !closed && (
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: C.green, display: 'inline-block',
                boxShadow: `0 0 5px ${C.green}`, flexShrink: 0,
              }} />
            )}
            <span style={{ fontFamily: F.mono, fontSize: 10, color: C.muted }}>
              {isEq
                ? 'LIVE PRICE'
                : hasLiveOption
                  ? 'LIVE PREMIUM'
                  : !liveOptionData?.occ
                    ? 'OPTION PREMIUM'   // spread / unparseable
                    : 'OPTION PREMIUM'}
            </span>
          </div>

          {/* Equity: live stock price */}
          {isEq && (
            <div>
              <div style={{ fontFamily: F.mono, fontSize: 14, color: C.text, fontWeight: 600 }}>
                {hasLiveStock ? `$${liveQuote.price.toFixed(2)}` : (closed ? pos.exitPrice : '—')}
              </div>
              {hasLiveStock && liveQuote.changePct != null && (
                <div style={{ fontFamily: F.mono, fontSize: 10, color: liveQuote.change >= 0 ? C.green : C.red, marginTop: 2 }}>
                  {liveQuote.change >= 0 ? '+' : ''}{liveQuote.changePct.toFixed(2)}% today
                </div>
              )}
            </div>
          )}

          {/* Options with live OCC price */}
          {!isEq && hasLiveOption && (
            <div>
              <div style={{ fontFamily: F.mono, fontSize: 14, color: C.text, fontWeight: 600 }}>
                ${liveOptQuote.price.toFixed(2)}
              </div>
              {liveOptQuote.changePct != null && (
                <div style={{ fontFamily: F.mono, fontSize: 10, color: liveOptQuote.change >= 0 ? C.green : C.red, marginTop: 2 }}>
                  {liveOptQuote.change >= 0 ? '+' : ''}{liveOptQuote.changePct.toFixed(2)}% today
                </div>
              )}
              {hasLiveStock && (
                <div style={{ fontFamily: F.mono, fontSize: 9, color: C.muted, marginTop: 3 }}>
                  {pos.ticker} ${liveQuote.price.toFixed(2)}
                  <span style={{ marginLeft: 3, color: liveQuote.change >= 0 ? C.green : C.red }}>
                    {liveQuote.change >= 0 ? '+' : ''}{liveQuote.changePct?.toFixed(2)}%
                  </span>
                </div>
              )}
              {occSymbol && (
                <div style={{ fontFamily: F.mono, fontSize: 9, color: C.muted, marginTop: 2, opacity: 0.6 }}>
                  {occSymbol}
                </div>
              )}
            </div>
          )}

          {/* Options without live data — manual fallback */}
          {!isEq && !hasLiveOption && (
            <div>
              {/* Show underlying as context even if option price failed */}
              {hasLiveStock && (
                <div style={{ fontFamily: F.mono, fontSize: 10, color: C.muted, marginBottom: 4 }}>
                  {pos.ticker} ${liveQuote.price.toFixed(2)}
                  <span style={{ marginLeft: 3, color: liveQuote.change >= 0 ? C.green : C.red }}>
                    {liveQuote.change >= 0 ? '+' : ''}{liveQuote.changePct?.toFixed(2)}%
                  </span>
                </div>
              )}
              {liveOptionData && !liveOptionData.occ && (
                <div style={{ fontFamily: F.mono, fontSize: 9, color: C.amber, marginBottom: 4 }}>
                  ⚠ spread — enter manually
                </div>
              )}
              {editingPrice ? (
                <input
                  autoFocus type="number" value={priceInput}
                  onChange={e => setPriceInput(e.target.value)}
                  onBlur={commitPrice}
                  onKeyDown={e => { if (e.key === 'Enter') commitPrice(); if (e.key === 'Escape') setEditingPrice(false) }}
                  placeholder="option premium"
                  style={{
                    width: '100%', background: 'none', border: 'none',
                    borderBottom: `1px solid ${C.blue}`,
                    color: C.text, fontFamily: F.mono, fontSize: 13,
                    outline: 'none', padding: '0 0 2px',
                  }}
                />
              ) : (
                <div
                  style={{ fontFamily: F.mono, fontSize: 13, color: pos.currentPrice ? C.text : C.muted, cursor: 'pointer' }}
                  onClick={() => !closed && setEditingPrice(true)}
                >
                  {pos.currentPrice ? `$${pos.currentPrice}` : (closed ? pos.exitPrice : '✎ tap to enter')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Target */}
        <div style={{ flex: 1, padding: '10px 14px', borderRight: `1px solid ${C.border}`, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontFamily: F.mono, fontSize: 10, color: C.muted, marginBottom: 4 }}>TARGET</div>
          <div style={{ fontFamily: F.mono, fontSize: 14, color: C.green, fontWeight: 600 }}>{pos.target ?? '—'}</div>
        </div>

        {/* Stop */}
        <div style={{ flex: 1, padding: '10px 14px', borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontFamily: F.mono, fontSize: 10, color: C.muted, marginBottom: 4 }}>STOP</div>
          <div style={{ fontFamily: F.mono, fontSize: 14, color: C.red, fontWeight: 600 }}>{pos.stop ?? '—'}</div>
        </div>
      </div>

      {/* Close form */}
      {showCloseForm && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderTop: `1px solid ${C.border}`, background: C.amber + '08' }}>
          <span style={{ fontFamily: F.mono, fontSize: 11, color: C.amber }}>EXIT PRICE</span>
          <span style={{ fontFamily: F.mono, fontSize: 13, color: C.muted }}>$</span>
          <input
            autoFocus
            type="number"
            value={exitPrice}
            onChange={e => setExitPrice(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleClose(); if (e.key === 'Escape') setShowCloseForm(false) }}
            style={{
              width: 100, background: C.card, border: `1px solid ${C.amber}`,
              borderRadius: 6, color: C.text, fontFamily: F.mono, fontSize: 13,
              padding: '5px 10px', outline: 'none',
            }}
          />
          <button onClick={handleClose} style={{ background: C.amber, border: 'none', borderRadius: 6, color: '#000', fontFamily: F.mono, fontSize: 11, fontWeight: 700, padding: '5px 14px', cursor: 'pointer' }}>
            CLOSE POSITION
          </button>
          <button onClick={() => setShowCloseForm(false)} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, fontFamily: F.mono, fontSize: 11, padding: '5px 10px', cursor: 'pointer' }}>
            CANCEL
          </button>
        </div>
      )}

      {/* Notes section */}
      {(showNotes || notesText) && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px 14px', background: C.purple + '08' }}>
          <div style={{ fontFamily: F.mono, fontSize: 10, color: C.purple, marginBottom: 6, letterSpacing: 1 }}>THESIS NOTES</div>
          <textarea
            value={notesText}
            onChange={e => setNotesText(e.target.value)}
            onBlur={() => onUpdate(pos.id, { notes: notesText })}
            placeholder="Why did you enter? What needs to happen? When will you exit?"
            rows={3}
            style={{
              width: '100%', background: 'none', border: `1px solid ${C.border}`,
              borderRadius: 6, color: C.sub, fontFamily: F.sans, fontSize: 13,
              lineHeight: 1.5, padding: '8px 10px', outline: 'none', resize: 'vertical',
            }}
            onFocus={e => e.target.style.borderColor = C.purple}
            onBlur2={e => e.target.style.borderColor = C.border}
          />
        </div>
      )}

      {/* Action buttons */}
      {!closed && (
        <div style={{ display: 'flex', gap: 8, padding: '8px 14px', borderTop: `1px solid ${C.border}`, background: C.bg + '80', flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowCloseForm(s => !s)}
            style={{ background: C.amber + '20', border: `1px solid ${C.amber}`, borderRadius: 6, color: C.amber, fontFamily: F.mono, fontSize: 11, fontWeight: 700, padding: '5px 14px', cursor: 'pointer' }}
          >
            CLOSE POSITION
          </button>
          <button
            onClick={() => { setShowNotes(s => !s) }}
            style={{
              background: showNotes ? C.purple + '25' : 'none',
              border: `1px solid ${showNotes ? C.purple : C.border}`,
              borderRadius: 6, color: showNotes ? C.purple : C.muted,
              fontFamily: F.mono, fontSize: 11, padding: '5px 12px', cursor: 'pointer',
            }}
          >
            {notesText ? '📝 NOTES' : '+ NOTES'}
          </button>
          {onAskApex && (
            <button
              onClick={() => {
                const curStr = effectiveCurrentNum ? `$${effectiveCurrentNum.toFixed(2)}` : 'unknown'
                const pnlStr = pnlPct != null ? ` (P&L: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%, ${pnlDollar >= 0 ? '+' : ''}$${pnlDollar.toFixed(0)})` : ''
                onAskApex(`Position update on my ${pos.ticker} ${pos.direction} ${pos.vehicle}:\n- Contract: ${pos.contract}\n- Entry: $${pos.entry} | Current: ${curStr}${pnlStr}\n- Target: $${pos.target} | Stop: $${pos.stop}\n\nSearch for the latest news, technicals, and options flow on ${pos.ticker}. Should I hold, add, trim, or exit? What's changed since I entered?`)
              }}
              style={{
                background: C.blue + '20', border: `1px solid ${C.blue}`,
                borderRadius: 6, color: C.blue, fontFamily: F.mono, fontSize: 11, fontWeight: 700,
                padding: '5px 14px', cursor: 'pointer',
              }}
              onMouseEnter={e => e.currentTarget.style.background = C.blue + '35'}
              onMouseLeave={e => e.currentTarget.style.background = C.blue + '20'}
            >
              ASK APEX ›
            </button>
          )}
          <button
            onClick={() => onDelete(pos.id)}
            style={{ marginLeft: 'auto', background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, fontFamily: F.mono, fontSize: 11, padding: '5px 12px', cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted }}
          >
            DELETE
          </button>
        </div>
      )}
      {closed && (
        <div style={{ display: 'flex', padding: '8px 14px', borderTop: `1px solid ${C.border}` }}>
          <button
            onClick={() => onDelete(pos.id)}
            style={{ marginLeft: 'auto', background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, fontFamily: F.mono, fontSize: 11, padding: '5px 12px', cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted }}
          >
            DELETE
          </button>
        </div>
      )}
    </div>
  )
}

// ─── ExportDropdown ───────────────────────────────────────────────────────────
function ExportDropdown({ messages, singleMessage, onToast }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const msgs = singleMessage ? [singleMessage] : messages.filter(m => m.role === 'assistant')

  function buildMarkdown() {
    return msgs.map(m => {
      const plays = parsePlaySummary(m.content)
      const body = getBodyWithoutPlaySummary(m.content)
      let md = body + '\n'
      if (plays.length) {
        md += '\n| Ticker | Direction | Vehicle | Contract | Size | Entry | Target | Stop | Conviction |\n'
        md += '|--------|-----------|---------|----------|------|-------|--------|------|------------|\n'
        plays.forEach(p => {
          md += `| ${p.ticker} | ${p.direction} | ${p.vehicle} | ${p.contract} | ${p.size}% | ${p.entry} | ${p.target} | ${p.stop} | ${p.conviction}/5 |\n`
        })
      }
      return md
    }).join('\n\n---\n\n')
  }

  function buildText() {
    return msgs.map(m => {
      const plays = parsePlaySummary(m.content)
      const body = getBodyWithoutPlaySummary(m.content).replace(/\*\*/g, '').replace(/```CHART[\s\S]*?```/g, '[CHART]')
      let txt = body + '\n'
      if (plays.length) {
        txt += '\nPLAYS:\n'
        plays.forEach(p => {
          txt += `  ${p.ticker} ${p.direction} | ${p.vehicle} | ${p.size}% ($${((p.size / 100) * 10000).toFixed(0)})\n`
          txt += `    ${p.contract}\n`
          txt += `    Entry: ${p.entry} | Target: ${p.target} | Stop: ${p.stop} | Conviction: ${p.conviction}/5\n`
        })
      }
      return txt
    }).join('\n\n---\n\n')
  }

  function buildJSON() {
    return JSON.stringify(msgs.map(m => ({
      timestamp: m.timestamp,
      content: getBodyWithoutPlaySummary(m.content),
      plays: parsePlaySummary(m.content),
    })), null, 2)
  }

  async function handleExport(format) {
    setOpen(false)
    let text, filename, mime
    if (format === 'copy') {
      await navigator.clipboard.writeText(buildMarkdown())
      onToast('Copied to clipboard')
      return
    } else if (format === 'md') {
      text = buildMarkdown(); filename = 'apex-analysis.md'; mime = 'text/markdown'
    } else if (format === 'txt') {
      text = buildText(); filename = 'apex-analysis.txt'; mime = 'text/plain'
    } else {
      text = buildJSON(); filename = 'apex-analysis.json'; mime = 'application/json'
    }
    const blob = new Blob([text], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
    onToast(`Exported as ${filename}`)
  }

  const options = [
    { key: 'copy', label: '⌘ Copy to Clipboard' },
    { key: 'md',   label: '⬇ Markdown (.md)' },
    { key: 'txt',  label: '⬇ Plain Text (.txt)' },
    { key: 'json', label: '⬇ JSON (.json)' },
  ]

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'none', border: `1px solid ${C.border}`, borderRadius: 6,
          color: C.sub, fontFamily: F.mono, fontSize: 11, padding: '4px 10px',
          cursor: 'pointer', transition: 'all 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = C.green; e.currentTarget.style.color = C.green }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.sub }}
      >
        ↓ EXPORT
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '110%', right: 0,
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 8, overflow: 'hidden', zIndex: 100, minWidth: 180,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          {options.map(opt => (
            <button key={opt.key} onClick={() => handleExport(opt.key)} style={{
              display: 'block', width: '100%', textAlign: 'left',
              background: 'none', border: 'none', padding: '10px 16px',
              color: C.sub, fontFamily: F.mono, fontSize: 12, cursor: 'pointer',
              transition: 'background 0.1s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = C.border}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── TypingIndicator ──────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '14px 16px' }}>
      <span style={{ fontFamily: F.mono, fontSize: 11, color: C.green, letterSpacing: 1 }}>APEX</span>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 5, height: 5, borderRadius: '50%', background: C.green,
            animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
      <style>{`@keyframes pulse { 0%,80%,100%{opacity:.2;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }`}</style>
    </div>
  )
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, visible }) {
  return (
    <div style={{
      position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)',
      background: C.green, color: '#000', fontFamily: F.mono, fontSize: 12,
      padding: '8px 20px', borderRadius: 6, zIndex: 999,
      opacity: visible ? 1 : 0, transition: 'opacity 0.3s ease',
      pointerEvents: 'none',
    }}>
      {message}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ApexCapital() {
  const [tab, setTab] = useState('terminal')
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [watchlist, setWatchlist] = useState(() => {
    try { return JSON.parse(localStorage.getItem('apex_watchlist') || '[]') } catch { return [] }
  })
  const [watchInput, setWatchInput] = useState('')
  const [thesisLog, setThesisLog] = useState(() => {
    try { return JSON.parse(localStorage.getItem('apex_thesis_log') || '[]') } catch { return [] }
  })
  const [portfolioPositions, setPortfolioPositions] = useState(() => {
    try { return JSON.parse(localStorage.getItem('apex_portfolio') || '[]') } catch { return [] }
  })
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('apex_api_key') || '')
  const [showKeyInput, setShowKeyInput] = useState(false)
  const [toast, setToast] = useState({ message: '', visible: false })

  // On mount: if any key store is empty but a backup exists, auto-restore
  useEffect(() => {
    const raw = localStorage.getItem('apex_backup')
    if (!raw) return
    try {
      const backup = JSON.parse(raw)
      if (!backup?.ts) return
      const ageMin = (Date.now() - backup.ts) / 60000
      if (ageMin > 60) return // only auto-restore if backup is <1hr old
      if (!localStorage.getItem('apex_portfolio') && backup.portfolioPositions?.length) {
        localStorage.setItem('apex_portfolio', JSON.stringify(backup.portfolioPositions))
        setPortfolioPositions(backup.portfolioPositions)
      }
      if (!localStorage.getItem('apex_thesis_log') && backup.thesisLog?.length) {
        localStorage.setItem('apex_thesis_log', JSON.stringify(backup.thesisLog))
        setThesisLog(backup.thesisLog)
      }
      if (!localStorage.getItem('apex_watchlist') && backup.watchlist?.length) {
        localStorage.setItem('apex_watchlist', JSON.stringify(backup.watchlist))
        setWatchlist(backup.watchlist)
      }
    } catch {}
  }, []) // eslint-disable-line
  const bottomRef = useRef(null)
  const toastTimer = useRef(null)
  // Mount guard — skip the very first effect run so we never overwrite
  // localStorage with the initial state value (prevents wipe on crash/hot-reload)
  const didMount = useRef(false)
  useEffect(() => { didMount.current = true }, [])

  useEffect(() => {
    if (!didMount.current) return
    localStorage.setItem('apex_watchlist', JSON.stringify(watchlist))
  }, [watchlist])

  useEffect(() => {
    if (!didMount.current) return
    localStorage.setItem('apex_thesis_log', JSON.stringify(thesisLog))
  }, [thesisLog])

  useEffect(() => {
    if (!didMount.current) return
    localStorage.setItem('apex_portfolio', JSON.stringify(portfolioPositions))
  }, [portfolioPositions])

  // Periodic backup — writes a timestamped copy every 5 min so data survives a bad reload
  useEffect(() => {
    const save = () => {
      const backup = {
        ts: Date.now(),
        watchlist,
        thesisLog,
        portfolioPositions,
      }
      try { localStorage.setItem('apex_backup', JSON.stringify(backup)) } catch {}
    }
    const id = setInterval(save, 5 * 60 * 1000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlist, thesisLog, portfolioPositions])

  const handleAddToPortfolio = useCallback((play, thesisNote = '') => {
    const isEq = /equity|stock|share/i.test(play.vehicle || '')
    let entryPrice = play.entry
    if (!isEq) {
      const entryNum = parseFloat(play.entry)
      const contractPremium = parseEntryPremiumFromContract(play.contract)
      if (contractPremium && (!entryNum || entryNum > contractPremium * 3)) {
        entryPrice = String(contractPremium)
      }
    }
    const position = {
      id: Date.now(),
      ticker: play.ticker,
      direction: play.direction,
      vehicle: play.vehicle,
      contract: play.contract,
      entry: entryPrice,
      target: play.target,
      stop: play.stop,
      conviction: play.conviction,
      dollarInvested: play.dollarInvested,
      currentPrice: '',
      notes: thesisNote,
      addedDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      status: 'open',
    }
    setPortfolioPositions(prev => [position, ...prev])
    showToast(`${play.ticker} added to portfolio`)
  }, [])

  // defined after callApex — see below; using ref to avoid forward-reference crash
  const callApexRef = useRef(null)
  const handleAskApexAboutPosition = useCallback((prompt) => {
    setTab('terminal')
    callApexRef.current?.(prompt)
  }, [])

  const handleUpdatePosition = useCallback((id, updates) => {
    setPortfolioPositions(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p))
  }, [])

  const handleClosePosition = useCallback((id, updates) => {
    setPortfolioPositions(prev => prev.map(p => p.id === id ? { ...p, ...updates, status: 'closed' } : p))
    showToast('Position closed')
  }, [])

  const handleDeletePosition = useCallback((id) => {
    setPortfolioPositions(prev => prev.filter(p => p.id !== id))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const showToast = useCallback((msg) => {
    clearTimeout(toastTimer.current)
    setToast({ message: msg, visible: true })
    toastTimer.current = setTimeout(() => setToast(t => ({ ...t, visible: false })), 2500)
  }, [])

  const callApex = useCallback(async (userMessage) => {
    if (!userMessage.trim()) return

    const userMsg = { role: 'user', content: userMessage, timestamp: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }))

    try {
      const key = apiKey || import.meta.env.VITE_ANTHROPIC_API_KEY || ''
      const endpoint = key ? 'https://api.anthropic.com/v1/messages' : '/api/chat'

      const headers = {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'interleaved-thinking-2025-05-14',
      }
      if (key) {
        headers['x-api-key'] = key
        headers['anthropic-dangerous-direct-browser-access'] = 'true'
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 6000,
          system: buildSystemPrompt(),
          tools: [{
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: 5,
          }],
          messages: history,
        }),
      })

      if (!res.ok) {
        const err = await res.text()
        throw new Error(`API error ${res.status}: ${err}`)
      }

      const data = await res.json()

      // Extract text content (may be mixed with tool use blocks)
      let text = ''
      if (Array.isArray(data.content)) {
        data.content.forEach(block => {
          if (block.type === 'text') text += block.text
        })
      } else {
        text = data.content || ''
      }

      const assistantMsg = { role: 'assistant', content: text, timestamp: Date.now() }
      setMessages(prev => [...prev, assistantMsg])

      // Auto-save to thesis log if response is substantial
      if (text.length > 500) {
        const tickerMatch = text.match(/\b([A-Z]{2,5})\b/)
        const plays = parsePlaySummary(text)
        if (tickerMatch || plays.length) {
          const entry = {
            id: Date.now(),
            ticker: plays[0]?.ticker || tickerMatch?.[1] || 'MARKET',
            date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            preview: text.slice(0, 200).replace(/\*\*/g, '').replace(/```[\s\S]*?```/g, ''),
            content: text,
            plays: plays.map(p => ({ ticker: p.ticker, direction: p.direction })),
          }
          setThesisLog(prev => [entry, ...prev.slice(0, 49)])
        }
      }
    } catch (err) {
      const errMsg = err.message.includes('401')
        ? 'Invalid API key. Click the key icon in the header to update it.'
        : err.message.includes('Failed to fetch')
        ? 'Connection failed. Make sure your API key is set or the proxy server is running.'
        : `Error: ${err.message}`
      setMessages(prev => [...prev, { role: 'assistant', content: errMsg, timestamp: Date.now(), isError: true }])
    } finally {
      setLoading(false)
    }
  }, [messages, apiKey])

  // Keep the ref in sync so handleAskApexAboutPosition can call it without a forward-reference
  callApexRef.current = callApex

  const openPortfolioPositions = portfolioPositions.filter(p => p.status === 'open')
  const quickActions = [
    { label: 'Top 3 Ideas', prompt: 'Give me your top 3 highest-conviction trade ideas right now. Search for current prices and recent catalysts. Size each position for a $10,000 account.' },
    { label: 'Week Ahead', prompt: 'What are the key macro events, earnings, and technical setups to watch this week? Give me 2-3 actionable plays.' },
    { label: 'Month Ahead', prompt: 'Lay out the macro thesis for the next 30 days. Key risks, key opportunities. Give me a 3-position portfolio for the month.' },
    { label: 'Macro Scan', prompt: 'Do a full macro scan: Fed, rates, dollar, commodities, global flows. What sectors are positioned to outperform and underperform?' },
    { label: 'Short Book', prompt: 'Find me the 2-3 best short/put ideas right now. Overvalued, bad technicals, or fundamental deterioration. Use put spreads sized for $10K account.' },
    { label: 'Risk Check', prompt: 'Given current market conditions, what are the top 5 tail risks I should be hedging against? How would I structure cheap hedges on a $10K account?' },
    ...(openPortfolioPositions.length > 0 ? [{
      label: '✦ Morning Brief',
      purple: true,
      prompt: `PORTFOLIO MORNING BRIEF — scan all my open positions and give me a prioritized action list for today. Any breaking news, technicals, or macro developments that change the thesis?\n\n${openPortfolioPositions.map(p => `- ${p.ticker} ${p.direction} ${p.vehicle} | Entry: $${p.entry} | Target: $${p.target} | Stop: $${p.stop}`).join('\n')}`,
    }] : []),
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: C.bg, fontFamily: F.sans }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '0 20px',
        height: 52, borderBottom: `1px solid ${C.border}`,
        background: C.surface, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: F.serif, fontSize: 20, color: C.green, letterSpacing: 1 }}>APEX</span>
          <span style={{ fontFamily: F.mono, fontSize: 10, color: C.muted, letterSpacing: 2 }}>CAPITAL</span>
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 10, color: C.muted, marginLeft: 16, borderLeft: `1px solid ${C.border}`, paddingLeft: 16 }}>
          $10K PERSONAL PORTFOLIO
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {messages.filter(m => m.role === 'assistant').length > 0 && (
            <ExportDropdown messages={messages} onToast={showToast} />
          )}
          <button
            onClick={() => setShowKeyInput(s => !s)}
            title="Set API Key"
            style={{
              background: apiKey ? C.green + '20' : C.border,
              border: `1px solid ${apiKey ? C.green : C.border}`,
              borderRadius: 6, color: apiKey ? C.green : C.muted,
              fontFamily: F.mono, fontSize: 11, padding: '4px 10px', cursor: 'pointer',
            }}
          >
            {apiKey ? '🔑 KEY SET' : '🔑 SET KEY'}
          </button>
        </div>
      </div>

      {/* API Key input */}
      {showKeyInput && (
        <div style={{
          background: C.card, borderBottom: `1px solid ${C.border}`,
          padding: '12px 20px', display: 'flex', gap: 10, alignItems: 'center',
        }}>
          <span style={{ fontFamily: F.mono, fontSize: 11, color: C.sub }}>ANTHROPIC API KEY:</span>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            onBlur={() => localStorage.setItem('apex_api_key', apiKey)}
            placeholder="sk-ant-..."
            style={{
              flex: 1, background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 6, color: C.text, fontFamily: F.mono, fontSize: 12,
              padding: '6px 12px', outline: 'none',
            }}
          />
          <button
            onClick={() => { localStorage.setItem('apex_api_key', apiKey); setShowKeyInput(false); showToast('API key saved') }}
            style={{
              background: C.green, color: '#000', border: 'none',
              borderRadius: 6, fontFamily: F.mono, fontSize: 11, fontWeight: 700,
              padding: '6px 14px', cursor: 'pointer',
            }}
          >SAVE</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 0, borderBottom: `1px solid ${C.border}`,
        background: C.surface, flexShrink: 0,
      }}>
        {[
          { key: 'terminal', label: 'TERMINAL' },
          { key: 'watchlist', label: `WATCHLIST (${watchlist.length})` },
          { key: 'log', label: `THESIS LOG (${thesisLog.length})` },
          { key: 'portfolio', label: `PORTFOLIO (${portfolioPositions.filter(p => p.status === 'open').length})` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            background: 'none',
            border: 'none',
            borderBottom: `2px solid ${tab === t.key ? C.green : 'transparent'}`,
            color: tab === t.key ? C.green : C.muted,
            fontFamily: F.mono, fontSize: 11, letterSpacing: 1,
            padding: '12px 20px', cursor: 'pointer', transition: 'all 0.15s',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Terminal tab */}
      {tab === 'terminal' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          {/* Quick actions */}
          <div style={{
            display: 'flex', gap: 8, padding: '10px 16px',
            borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap', flexShrink: 0,
          }}>
            {quickActions.map(qa => (
              <button key={qa.label} onClick={() => callApex(qa.prompt)} disabled={loading} style={{
                background: qa.purple ? C.purple + '20' : C.card,
                border: `1px solid ${qa.purple ? C.purple : C.border}`,
                borderRadius: 6, color: qa.purple ? C.purple : C.sub,
                fontFamily: F.mono, fontSize: 11,
                padding: '5px 12px', cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s', opacity: loading ? 0.5 : 1,
              }}
                onMouseEnter={e => { if (!loading) { e.currentTarget.style.borderColor = qa.purple ? C.purple : C.green; e.currentTarget.style.color = qa.purple ? C.purple : C.green } }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = qa.purple ? C.purple : C.border; e.currentTarget.style.color = qa.purple ? C.purple : C.sub }}
              >
                {qa.label}
              </button>
            ))}
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{ fontFamily: F.serif, fontSize: 36, color: C.green, marginBottom: 8 }}>APEX</div>
                <div style={{ fontFamily: F.mono, fontSize: 12, color: C.muted, marginBottom: 24 }}>
                  AI-POWERED HEDGE FUND TERMINAL · $10,000 PERSONAL PORTFOLIO
                </div>
                <div style={{ fontFamily: F.sans, fontSize: 14, color: C.sub, maxWidth: 460, margin: '0 auto' }}>
                  Ask for trade ideas, macro analysis, sector scans, or use the quick action buttons above.
                  APEX uses live web search to analyze current market conditions.
                </div>
              </div>
            )}

            {messages.map((msg, i) => {
              const isUser = msg.role === 'user'
              if (isUser) {
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                    <div style={{
                      background: C.card, border: `1px solid ${C.border}`,
                      borderRadius: 10, padding: '10px 14px',
                      maxWidth: '70%', fontFamily: F.sans, fontSize: 14, color: C.text, lineHeight: 1.6,
                    }}>
                      {msg.content}
                    </div>
                  </div>
                )
              }

              const plays = parsePlaySummary(msg.content)
              const body = getBodyWithoutPlaySummary(msg.content)

              return (
                <div key={i} style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{ fontFamily: F.mono, fontSize: 11, color: C.green, letterSpacing: 1 }}>APEX</span>
                    <span style={{ fontFamily: F.mono, fontSize: 10, color: C.muted }}>
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                    <div style={{ marginLeft: 'auto' }}>
                      <ExportDropdown singleMessage={msg} messages={[]} onToast={showToast} />
                    </div>
                  </div>
                  <div style={{
                    background: msg.isError ? C.red + '15' : C.card,
                    border: `1px solid ${msg.isError ? C.red : C.border}`,
                    borderRadius: 10, padding: '14px 16px',
                  }}>
                    <MarkdownRenderer content={body} />
                    {plays.length > 0 && <PlaySummaryCard plays={plays} onAddToPortfolio={(play) => handleAddToPortfolio(play, body.slice(0, 600))} portfolioPositions={portfolioPositions} />}
                  </div>
                </div>
              )
            })}

            {loading && (
              <div style={{
                background: C.card, border: `1px solid ${C.border}`,
                borderRadius: 10, marginBottom: 16,
              }}>
                <TypingIndicator />
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{
            display: 'flex', gap: 10, padding: '12px 16px',
            borderTop: `1px solid ${C.border}`, background: C.surface, flexShrink: 0,
          }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !loading) { e.preventDefault(); callApex(input) } }}
              placeholder="Ask APEX anything... (Enter to send)"
              disabled={loading}
              style={{
                flex: 1, background: C.card, border: `1px solid ${C.border}`,
                borderRadius: 8, color: C.text, fontFamily: F.sans, fontSize: 14,
                padding: '10px 14px', outline: 'none', transition: 'border-color 0.15s',
              }}
              onFocus={e => e.target.style.borderColor = C.green}
              onBlur={e => e.target.style.borderColor = C.border}
            />
            <button
              onClick={() => callApex(input)}
              disabled={loading || !input.trim()}
              style={{
                background: loading || !input.trim() ? C.border : C.green,
                border: 'none', borderRadius: 8, color: '#000',
                fontFamily: F.mono, fontSize: 12, fontWeight: 700,
                padding: '10px 20px', cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}
            >
              {loading ? '...' : 'SEND'}
            </button>
          </div>
        </div>
      )}

      {/* Watchlist tab */}
      {tab === 'watchlist' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            <input
              value={watchInput}
              onChange={e => setWatchInput(e.target.value.toUpperCase())}
              onKeyDown={e => {
                if (e.key === 'Enter' && watchInput.trim()) {
                  const ticker = watchInput.trim()
                  if (!watchlist.includes(ticker)) setWatchlist(prev => [...prev, ticker])
                  setWatchInput('')
                }
              }}
              placeholder="Add ticker (e.g. NVDA)"
              style={{
                flex: 1, background: C.card, border: `1px solid ${C.border}`,
                borderRadius: 8, color: C.text, fontFamily: F.mono, fontSize: 13,
                padding: '10px 14px', outline: 'none',
              }}
              onFocus={e => e.target.style.borderColor = C.green}
              onBlur={e => e.target.style.borderColor = C.border}
            />
            <button
              onClick={() => {
                const ticker = watchInput.trim()
                if (ticker && !watchlist.includes(ticker)) setWatchlist(prev => [...prev, ticker])
                setWatchInput('')
              }}
              style={{
                background: C.green, border: 'none', borderRadius: 8,
                color: '#000', fontFamily: F.mono, fontSize: 12, fontWeight: 700,
                padding: '10px 20px', cursor: 'pointer',
              }}
            >
              ADD
            </button>
          </div>

          {watchlist.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: C.muted, fontFamily: F.mono, fontSize: 12 }}>
              No tickers in watchlist. Add one above.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {watchlist.map(ticker => (
              <div key={ticker} style={{
                background: C.card, border: `1px solid ${C.border}`,
                borderRadius: 10, padding: '14px 16px',
                display: 'flex', flexDirection: 'column', gap: 12,
              }}>
                <div style={{ fontFamily: F.mono, fontSize: 20, fontWeight: 700, color: C.text, letterSpacing: 1 }}>
                  {ticker}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => {
                      setTab('terminal')
                      callApex(`Analyze ${ticker} — full investment thesis, current price, recent catalysts, technical setup, and your best trade for a $10,000 portfolio. Use web search for current data.`)
                    }}
                    disabled={loading}
                    style={{
                      flex: 1, background: C.green + '20', border: `1px solid ${C.green}`,
                      borderRadius: 6, color: C.green, fontFamily: F.mono, fontSize: 11,
                      fontWeight: 700, padding: '7px 0', cursor: loading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    ANALYZE
                  </button>
                  <button
                    onClick={() => setWatchlist(prev => prev.filter(t => t !== ticker))}
                    style={{
                      background: 'none', border: `1px solid ${C.border}`,
                      borderRadius: 6, color: C.muted, fontFamily: F.mono, fontSize: 11,
                      padding: '7px 12px', cursor: 'pointer',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Thesis Log tab */}
      {tab === 'log' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {thesisLog.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: C.muted, fontFamily: F.mono, fontSize: 12 }}>
              No saved analyses yet. Responses over 500 characters are auto-saved here.
            </div>
          )}
          {thesisLog.map(entry => (
            <div key={entry.id} style={{
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 10, padding: '14px 16px', marginBottom: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontFamily: F.mono, fontSize: 15, fontWeight: 700, color: C.text }}>{entry.ticker}</span>
                <span style={{ fontFamily: F.mono, fontSize: 11, color: C.muted }}>{entry.date}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                  {entry.plays?.map((p, pi) => (
                    <span key={pi} style={{
                      fontFamily: F.mono, fontSize: 10, fontWeight: 700,
                      color: p.direction?.toUpperCase() === 'LONG' ? C.green : C.red,
                      background: (p.direction?.toUpperCase() === 'LONG' ? C.green : C.red) + '20',
                      borderRadius: 4, padding: '2px 6px',
                    }}>
                      {p.ticker} {p.direction?.toUpperCase()}
                    </span>
                  ))}
                </div>
              </div>
              <p style={{ fontFamily: F.sans, fontSize: 13, color: C.sub, lineHeight: 1.5, marginBottom: 12 }}>
                {entry.preview}…
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => {
                    setTab('terminal')
                    setMessages(prev => [...prev, {
                      role: 'assistant',
                      content: entry.content,
                      timestamp: entry.id,
                    }])
                  }}
                  style={{
                    background: C.green + '20', border: `1px solid ${C.green}`,
                    borderRadius: 6, color: C.green, fontFamily: F.mono, fontSize: 11,
                    fontWeight: 700, padding: '6px 14px', cursor: 'pointer',
                  }}
                >
                  LOAD
                </button>
                <ExportDropdown
                  singleMessage={{ role: 'assistant', content: entry.content, timestamp: entry.id }}
                  messages={[]}
                  onToast={showToast}
                />
                <button
                  onClick={() => setThesisLog(prev => prev.filter(e => e.id !== entry.id))}
                  style={{
                    background: 'none', border: `1px solid ${C.border}`,
                    borderRadius: 6, color: C.muted, fontFamily: F.mono, fontSize: 11,
                    padding: '6px 14px', cursor: 'pointer', marginLeft: 'auto',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted }}
                >
                  DELETE
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Portfolio tab */}
      {tab === 'portfolio' && (
        <PortfolioView
          positions={portfolioPositions}
          onUpdate={handleUpdatePosition}
          onClose={handleClosePosition}
          onDelete={handleDeletePosition}
          onAskApex={handleAskApexAboutPosition}
        />
      )}

      <Toast message={toast.message} visible={toast.visible} />
    </div>
  )
}
