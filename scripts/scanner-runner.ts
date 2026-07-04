#!/usr/bin/env tsx
/**
 * Pumpscan New Token Scanner — runs as a background service,
 * polls pump.fun for new tokens, analyzes them, and sends alerts.
 *
 * Usage:
 *   npx tsx scripts/scanner-runner.ts
 *
 * Environment variables (in .env.local):
 *   HELIUS_API_KEY       — Required
 *   DISCORD_WEBHOOK_URL  — Optional (for alerts)
 *   SLACK_WEBHOOK_URL    — Optional (for alerts)
 *   TELEGRAM_BOT_TOKEN   — Optional (for alerts)
 *   TELEGRAM_CHAT_ID     — Optional (for alerts)
 *
 * Deploy as a systemd service:
 *   [Unit]
 *   Description=Pumpscan Token Scanner
 *   After=network.target
 *
 *   [Service]
 *   Type=simple
 *   WorkingDirectory=/home/yojinbot/pumpscan
 *   EnvironmentFile=/home/yojinbot/pumpscan/.env.local
 *   ExecStart=/usr/bin/node scripts/scanner-runner.ts
 *   Restart=on-failure
 *
 *   [Install]
 *   WantedBy=multi-user.target
 */

import "./load-env";
import { NewTokenScanner, type NewTokenAlert } from "../src/lib/new-token-scanner";
import {
  deliverAlertToEligibleTelegramSubscribers,
  deliverBreakoutAlertToEligibleTelegramSubscribers,
} from "../src/lib/alert-delivery";
import {
  BreakoutAlertScanner,
  DEFAULT_BREAKOUT_LOOKBACK_CANDLES,
  DEFAULT_BREAKOUT_MIN_PCT,
  DEFAULT_BREAKOUT_TIMEFRAME_MINUTES,
  DEFAULT_MAX_DYNAMIC_MINTS,
  DEFAULT_DAILY_FLAT_MAX_RANGE_PCT,
  DEFAULT_DAILY_TREND_LOOKBACK_DAYS,
  DEFAULT_DAILY_TREND_MIN_MOVE_PCT,
  DEFAULT_RECENT_GRADUATES_MAX_AGE_MINUTES,
  DEFAULT_RECENT_GRADUATES_PAGES,
  DEFAULT_SOURCE_MAX_RETRIES,
  DEFAULT_SOURCE_RETRY_DELAY_MS,
  formatBreakoutTimeframe,
  parseBreakoutRules,
  parseBreakoutTimeframeMinutes,
  parseBreakoutTriggerMode,
  parseBreakoutWatchMints,
  type BreakoutRuleConfig,
  type BreakoutSignal,
} from "../src/lib/breakout-alerts";
import { SOAG_MINT } from "../src/lib/soag-access";
import {
  formatBreakoutTelegramAlert,
  formatNewTokenTelegramAlert,
  sendTelegramMessage,
} from "../src/lib/telegram-alerts";
import {
  appendRadarEvent,
  breakoutSignalToRadarEvent,
  newTokenAlertToRadarEvent,
} from "../src/lib/radar-events";

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BREAKOUT_WATCH_MINTS = parseBreakoutWatchMints(process.env.BREAKOUT_WATCH_MINTS, [
  SOAG_MINT,
]);
const BREAKOUT_TIMEFRAME_MINUTES = parseBreakoutTimeframeMinutes(
  process.env.BREAKOUT_TIMEFRAME ?? process.env.BREAKOUT_TIMEFRAME_MINUTES,
  DEFAULT_BREAKOUT_TIMEFRAME_MINUTES
);
const BREAKOUT_POLL_INTERVAL_SEC = positiveNumberEnv("BREAKOUT_POLL_INTERVAL_SEC", 60);
const BREAKOUT_LOOKBACK_CANDLES = positiveIntegerEnv(
  "BREAKOUT_LOOKBACK_CANDLES",
  DEFAULT_BREAKOUT_LOOKBACK_CANDLES
);
const BREAKOUT_MIN_CLOSE_MOVE_PCT = nonNegativeNumberEnv(
  "BREAKOUT_MIN_CLOSE_MOVE_PCT",
  DEFAULT_BREAKOUT_MIN_PCT
);
const BREAKOUT_TRIGGER_MODE = parseBreakoutTriggerMode(
  process.env.BREAKOUT_TRIGGER_MODE,
  "close"
);
const BREAKOUT_RULES = parseBreakoutRules(process.env.BREAKOUT_RULES, {
  timeframeMinutes: BREAKOUT_TIMEFRAME_MINUTES,
  lookbackCandles: BREAKOUT_LOOKBACK_CANDLES,
  minBreakoutPct: BREAKOUT_MIN_CLOSE_MOVE_PCT,
  triggerMode: BREAKOUT_TRIGGER_MODE,
});
const BREAKOUT_INCLUDE_RECENT_GRADUATES = booleanEnv(
  "BREAKOUT_INCLUDE_RECENT_GRADUATES",
  true
);
const BREAKOUT_RECENT_GRADUATES_PAGES = positiveIntegerEnv(
  "BREAKOUT_RECENT_GRADUATES_PAGES",
  DEFAULT_RECENT_GRADUATES_PAGES
);
const BREAKOUT_RECENT_GRADUATES_MAX_AGE_MINUTES = positiveIntegerEnv(
  "BREAKOUT_RECENT_GRADUATES_MAX_AGE_MINUTES",
  DEFAULT_RECENT_GRADUATES_MAX_AGE_MINUTES
);
const BREAKOUT_MAX_DYNAMIC_MINTS = nonNegativeIntegerEnv(
  "BREAKOUT_MAX_DYNAMIC_MINTS",
  DEFAULT_MAX_DYNAMIC_MINTS
);
const BREAKOUT_DAILY_TREND_DAYS = positiveIntegerEnv(
  "BREAKOUT_DAILY_TREND_DAYS",
  DEFAULT_DAILY_TREND_LOOKBACK_DAYS
);
const BREAKOUT_DAILY_TREND_MIN_MOVE_PCT = nonNegativeNumberEnv(
  "BREAKOUT_DAILY_TREND_MIN_MOVE_PCT",
  DEFAULT_DAILY_TREND_MIN_MOVE_PCT
);
const BREAKOUT_DAILY_FLAT_MAX_RANGE_PCT = nonNegativeNumberEnv(
  "BREAKOUT_DAILY_FLAT_MAX_RANGE_PCT",
  DEFAULT_DAILY_FLAT_MAX_RANGE_PCT
);
const BREAKOUT_SOURCE_MAX_RETRIES = nonNegativeIntegerEnv(
  "BREAKOUT_SOURCE_MAX_RETRIES",
  DEFAULT_SOURCE_MAX_RETRIES
);
const BREAKOUT_SOURCE_RETRY_DELAY_MS = nonNegativeIntegerEnv(
  "BREAKOUT_SOURCE_RETRY_DELAY_MS",
  DEFAULT_SOURCE_RETRY_DELAY_MS
);

