import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BreakoutAlertScanner,
  evaluateDailyTrendContext,
  evaluateBreakout,
  evaluateCloseBreakout,
  formatBreakoutTimeframe,
  parseBreakoutRules,
  parseBreakoutTriggerMode,
  parseBreakoutTimeframeMinutes,
  type OhlcvCandle,
} from "./breakout-alerts";

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;
const BASE_TS = Date.UTC(2026, 0, 1, 0, 0, 0);

test("alerts when the latest closed candle close breaks the prior close lookback", () => {
  const candles = buildCandles([1, 1.01, 1.02, 1.03, 1.06]);

  const signal = evaluateCloseBreakout({
    mint: "SOAG",
    name: "SOAG / SOL",
    symbol: "SOAG",
    network: "solana",
    poolAddress: "pool",
    poolName: "SOAG / SOL",
    candles,
    timeframeMinutes: 15,
    lookbackCandles: 4,
    nowMs: BASE_TS + candles.length * FIFTEEN_MINUTES,
  });

  assert.ok(signal);
  assert.equal(signal.breakoutClose, 1.06);
  assert.equal(signal.previousLookbackClose, 1.03);
});

test("does not alert when only the high breaks out but the close does not", () => {
  const candles = buildCandles([1, 1.01, 1.02, 1.03, 1.025]);
  candles[candles.length - 1].high = 1.2;

  const signal = evaluateCloseBreakout({
    mint: "SOAG",
    name: "SOAG / SOL",
    symbol: "SOAG",
    network: "solana",
    poolAddress: "pool",
    poolName: "SOAG / SOL",
    candles,
    timeframeMinutes: 15,
    lookbackCandles: 4,
    nowMs: BASE_TS + candles.length * FIFTEEN_MINUTES,
  });

  assert.equal(signal, null);
});

test("does not use an unfinished current candle for breakout detection", () => {
  const candles = buildCandles([1, 1.01, 1.02, 1.03, 1.02, 1.2]);
  const currentCandleOpenedAt = candles[candles.length - 1].timestamp;

  const signal = evaluateCloseBreakout({
    mint: "SOAG",
    name: "SOAG / SOL",
    symbol: "SOAG",
    network: "solana",
    poolAddress: "pool",
    poolName: "SOAG / SOL",
    candles,
    timeframeMinutes: 15,
    lookbackCandles: 4,
    nowMs: currentCandleOpenedAt + 60_000,
  });

  assert.equal(signal, null);
});

test("15m breakout waits for candle close even when live is requested", () => {
  const candles = buildCandles([1, 1.01, 1.02, 1.03, 1.02]);
  const liveCandle = candles[candles.length - 1];
  liveCandle.high = 1.12;
  liveCandle.close = 1.08;

  const activeSignal = evaluateBreakout({
    mint: "SOAG",
    name: "SOAG / SOL",
    symbol: "SOAG",
    network: "solana",
    poolAddress: "pool",
    poolName: "SOAG / SOL",
    candles,
    timeframeMinutes: 15,
    lookbackCandles: 4,
    triggerMode: "live",
    nowMs: liveCandle.timestamp + 60_000,
  });

  const closedSignal = evaluateBreakout({
    mint: "SOAG",
    name: "SOAG / SOL",
    symbol: "SOAG",
    network: "solana",
    poolAddress: "pool",
    poolName: "SOAG / SOL",
    candles,
    timeframeMinutes: 15,
    lookbackCandles: 4,
    triggerMode: "live",
    nowMs: liveCandle.timestamp + FIFTEEN_MINUTES,
  });

  assert.equal(activeSignal, null);
  assert.ok(closedSignal);
  assert.equal(closedSignal.triggerMode, "close");
  assert.equal(closedSignal.breakoutSource, "close");
  assert.equal(closedSignal.breakoutPrice, 1.08);
  assert.equal(closedSignal.breakoutClose, 1.08);
  assert.equal(closedSignal.previousLookbackClose, 1.03);
});

