# 🔍 Pumpscan

**Built by [@yksanjo](https://github.com/yksanjo)**

A system where your wallet, activity log, and market intelligence all merge into a single real-time ecosystem. Every token, holder, and transaction becomes part of a connected layer instead of being scattered across countless separate apps.

**Paste any pump.fun token. Get a verdict in 15 seconds — bundles, concentration, dev wallet, holders.**

## Features

- 🟢🟡🔴 Risk verdict with confidence score
- 📊 Holder concentration analysis (Top 10/25/100, Gini coefficient)
- 🚩 Bundle/sniper detection with wallet clusters
- 🔮 Graduation prediction (will this token make it to Raydium?)
- 📡 Real-time new token scanner with webhook alerts
- 🔔 **SOAG-gated Telegram alerts** — users sign with a wallet, prove 5M+ SOAG, and receive scanner alerts in Telegram
- 📈 **Breakout Radar alerts** — Telegram alerts fire after close-confirmed candle breakouts
- 🧾 **SOAG PnL card** — generate share text or a branded PNG card for wins/losses
- 👤 Dev wallet portfolio analysis
- ⚖️ Side-by-side token comparison
- 🎯 **Real-collector finder** — scan graduates, pool top holders, classify by activity tier (dormant / quiet / lightly active / active), surface only the wallets with 60+ day swap history, 20+ swaps, and recent activity
- 📦 **Airdrop planner** — turn the filtered list into a recipient CSV (dry-run by default; execution wired through `sol-agent-wallet`)

## Quick Start

```bash
npm install
cp .env.example .env.local
# Add your HELIUS_API_KEY
npm run dev
```

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/analyze` | POST | Analyze a token |
| `/api/batch` | POST | Batch scan tokens |
| `/api/compare` | POST | Compare tokens |
| `/api/dev` | POST | Analyze dev wallet |
| `/api/collectors` | POST | Find real collectors across a set of graduates |
| `/api/airdrop` | POST | Build an airdrop plan (dry-run) from a recipient list |
| `/api/alerts/challenge` | POST | Create a short-lived wallet-signing challenge |
| `/api/alerts/subscribe` | POST | Verify wallet ownership, check 5M SOAG, and enable Telegram alerts |

### SOAG-gated Telegram alerts

Set these in `.env.local`:

```bash
HELIUS_API_KEY=...
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com # optional balance-check fallback
TELEGRAM_BOT_TOKEN=...
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=your_bot_username # optional override for the Open bot link
NEXT_PUBLIC_TELEGRAM_BOT_URL=https://t.me/your_bot_username # optional full bot link override
```

Run the bot so users can get their chat ID:

```bash
npx tsx scripts/telegram-bot.ts
```

Users open the bot from the web app, send `/start`, then send `/id`. They paste the returned numeric chat ID into the Breakout Radar Telegram alerts panel, connect a wallet, and sign the alert request. The server verifies the signature, checks the signing wallet for at least `5,000,000 SOAG`, sends a welcome message, and stores the subscriber in `data/alert-subscribers.json` by default.

The web app discovers the bot link from `TELEGRAM_BOT_TOKEN` via `/api/alerts/bot`. Use `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` or `NEXT_PUBLIC_TELEGRAM_BOT_URL` only when you want to override that link.

Run the scanner to deliver alerts:

```bash
npx tsx scripts/scanner-runner.ts
```

The scanner rechecks stored SOAG balances every 24 hours before delivery. Override the local subscriber file path with `ALERT_SUBSCRIBERS_FILE`.

Breakout alerts are close-confirmed by default, including the default `15m` timeframe: the latest closed candle's close must clear the highest close in the configured lookback. Set `BREAKOUT_TIMEFRAME=1d` to alert from closed daily candles at UTC day boundaries.

Use `BREAKOUT_RULES` when you want multiple lookbacks from one scanner process. Each rule is `timeframe:lookback[:min_pct[:close]]`, for example `15m:20:0:close,1d:20:0:close,4h:30:2:close`.

By default the scanner also adds fresh pump.fun graduates from GeckoTerminal's Solana `new_pools` feed. Keep `BREAKOUT_WATCH_MINTS` for static mints such as SOAG, and tune `BREAKOUT_RECENT_GRADUATES_MAX_AGE_MINUTES` / `BREAKOUT_MAX_DYNAMIC_MINTS` to control how many newly graduated tokens enter the radar.

Every breakout alert also includes daily-chart context:

- `PASS` when the closed daily chart is in a clear downtrend
- `NEUTRAL` when the closed daily chart is in a clear uptrend or mixed
- `REVIEW` when the token has been flat for months, so the chart should be opened and checked for a reason to buy

Optional breakout settings:

```bash
BREAKOUT_WATCH_MINTS=ADue87cPcDhsyGq2hrDsukp7j8AFTSnaYHSanDATpump # defaults to SOAG
BREAKOUT_TIMEFRAME=15m # examples: 15m, 1h, 4h, 1d
BREAKOUT_LOOKBACK_CANDLES=20
BREAKOUT_MIN_CLOSE_MOVE_PCT=0
BREAKOUT_TRIGGER_MODE=close
BREAKOUT_RULES= # optional: 15m:20:0:close,1d:20:0:close,4h:30:2:close
BREAKOUT_INCLUDE_RECENT_GRADUATES=true
BREAKOUT_RECENT_GRADUATES_PAGES=1
BREAKOUT_RECENT_GRADUATES_MAX_AGE_MINUTES=180
BREAKOUT_MAX_DYNAMIC_MINTS=25
BREAKOUT_POLL_INTERVAL_SEC=60
BREAKOUT_ALERT_STATE_FILE=data/breakout-alert-state.json
BREAKOUT_SOURCE_MAX_RETRIES=2
BREAKOUT_SOURCE_RETRY_DELAY_MS=1000
BREAKOUT_DAILY_TREND_DAYS=120
BREAKOUT_DAILY_TREND_MIN_MOVE_PCT=20
BREAKOUT_DAILY_FLAT_MAX_RANGE_PCT=35
```

### `/api/collectors`

```json
POST /api/collectors
{
  "mints": ["mint1...pump", "mint2...pump"],
  "holdersPerToken": 25,
  "recencyDays": 30
}
```

Returns the pooled top holders, classified into tiers, with the survivors of the real-collector filter ranked by pump.fun bag count and history length.

### `/api/airdrop`

```json
POST /api/airdrop
{
  "mint": "ADue87cP...pump",
  "recipients": [{ "wallet": "..." }],
  "defaultAmount": 1000,
  "dryRun": true
}
```

Returns the deduped recipient list, total amount, and a CSV payload you can pipe into a signer.

## CLI

```bash
# Find real collectors across pump.fun graduates
npx tsx scripts/pumpscan-cli.ts collectors <mint1> <mint2> ... \
    --top=25 --recency=30

# Same scan, plus an airdrop plan for the top 10 wallets
npx tsx scripts/pumpscan-cli.ts collectors <mint1> <mint2> ... \
    --token=ADue87cP...pump --airdrop=1000 --airdrop-top=10

# Plan an airdrop from an existing CSV (one wallet per line, or `wallet,amount`)
npx tsx scripts/pumpscan-cli.ts airdrop ./recipients.csv ADue87cP...pump 1000
```

## Deploy

```bash
npm run build
npm start
```

Pi deploy:

```bash
./scripts/deploy-pi.sh
```

The Pi deploy installs both `pumpscan.service` for the web app and `pumpscan-scanner.service` for Telegram alert delivery. It preserves the remote `.env.local` by default so deployed secrets are not overwritten; run `SYNC_ENV=1 ./scripts/deploy-pi.sh` only when you intentionally want to replace the remote env file from your local copy. The remote `data/` directory is also preserved so alert subscribers and breakout state survive deploys.

---

*Built by [Yoshi Kondo](https://linkedin.com/in/yoshi-kondo-3110462a9/) · [@yksanjo](https://github.com/yksanjo)*