const webhooks: string[] = [];
if (DISCORD_WEBHOOK) webhooks.push(DISCORD_WEBHOOK);
if (SLACK_WEBHOOK) webhooks.push(SLACK_WEBHOOK);

async function sendDefaultTelegram(message: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await sendTelegramMessage(TELEGRAM_CHAT_ID, message);
  } catch (err) {
    console.error("Telegram send failed:", err);
  }
}

function onToken(alert: NewTokenAlert) {
  const emoji = alert.verdict === "clean" ? "🟢" : alert.verdict === "caution" ? "🟡" : "🔴";

  const message = formatNewTokenTelegramAlert(alert);

  void appendRadarEvent(newTokenAlertToRadarEvent(alert)).catch((err) => {
    console.error("[Radar] Failed to write new-token event:", err);
  });

  // Send to optional default chat and verified SOAG-gated subscribers.
  void sendDefaultTelegram(message);
  void deliverAlertToEligibleTelegramSubscribers(alert).then((delivery) => {
    if (delivery.attempted > 0) {
      console.log(
        `[Alerts] Telegram subscribers: ${delivery.sent}/${delivery.attempted} sent` +
          (delivery.disabled ? `, ${delivery.disabled} disabled` : "")
      );
    }
  });

  // Log to console
  const time = new Date().toLocaleTimeString();
  console.log(
    `[${time}] ${emoji} ${alert.symbol.padEnd(10)} ` +
    `risk ${String(alert.riskScore).padStart(3)}/100 · ` +
    `${String(alert.holders).padStart(5)} holders · ` +
    `${formatUsd(alert.mcapUsd).padStart(10)} · ` +
    `${alert.ageSeconds}s old`
  );
}