test("live breakout alerts during an active non-15m candle when high clears the lookback", () => {
  const candles = buildHourlyCandles([1, 1.01, 1.02, 1.03, 1.02]);
  const liveCandle = candles[candles.length - 1];
  liveCandle.high = 1.12;
  liveCandle.close = 1.08;

  const signal = evaluateBreakout({
    mint: "SOAG",
    name: "SOAG / SOL",
    symbol: "SOAG",
    network: "solana",
    poolAddress: "pool",
    poolName: "SOAG / SOL",
    candles,
    timeframeMinutes: 60,
    lookbackCandles: 4,
    triggerMode: "live",
    nowMs: liveCandle.timestamp + 60_000,
  });

  assert.ok(signal);
  assert.equal(signal.triggerMode, "live");
  assert.equal(signal.breakoutSource, "high");
  assert.equal(signal.breakoutPrice, 1.12);
  assert.equal(signal.breakoutClose, 1.08);
  assert.equal(signal.previousLookbackClose, 1.03);
});

test("does not alert on an unfinished daily candle before UTC day close", () => {
  const candles = buildDailyCandles([300_000, 350_000, 406_180]);
  const currentDailyCandleOpenedAt = candles[candles.length - 1].timestamp;

  const signal = evaluateCloseBreakout({
    mint: "SOAG",
    name: "SOAG / SOL",
    symbol: "SOAG",
    network: "solana",
    poolAddress: "pool",
    poolName: "SOAG / SOL",
    candles,
    timeframeMinutes: 1440,
    lookbackCandles: 2,
    nowMs: currentDailyCandleOpenedAt + 12 * 60 * 60 * 1000,
  });

  assert.equal(signal, null);
});

test("alerts on the latest closed daily candle after the UTC day boundary", () => {
  const candles = buildDailyCandles([300_000, 350_000, 406_180]);

  const signal = evaluateCloseBreakout({
    mint: "SOAG",
    name: "SOAG / SOL",
    symbol: "SOAG",
    network: "solana",
    poolAddress: "pool",
    poolName: "SOAG / SOL",
    candles,
    timeframeMinutes: 1440,
    lookbackCandles: 2,
    nowMs: BASE_TS + candles.length * ONE_DAY,
  });

  assert.ok(signal);
  assert.equal(signal.breakoutClose, 406_180);
  assert.equal(signal.previousLookbackClose, 350_000);
  assert.equal(signal.candleClosedAt, BASE_TS + candles.length * ONE_DAY);
});

test("parses and formats breakout timeframes", () => {
  assert.equal(parseBreakoutTimeframeMinutes("15m"), 15);
  assert.equal(parseBreakoutTimeframeMinutes("1h"), 60);
  assert.equal(parseBreakoutTimeframeMinutes("4H"), 240);
  assert.equal(parseBreakoutTimeframeMinutes("1d"), 1440);
  assert.equal(parseBreakoutTimeframeMinutes("bad", 30), 30);
  assert.equal(formatBreakoutTimeframe(15), "15M");
  assert.equal(formatBreakoutTimeframe(1440), "1D");
  assert.equal(parseBreakoutTriggerMode("live"), "live");
  assert.equal(parseBreakoutTriggerMode("high"), "live");
  assert.equal(parseBreakoutTriggerMode("close"), "close");
  assert.equal(parseBreakoutTriggerMode("bad", "live"), "live");
});

test("parses multiple breakout rules", () => {
  const rules = parseBreakoutRules("1d:20:0:close,4h:12:1.5 15m:8:live", {
    timeframeMinutes: 1440,
    lookbackCandles: 30,
    minBreakoutPct: 0,
    triggerMode: "close",
  });

  assert.deepEqual(rules, [
    { timeframeMinutes: 15, lookbackCandles: 8, minBreakoutPct: 0, triggerMode: "close" },
    { timeframeMinutes: 240, lookbackCandles: 12, minBreakoutPct: 1.5, triggerMode: "close" },
    { timeframeMinutes: 1440, lookbackCandles: 20, minBreakoutPct: 0, triggerMode: "close" },
  ]);
});

