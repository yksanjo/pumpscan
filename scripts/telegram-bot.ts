#!/usr/bin/env tsx
/**
 * Pumpscan Telegram Bot — query pump.fun tokens from Telegram.
 *
 * Setup:
 *   1. Create a bot via @BotFather on Telegram
 *   2. Set TELEGRAM_BOT_TOKEN in .env.local
 *   3. Run: npx tsx scripts/telegram-bot.ts
 *
 * Commands:
 *   /analyze <mint-or-url>  — Analyze a token
 *   /compare <a> <b>        — Compare two tokens
 *   /batch <a> <b> <c>...   — Batch scan tokens
 *   /watch <mint>           — Start watching a token
 *   /alerts                 — Show recent alerts
 *   /help                   — Show help
 */

import { analyze } from "../src/lib/analyze";
import { batchScan } from "../src/lib/batch-scanner";
import { compareTokens } from "../src/lib/token-comparator";
import { extractMint } from "../src/lib/parse-input";
import { AlertManager } from "../src/lib/webhook-alerter";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN not set in .env.local");
  process.exit(1);
}

const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;
let lastUpdateId = 0;
const alerts = new AlertManager();

interface Update {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
    from?: { id: number; username?: string };
  };
}

async function sendMessage(chatId: number, text: string, parseMode = "Markdown") {
  await fetch(`${API_BASE}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    }),
  });
}

async function sendTyping(chatId: number) {
  await fetch(`${API_BASE}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  });
}

async function getUpdates(): Promise<Update[]> {
  const res = await fetch(
    `${API_BASE}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`
  );
  if (!res.ok) return [];
  const data = await res.json() as { result?: Update[] };
  return data.result ?? [];
}