function onBreakout(signal: BreakoutSignal) {
  const message = formatBreakoutTelegramAlert(signal);

  void appendRadarEvent(breakoutSignalToRadarEvent(signal)).catch((err) => {
    console.error("[Radar] Failed to write breakout event:", err);
  });

  // Send to optional default chat and verified SOAG-gated subscribers.
  void sendDefaultTelegram(message);
  void deliverBreakoutAlertToEligibleTelegramSubscribers(signal).then((delivery) => {
    if (delivery.attempted > 0) {
      console.log(
        `[Breakout] Telegram subscribers: ${delivery.sent}/${delivery.attempted} sent` +
          (delivery.disabled ? `, ${delivery.disabled} disabled` : "")
      );
    }
  });

  const time = new Date().toLocaleTimeString();
  const triggerLabel = signal.breakoutSource === "high" ? "high" : "close";
  console.log(
    `[${time}] ${formatBreakoutTimeframe(signal.timeframeMinutes)} ${signal.triggerMode} breakout ${signal.symbol.padEnd(10)} ${triggerLabel} ` +
      `${formatPriceUsd(signal.breakoutPrice)} > ` +
      `${formatPriceUsd(signal.previousLookbackClose)} ` +
      `(+${signal.breakoutPct.toFixed(2)}%)`
  );
}

function formatUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatPriceUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n >= 1) return `$${n.toFixed(4)}`;
  if (n >= 0.01) return `$${n.toFixed(6)}`;
  if (n >= 0.000001) return `$${n.toFixed(8)}`;
  return `$${n.toExponential(3)}`;
}

function positiveNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = Math.floor(Number(process.env[name]));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeIntegerEnv(name: string, fallback: number): number {
  const value = Math.floor(Number(process.env[name]));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(raw)) return true;
  if (["0", "false", "no", "n", "off"].includes(raw)) return false;
  return fallback;
}

function formatBreakoutRuleList(rules: BreakoutRuleConfig[]): string {
  return rules
    .map((rule) => {
      const minMove = rule.minBreakoutPct > 0 ? `, +${rule.minBreakoutPct}% min` : "";
      return `${formatBreakoutTimeframe(rule.timeframeMinutes)} ${rule.lookbackCandles}c ${rule.triggerMode}${minMove}`;
    })
    .join("; ");
}

// Main
console.log("╔══════════════════════════════════════════════╗");
console.log("║      Pumpscan New Token Scanner v1          ║");
console.log("╚══════════════════════════════════════════════╝");
console.log("");

if (!process.env.HELIUS_API_KEY) {
  console.error("❌ HELIUS_API_KEY not set in .env.local");
  process.exit(1);
}