test("daily scanner uses the day OHLCV endpoint and de-dupes the same candle", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "pumpscan-breakout-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const requestedUrls: URL[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    requestedUrls.push(url);

    if (url.pathname.endsWith("/tokens/SOAG/pools")) {
      return jsonResponse({
        data: [
          {
            id: "solana_pool",
            attributes: {
              address: "pool",
              name: "SOAG / SOL",
              reserve_in_usd: "1000000",
            },
            relationships: {
              base_token: { data: { id: "solana_SOAG" } },
            },
          },
        ],
        included: [
          {
            id: "solana_SOAG",
            attributes: { symbol: "SOAG" },
          },
        ],
      });
    }

    if (url.pathname.endsWith("/pools/pool/ohlcv/day")) {
      return jsonResponse({
        data: {
          attributes: {
            ohlcv_list: [
              [Date.UTC(2026, 5, 27) / 1000, 300_000, 300_000, 300_000, 300_000, 10_000],
              [Date.UTC(2026, 5, 28) / 1000, 350_000, 350_000, 350_000, 350_000, 11_000],
              [Date.UTC(2026, 5, 29) / 1000, 406_180, 406_180, 406_180, 406_180, 12_000],
            ],
          },
        },
      });
    }

    return new Response("not found", { status: 404 });
  };

  const scanner = new BreakoutAlertScanner(
    {
      mints: ["SOAG"],
      timeframeMinutes: 1440,
      lookbackCandles: 2,
      dailyTrendLookbackDays: 30,
      stateFile: path.join(dir, "state.json"),
    },
    fetchImpl
  );

  const signals = await scanner.checkAll(Date.UTC(2026, 5, 30, 0, 0, 0));
  const repeatedSignals = await scanner.checkAll(Date.UTC(2026, 5, 30, 0, 1, 0));
  const dayUrls = requestedUrls.filter((url) => url.pathname.endsWith("/ohlcv/day"));

  assert.equal(signals.length, 1);
  assert.equal(signals[0].breakoutClose, 406_180);
  assert.equal(repeatedSignals.length, 0);
  assert.equal(requestedUrls.some((url) => url.pathname.endsWith("/ohlcv/minute")), false);
  assert.ok(dayUrls.length >= 1);
  assert.equal(dayUrls[0].searchParams.get("aggregate"), "1");
  assert.equal(
    dayUrls[0].searchParams.get("before_timestamp"),
    String(Date.UTC(2026, 5, 30, 0, 0, 0) / 1000)
  );
});

test("multi-rule scanner alerts once per lookback for the same closed daily candle", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "pumpscan-breakout-rules-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const requestedUrls: URL[] = [];
  const fetchImpl = mockGeckoFetch(requestedUrls, [
    [Date.UTC(2026, 5, 26) / 1000, 100_000, 100_000, 100_000, 100_000, 9_000],
    [Date.UTC(2026, 5, 27) / 1000, 200_000, 200_000, 200_000, 200_000, 10_000],
    [Date.UTC(2026, 5, 28) / 1000, 250_000, 250_000, 250_000, 250_000, 11_000],
    [Date.UTC(2026, 5, 29) / 1000, 406_180, 406_180, 406_180, 406_180, 12_000],
  ]);
  const scanner = new BreakoutAlertScanner(
    {
      mints: ["SOAG"],
      rules: [
        { timeframeMinutes: 1440, lookbackCandles: 2, minBreakoutPct: 0, triggerMode: "close" },
        { timeframeMinutes: 1440, lookbackCandles: 3, minBreakoutPct: 0, triggerMode: "close" },
      ],
      dailyTrendLookbackDays: 30,
      stateFile: path.join(dir, "state.json"),
    },
    fetchImpl
  );

  const signals = await scanner.checkAll(Date.UTC(2026, 5, 30, 0, 0, 0));
  const repeatedSignals = await scanner.checkAll(Date.UTC(2026, 5, 30, 0, 1, 0));
  const breakoutDailyUrls = requestedUrls.filter(
    (url) => url.pathname.endsWith("/ohlcv/day") && url.searchParams.get("limit") === "6"
  );
  const dailyTrendUrls = requestedUrls.filter(
    (url) => url.pathname.endsWith("/ohlcv/day") && url.searchParams.get("limit") === "33"
  );

  assert.equal(signals.length, 2);
  assert.deepEqual(signals.map((signal) => signal.lookbackCandles), [2, 3]);
  assert.equal(repeatedSignals.length, 0);
  assert.ok(breakoutDailyUrls.length >= 1);
  assert.equal(dailyTrendUrls.length, 1);
});