async function handleCommand(chatId: number, text: string) {
  const parts = text.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (command) {
    case "/start":
    case "/help":
      await sendMessage(chatId, `
*🤖 Pumpscan Bot*

Analyze pump.fun tokens directly from Telegram.

*Commands:*
\`/analyze <mint-or-url>\` — Analyze a token
\`/compare <a> <b>\` — Compare two tokens
\`/batch <a> <b> <c>...\` — Batch scan tokens
\`/watch <mint>\` — Start watching a token
\`/alerts\` — Show recent alerts
\`/help\` — Show this message

*Examples:*
\`/analyze 6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN\`
\`/analyze https://pump.fun/coin/...\`
      `.trim());
      break;

    case "/analyze": {
      const input = args.join(" ");
      if (!input) {
        await sendMessage(chatId, "❌ Usage: `/analyze <mint-or-url>`");
        return;
      }

      const mint = extractMint(input);
      if (!mint) {
        await sendMessage(chatId, "❌ Could not extract a valid mint address.");
        return;
      }

      await sendTyping(chatId);

      try {
        const result = await analyze(mint);
        const emoji = result.verdict === "clean" ? "🟢" : result.verdict === "caution" ? "🟡" : "🔴";

        let msg = `${emoji} *${result.vitals.name} (${result.vitals.symbol})*\n`;
        msg += `Verdict: *${result.verdict.toUpperCase()}* · Risk: ${result.riskScore}/100\n`;
        msg += `Confidence: ${Math.round(result.confidence * 100)}%\n\n`;
        msg += `📊 *Vitals*\n`;
        msg += `MCap: ${formatUsd(result.vitals.mcapUsd)}\n`;
        msg += `Holders: ${result.vitals.holders.toLocaleString()}\n`;
        msg += `Age: ${result.vitals.ageHours < 24 ? `${result.vitals.ageHours}h` : `${Math.round(result.vitals.ageHours / 24)}d`}\n\n`;
        msg += `📈 *Concentration*\n`;
        msg += `Top 10: ${result.concentration.top10Pct}% · Gini: ${result.concentration.gini.toFixed(2)}\n\n`;

        if (result.bundles.length > 0) {
          msg += `🚩 *Bundles:* ${result.bundles.length} detected\n`;
          msg += `Top bundle: ${result.bundles[0].members.length} wallets, ${result.bundles[0].pctSupply}% supply\n\n`;
        }

        if (result.findings.length > 0) {
          msg += `🔍 *Findings:* ${result.findings.length}\n`;
          for (const f of result.findings.slice(0, 3)) {
            msg += `• ${f.severity === "critical" ? "🔴" : f.severity === "high" ? "🟠" : "🟡"} ${f.title}\n`;
          }
          if (result.findings.length > 3) {
            msg += `  ...and ${result.findings.length - 3} more\n`;
          }
          msg += "\n";
        }

        if (result.narration) {
          msg += `💬 ${result.narration}`;
        }

        await sendMessage(chatId, msg);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Analysis failed";
        await sendMessage(chatId, `❌ Error: ${errorMsg}`);
      }
      break;
    }

    case "/compare": {
      if (args.length < 2) {
        await sendMessage(chatId, "❌ Usage: `/compare <mint1> <mint2>`");
        return;
      }

      await sendTyping(chatId);

      try {
        const comparison = await compareTokens(args);
        let msg = `📊 *Token Comparison*\n\n`;

        for (const row of comparison.rows) {
          const values = row.values.map((v) => {
            const icon = v.severity === "bad" ? "🔴" : v.severity === "warning" ? "🟡" : "🟢";
            return `${icon}${v.value}`;
          });
          msg += `*${row.metric}:* ${values.join(" vs ")}\n`;
        }

        await sendMessage(chatId, msg);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Comparison failed";
        await sendMessage(chatId, `❌ Error: ${errorMsg}`);
      }
      break;
    }

    case "/batch": {
      if (args.length < 2) {
        await sendMessage(chatId, "❌ Usage: `/batch <mint1> <mint2> ...`");
        return;
      }

      await sendTyping(chatId);

      try {
        const summary = await batchScan(args);
        let msg = `📊 *Batch Scan Results*\n\n`;
        msg += `Scanned: ${summary.scanned}\n`;
        msg += `✅ Succeeded: ${summary.succeeded}\n`;
        msg += `❌ Failed: ${summary.failed}\n`;
        msg += `Avg Risk: ${summary.averageRisk}/100\n\n`;

        msg += `*Rankings:*\n`;
        for (const r of summary.results.slice(0, 10)) {
          const emoji = r.verdict === "clean" ? "🟢" : r.verdict === "caution" ? "🟡" : "🔴";
          msg += `${emoji} ${r.vitals.symbol}: ${r.riskScore}/100 · ${r.vitals.holders} holders\n`;
        }

        await sendMessage(chatId, msg);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Batch scan failed";
        await sendMessage(chatId, `❌ Error: ${errorMsg}`);
      }
      break;
    }

    case "/watch": {
      const input = args.join(" ");
      if (!input) {
        await sendMessage(chatId, "❌ Usage: `/watch <mint>`");
        return;
      }

      const mint = extractMint(input);
      if (!mint) {
        await sendMessage(chatId, "❌ Invalid mint address.");
        return;
      }

      alerts.addWatch({
        mint,
        watchVerdict: true,
        riskThreshold: 50,
        devExitThreshold: 3,
      });

      await sendMessage(
        chatId,
        `👀 Now watching \`${mint.slice(0, 8)}...\`\n\n` +
        `I'll alert you if:\n` +
        `• Risk score exceeds 50/100\n` +
        `• Verdict changes\n` +
        `• Dev wallet drops below 3%\n\n` +
        `Use /alerts to see recent alerts.`
      );
      break;
    }

    case "/alerts": {
      const recent = alerts.getRecentAlerts(5);
      if (recent.length === 0) {
        await sendMessage(chatId, "No recent alerts.");
        return;
      }

      let msg = `*📋 Recent Alerts (${recent.length})*\n\n`;
      for (const a of recent) {
        const emoji = a.severity === "critical" ? "🔴" : a.severity === "high" ? "🟠" : "🟡";
        msg += `${emoji} *${a.title}*\n${a.message}\n\n`;
      }

      await sendMessage(chatId, msg);
      break;
    }

    default:
      await sendMessage(chatId, `Unknown command: ${command}. Try /help`);
  }
}

async function main() {
  console.log("🤖 Pumpscan Telegram Bot started");
  console.log(`   Bot API: ${API_BASE.slice(0, 40)}...`);

  // Periodic alert checking
  setInterval(async () => {
    try {
      const events = await alerts.checkAll();
      if (events.length > 0) {
        console.log(`   Generated ${events.length} alert(s)`);
      }
    } catch (err) {
      console.error("   Alert check failed:", err);
    }
  }, 60_000); // Check every 60 seconds

  // Poll for updates
  while (true) {
    try {
      const updates = await getUpdates();
      for (const update of updates) {
        lastUpdateId = update.update_id;
        const msg = update.message;
        if (msg?.text && msg.chat?.id) {
          console.log(`   Message from ${msg.from?.username ?? "unknown"}: ${msg.text.slice(0, 50)}...`);
          await handleCommand(msg.chat.id, msg.text);
        }
      }
    } catch (err) {
      console.error("   Poll error:", err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

function formatUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