console.log(`📡 Helius API: configured`);
console.log(`🔔 Discord: ${DISCORD_WEBHOOK ? "✅" : "❌ not configured"}`);
console.log(`🔔 Slack: ${SLACK_WEBHOOK ? "✅" : "❌ not configured"}`);
console.log(`🔔 Telegram bot: ${TELEGRAM_BOT_TOKEN ? "✅" : "❌ not configured"}`);
console.log(`🔔 Default Telegram chat: ${TELEGRAM_CHAT_ID ? "✅" : "❌ not configured"}`);
console.log(
  `📈 Breakout radar: ${BREAKOUT_WATCH_MINTS.length} static mint(s), ` +
    `${BREAKOUT_RULES.length} rule(s): ${formatBreakoutRuleList(BREAKOUT_RULES)}`
);
console.log(
  `🆕 Recent graduates: ${BREAKOUT_INCLUDE_RECENT_GRADUATES ? "enabled" : "disabled"}` +
    (BREAKOUT_INCLUDE_RECENT_GRADUATES
      ? `, ${BREAKOUT_RECENT_GRADUATES_MAX_AGE_MINUTES}m window, max ${BREAKOUT_MAX_DYNAMIC_MINTS}`
      : "")
);
console.log(
  `📊 Daily chart gate: ${BREAKOUT_DAILY_TREND_DAYS}D lookback, ` +
    `${BREAKOUT_DAILY_TREND_MIN_MOVE_PCT}% trend threshold, ` +
    `${BREAKOUT_DAILY_FLAT_MAX_RANGE_PCT}% flat range`
);
console.log(
  `🔁 GeckoTerminal retries: ${BREAKOUT_SOURCE_MAX_RETRIES} max, ` +
    `${BREAKOUT_SOURCE_RETRY_DELAY_MS}ms base delay`
);
console.log("");

const scanner = new NewTokenScanner({
  pollIntervalSec: 15,
  maxRiskScore: 25,    // Alert on tokens with risk <= 25 (good finds)
  minRiskScore: 55,    // Alert on tokens with risk >= 55 (rug warnings)
  minHolders: 5,
  maxAgeSec: 600,      // 10 minutes
  webhooks,
});

scanner.start(onToken);

const breakoutScanner = new BreakoutAlertScanner({
  mints: BREAKOUT_WATCH_MINTS,
  timeframeMinutes: BREAKOUT_RULES[0]?.timeframeMinutes ?? BREAKOUT_TIMEFRAME_MINUTES,
  lookbackCandles: BREAKOUT_RULES[0]?.lookbackCandles ?? BREAKOUT_LOOKBACK_CANDLES,
  minBreakoutPct: BREAKOUT_RULES[0]?.minBreakoutPct ?? BREAKOUT_MIN_CLOSE_MOVE_PCT,
  triggerMode: BREAKOUT_RULES[0]?.triggerMode ?? BREAKOUT_TRIGGER_MODE,
  rules: BREAKOUT_RULES,
  includeRecentGraduates: BREAKOUT_INCLUDE_RECENT_GRADUATES,
  recentGraduatesPages: BREAKOUT_RECENT_GRADUATES_PAGES,
  recentGraduatesMaxAgeMinutes: BREAKOUT_RECENT_GRADUATES_MAX_AGE_MINUTES,
  maxDynamicMints: BREAKOUT_MAX_DYNAMIC_MINTS,
  dailyTrendLookbackDays: BREAKOUT_DAILY_TREND_DAYS,
  dailyTrendMinMovePct: BREAKOUT_DAILY_TREND_MIN_MOVE_PCT,
  dailyFlatMaxRangePct: BREAKOUT_DAILY_FLAT_MAX_RANGE_PCT,
  sourceMaxRetries: BREAKOUT_SOURCE_MAX_RETRIES,
  sourceRetryDelayMs: BREAKOUT_SOURCE_RETRY_DELAY_MS,
  stateFile: process.env.BREAKOUT_ALERT_STATE_FILE || "data/breakout-alert-state.json",
});

let breakoutCheckRunning = false;
async function checkBreakouts() {
  if (breakoutCheckRunning) return;
  breakoutCheckRunning = true;
  try {
    const signals = await breakoutScanner.checkAll();
    for (const signal of signals) onBreakout(signal);
  } finally {
    breakoutCheckRunning = false;
  }
}

void checkBreakouts();
const breakoutIntervalId = setInterval(
  () => void checkBreakouts(),
  BREAKOUT_POLL_INTERVAL_SEC * 1000
);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n👋 Shutting down...");
  clearInterval(breakoutIntervalId);
  scanner.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n\n👋 Shutting down...");
  clearInterval(breakoutIntervalId);
  scanner.stop();
  process.exit(0);
});