test("scanner adds recent pump.fun graduates and close-confirms 15m candle", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "pumpscan-breakout-graduates-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const graduateMint = "ADue87cPcDhsyGq2hrDsukp7j8AFTSnaYHSanDATpump";
  const requestedUrls: URL[] = [];
  const activeNowMs = BASE_TS + 4 * FIFTEEN_MINUTES + 60_000;
  const closeNowMs = BASE_TS + 5 * FIFTEEN_MINUTES;
  const fetchImpl: typeof fetch = async (input) => {
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    requestedUrls.push(url);

    if (url.pathname.endsWith("/networks/solana/new_pools")) {
      return jsonResponse({
        data: [
          {
            id: "solana_recentpool",
            attributes: {
              address: "recentpool",
              name: "GRAD / SOL",
              reserve_in_usd: "75000",
            },
            relationships: {
              base_token: { data: { id: `solana_${graduateMint}` } },
            },
          },
        ],
        included: [
          {
            id: `solana_${graduateMint}`,
            attributes: { address: graduateMint, symbol: "GRAD" },
          },
        ],
      });
    }

    if (url.pathname.endsWith("/pools/recentpool/ohlcv/minute")) {
      return jsonResponse({
        data: {
          attributes: {
            ohlcv_list: [
              [BASE_TS / 1000, 1, 1, 1, 1, 1_000],
              [(BASE_TS + FIFTEEN_MINUTES) / 1000, 1.01, 1.01, 1.01, 1.01, 1_100],
              [(BASE_TS + 2 * FIFTEEN_MINUTES) / 1000, 1.02, 1.02, 1.02, 1.02, 1_200],
              [(BASE_TS + 3 * FIFTEEN_MINUTES) / 1000, 1.03, 1.03, 1.03, 1.03, 1_300],
              [(BASE_TS + 4 * FIFTEEN_MINUTES) / 1000, 1.02, 1.2, 1.02, 1.15, 2_500],
            ],
          },
        },
      });
    }

    return new Response("not found", { status: 404 });
  };

  const scanner = new BreakoutAlertScanner(
    {
      mints: [],
      rules: [{ timeframeMinutes: 15, lookbackCandles: 4, minBreakoutPct: 0, triggerMode: "live" }],
      includeRecentGraduates: true,
      recentGraduatesPages: 1,
      recentGraduatesMaxAgeMinutes: 180,
      maxDynamicMints: 10,
      dailyTrendLookbackDays: 30,
      sourceMaxRetries: 0,
      sourceRetryDelayMs: 0,
      stateFile: path.join(dir, "state.json"),
    },
    fetchImpl
  );

  const activeSignals = await scanner.checkAll(activeNowMs);
  const signals = await scanner.checkAll(closeNowMs);
  const minuteUrls = requestedUrls.filter((url) => url.pathname.endsWith("/ohlcv/minute"));

  assert.equal(activeSignals.length, 0);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].mint, graduateMint);
  assert.equal(signals[0].triggerMode, "close");
  assert.equal(signals[0].breakoutSource, "close");
  assert.equal(signals[0].breakoutPrice, 1.15);
  assert.equal(requestedUrls.some((url) => url.pathname.includes(`/tokens/${graduateMint}/pools`)), false);
  assert.equal(minuteUrls.length, 2);
  assert.equal(
    minuteUrls[0].searchParams.get("before_timestamp"),
    String((BASE_TS + 4 * FIFTEEN_MINUTES) / 1000)
  );
  assert.equal(
    minuteUrls[1].searchParams.get("before_timestamp"),
    String((BASE_TS + 5 * FIFTEEN_MINUTES) / 1000)
  );
});

