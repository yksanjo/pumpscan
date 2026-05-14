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
- 👤 Dev wallet portfolio analysis
- ⚖️ Side-by-side token comparison

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

## Deploy

```bash
npm run build
npm start
```

---

*Built by [Yoshi Kondo](https://linkedin.com/in/yoshi-kondo-3110462a9/) · [@yksanjo](https://github.com/yksanjo)*
