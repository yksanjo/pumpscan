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

import { NewTokenScanner, type NewTokenAlert } from "../src/lib/new-token-scanner";

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const webhooks: string[] = [];
if (DISCORD_WEBHOOK) webhooks.push(DISCORD_WEBHOOK);
if (SLACK_WEBHOOK) webhooks.push(SLACK_WEBHOOK);

async function sendTelegram(message: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: "Markdown",
          disable_web_page_preview: true,
        }),
      }
    );
  } catch (err) {
    console.error("Telegram send failed:", err);
  }
}

function onToken(alert: NewTokenAlert) {
  const emoji = alert.verdict === "clean" ? "🟢" : alert.verdict === "caution" ? "🟡" : "🔴";
  const tag = alert.riskScore <= 20 ? "LOW_RISK" : alert.riskScore >= 60 ? "HIGH_RISK" : "MEDIUM_RISK";

  const message = [
    `${emoji} *${tag}* — ${alert.name} (${alert.symbol})`,
    ``,
    `Risk: ${alert.riskScore}/100 · Verdict: ${alert.verdict.toUpperCase()}`,
    `MCap: ${formatUsd(alert.mcapUsd)} · Holders: ${alert.holders}`,
    `Dev holds: ${alert.devHoldsPct}% · Bundles: ${alert.bundlesFound}`,
    `Age: ${alert.ageSeconds}s old`,
    ``,
    `🔍 \`${alert.mint}\``,
    `https://pumpscan.musicailab.com/analyze/${alert.mint}`,
  ].join("\n");

  // Send to Telegram
  sendTelegram(message);

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

function formatUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
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
console.log(`🔔 Telegram: ${TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID ? "✅" : "❌ not configured"}`);
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

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n👋 Shutting down...");
  scanner.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n\n👋 Shutting down...");
  scanner.stop();
  process.exit(0);
});