test("scanner retries retryable GeckoTerminal responses", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "pumpscan-breakout-retry-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  let poolCalls = 0;
  const requestedUrls: URL[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    requestedUrls.push(url);

    if (url.pathname.endsWith("/tokens/SOAG/pools")) {
      poolCalls += 1;
      if (poolCalls === 1) return new Response("rate limited", { status: 429 });
      return mockPoolResponse();
    }

    if (url.pathname.endsWith("/pools/pool/ohlcv/day")) {
      return jsonResponse({
        data: {
          attributes: {
            ohlcv_list: [
              [Date.UTC(2026, 5, 27) / 1000, 300_000, 300_000, 300_000, 300_000, 10_000],
              [Date.UTC(2026, 5, 28) / 1000, 350_000, 350_000, 350_000, 350_000, 11_000],
              [Date.UTC(2026, 5, 29) / 1000, 406_180, 406_180, 406_180, 406_180, 12_000],
            ],
          },
        },
      });
    }

    return new Response("not found", { status: 404 });
  };

  const scanner = new BreakoutAlertScanner(
    {
      mints: ["SOAG"],
      timeframeMinutes: 1440,
      lookbackCandles: 2,
      dailyTrendLookbackDays: 30,
      stateFile: path.join(dir, "state.json"),
      sourceMaxRetries: 1,
      sourceRetryDelayMs: 0,
    },
    fetchImpl
  );

  const signals = await scanner.checkAll(Date.UTC(2026, 5, 30, 0, 0, 0));

  assert.equal(poolCalls, 2);
  assert.equal(signals.length, 1);
});

test("daily chart context marks a clear downtrend as pass", () => {
  const candles = buildDailyCandles(
    Array.from({ length: 120 }, (_, i) => 2 - i * 0.006)
  );

  const context = evaluateDailyTrendContext(candles, {
    lookbackDays: 120,
    minTrendMovePct: 20,
    nowMs: BASE_TS + candles.length * ONE_DAY,
  });

  assert.equal(context.direction, "downtrend");
  assert.equal(context.action, "pass");
});

test("daily chart context keeps a clear uptrend neutral", () => {
  const candles = buildDailyCandles(
    Array.from({ length: 120 }, (_, i) => 1 + i * 0.008)
  );

  const context = evaluateDailyTrendContext(candles, {
    lookbackDays: 120,
    minTrendMovePct: 20,
    nowMs: BASE_TS + candles.length * ONE_DAY,
  });

  assert.equal(context.direction, "uptrend");
  assert.equal(context.action, "neutral");
});

test("daily chart context marks multi-month flat price action for review", () => {
  const candles = buildDailyCandles(
    Array.from({ length: 120 }, (_, i) => 1 + (i % 2 === 0 ? 0.04 : -0.04))
  );

  const context = evaluateDailyTrendContext(candles, {
    lookbackDays: 120,
    minTrendMovePct: 20,
    flatMaxRangePct: 35,
    nowMs: BASE_TS + candles.length * ONE_DAY,
  });

  assert.equal(context.direction, "flat");
  assert.equal(context.action, "review");
});

function buildCandles(closes: number[]): OhlcvCandle[] {
  return closes.map((close, i) => ({
    timestamp: BASE_TS + i * FIFTEEN_MINUTES,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000 + i,
  }));
}

function buildHourlyCandles(closes: number[]): OhlcvCandle[] {
  return closes.map((close, i) => ({
    timestamp: BASE_TS + i * 60 * 60 * 1000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000 + i,
  }));
}

function buildDailyCandles(closes: number[]): OhlcvCandle[] {
  return closes.map((close, i) => ({
    timestamp: BASE_TS + i * ONE_DAY,
    open: close,
    high: close,
    low: close,
    close,
    volume: 10_000 + i,
  }));
}

function mockGeckoFetch(requestedUrls: URL[], ohlcvRows: unknown[]): typeof fetch {
  return async (input) => {
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    requestedUrls.push(url);

    if (url.pathname.endsWith("/tokens/SOAG/pools")) {
      return mockPoolResponse();
    }

    if (url.pathname.endsWith("/pools/pool/ohlcv/day")) {
      return jsonResponse({
        data: {
          attributes: {
            ohlcv_list: ohlcvRows,
          },
        },
      });
    }

    return new Response("not found", { status: 404 });
  };
}

function mockPoolResponse(): Response {
  return jsonResponse({
    data: [
      {
        id: "solana_pool",
        attributes: {
          address: "pool",
          name: "SOAG / SOL",
          reserve_in_usd: "1000000",
        },
        relationships: {
          base_token: { data: { id: "solana_SOAG" } },
        },
      },
    ],
    included: [
      {
        id: "solana_SOAG",
        attributes: { symbol: "SOAG" },
      },
    ],
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
