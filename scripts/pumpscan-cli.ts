#!/usr/bin/env tsx
/**
 * Pumpscan CLI — analyze pump.fun tokens from the command line.
 *
 * Usage:
 *   npx tsx scripts/pumpscan-cli.ts analyze <mint-or-url>
 *   npx tsx scripts/pumpscan-cli.ts batch <mint1> <mint2> ...
 *   npx tsx scripts/pumpscan-cli.ts compare <mint1> <mint2>
 *   npx tsx scripts/pumpscan-cli.ts dev <wallet-address>
 *   npx tsx scripts/pumpscan-cli.ts watch <mint> [interval-sec]
 *
 * Examples:
 *   npx tsx scripts/pumpscan-cli.ts analyze 6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN
 *   npx tsx scripts/pumpscan-cli.ts batch mint1 mint2 mint3
 *   npx tsx scripts/pumpscan-cli.ts compare mint1 mint2
 *   npx tsx scripts/pumpscan-cli.ts dev GvyLS9WFxUBzoiVPKTJAR2bGLocnoEVWRYh4D8i5z7m1
 *   npx tsx scripts/pumpscan-cli.ts watch 6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN 60
 */

import { analyze } from "../src/lib/analyze";
import { batchScan, formatBatchSummary } from "../src/lib/batch-scanner";
import { compareTokens, formatComparisonTable } from "../src/lib/token-comparator";
import { analyzeDevWallet, formatDevProfile } from "../src/lib/dev-wallet-tracker";
import { extractMint } from "../src/lib/parse-input";
import { findCollectors, formatCollectorScan } from "../src/lib/collector-finder";
import { planAirdropForScan, planAirdrop, formatAirdropPlan } from "../src/lib/airdrop-planner";
import { readFileSync } from "node:fs";

const [command, ...args] = process.argv.slice(2);

async function main() {
  switch (command) {
    case "analyze":
      await cmdAnalyze(args[0]);
      break;
    case "batch":
      await cmdBatch(args);
      break;
    case "compare":
      await cmdCompare(args);
      break;
    case "dev":
      await cmdDev(args[0]);
      break;
    case "watch":
      await cmdWatch(args[0], parseInt(args[1] || "30", 10));
      break;
    case "collectors":
      await cmdCollectors(args);
      break;
    case "airdrop":
      await cmdAirdrop(args);
      break;
    default:
      showHelp();
  }
}

async function cmdCollectors(rawArgs: string[]) {
  const { flags, positional } = parseFlags(rawArgs);
  if (positional.length === 0) {
    console.error("❌ Usage: pumpscan collectors <mint1> <mint2> ... [--top=25] [--recency=30] [--airdrop=AMOUNT] [--token=SOAG_MINT]");
    process.exit(1);
  }

  const mints = positional.map((m) => extractMint(m) ?? m).filter(Boolean) as string[];
  const top = parseInt(flags.top ?? "25", 10);
  const recency = parseInt(flags.recency ?? "30", 10);

  console.log(`🔍 Scanning ${mints.length} graduates for real collectors...\n`);
  const scan = await findCollectors(mints, {
    holdersPerToken: top,
    recencyDays: recency,
  });
  console.log(formatCollectorScan(scan));

  if (flags.airdrop && flags.token) {
    const amount = Number(flags.airdrop);
    const topN = parseInt(flags["airdrop-top"] ?? "10", 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      console.error(`\n❌ Invalid --airdrop amount: ${flags.airdrop}`);
      process.exit(1);
    }
    const plan = planAirdropForScan(scan, {
      mint: flags.token,
      topN,
      amountPerWallet: amount,
    });
    console.log("");
    console.log(formatAirdropPlan(plan));
    console.log("");
    console.log("  CSV:");
    console.log("  ----");
    process.stdout.write(plan.csv);
  }
}

async function cmdAirdrop(rawArgs: string[]) {
  const { flags, positional } = parseFlags(rawArgs);
  const [csvPath, mintArg, amountArg] = positional;
  if (!csvPath || !mintArg || !amountArg) {
    console.error("❌ Usage: pumpscan airdrop <wallets.csv> <mint> <amount-per-wallet> [--execute]");
    console.error("   CSV format: one wallet per line, or `wallet,amount` (amount overrides default).");
    process.exit(1);
  }
  const amount = Number(amountArg);
  if (!Number.isFinite(amount) || amount <= 0) {
    console.error(`❌ Invalid amount: ${amountArg}`);
    process.exit(1);
  }

  const raw = readFileSync(csvPath, "utf8");
  const recipients = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.toLowerCase().startsWith("wallet,"))
    .map((line) => {
      const [wallet, amountStr] = line.split(",").map((s) => s.trim());
      const rowAmount = amountStr ? Number(amountStr) : undefined;
      return { wallet, amount: rowAmount && Number.isFinite(rowAmount) ? rowAmount : undefined };
    });

  const plan = planAirdrop({
    mint: mintArg,
    recipients,
    defaultAmount: amount,
    dryRun: flags.execute === undefined,
  });
  console.log(formatAirdropPlan(plan));
}

function parseFlags(args: string[]): { flags: Record<string, string>; positional: string[] } {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else {
        flags[body] = "true";
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

async function cmdAnalyze(input: string | undefined) {
  if (!input) {
    console.error("❌ Usage: pumpscan analyze <mint-or-url>");
    process.exit(1);
  }

  const mint = extractMint(input);
  if (!mint) {
    console.error("❌ Could not extract a valid mint address from:", input);
    process.exit(1);
  }

  console.log(`🔍 Analyzing ${mint}...\n`);
  const result = await analyze(mint);

  const emoji = result.verdict === "clean" ? "🟢" : result.verdict === "caution" ? "🟡" : "🔴";
  console.log(`╔══════════════════════════════════════════════╗`);
  console.log(`║           Pumpscan Analysis Result          ║`);
  console.log(`╚══════════════════════════════════════════════╝`);
  console.log(``);
  console.log(`  ${emoji}  ${result.vitals.name} (${result.vitals.symbol})`);
  console.log(`     Verdict: ${result.verdict.toUpperCase()}`);
  console.log(`     Risk:    ${result.riskScore}/100`);
  console.log(`     Confidence: ${Math.round(result.confidence * 100)}%`);
  console.log(``);
  console.log(`  📊 Vitals`);
  console.log(`     MCap:    ${formatUsd(result.vitals.mcapUsd)}`);
  console.log(`     Holders: ${result.vitals.holders.toLocaleString()}`);
  console.log(`     Volume:  ${formatUsd(result.vitals.volume24hUsd)} (24h)`);
  console.log(`     Age:     ${result.vitals.ageHours < 24 ? `${result.vitals.ageHours}h` : `${Math.round(result.vitals.ageHours / 24)}d`}`);
  console.log(`     Dev:     ${result.vitals.devWallet ? `${result.vitals.devWallet.slice(0, 8)}...` : "Unknown"} (holds ${result.vitals.devWalletPctHeld}%)`);
  console.log(``);
  console.log(`  📈 Concentration`);
  console.log(`     Top 10:  ${result.concentration.top10Pct}%`);
  console.log(`     Top 25:  ${result.concentration.top25Pct}%`);
  console.log(`     Top 100: ${result.concentration.top100Pct}%`);
  console.log(`     Gini:    ${result.concentration.gini.toFixed(2)}`);
  console.log(``);

  if (result.bundles.length > 0) {
    console.log(`  🚩 Bundles Detected (${result.bundles.length})`);
    for (const b of result.bundles) {
      console.log(`     • ${b.members.length} wallets · ${b.pctSupply}% of supply · funded within ${b.fundedWithinSec}s`);
      console.log(`       Funder: ${b.funder.slice(0, 8)}...`);
    }
    console.log(``);
  }

  if (result.findings.length > 0) {
    console.log(`  🔍 Findings (${result.findings.length})`);
    for (const f of result.findings) {
      const sev = f.severity === "critical" ? "🔴" : f.severity === "high" ? "🟠" : f.severity === "medium" ? "🟡" : "🟢";
      console.log(`     ${sev} [${f.severity.toUpperCase()}] ${f.title}`);
    }
    console.log(``);
  }

  if (result.narration) {
    console.log(`  💬 ${result.narration}`);
    console.log(``);
  }
}

async function cmdBatch(mints: string[]) {
  if (mints.length === 0) {
    console.error("❌ Usage: pumpscan batch <mint1> <mint2> ...");
    process.exit(1);
  }

  console.log(`🔍 Scanning ${mints.length} tokens...\n`);
  const summary = await batchScan(mints);
  console.log(formatBatchSummary(summary));
}

async function cmdCompare(mints: string[]) {
  if (mints.length < 2) {
    console.error("❌ Usage: pumpscan compare <mint1> <mint2> [mint3 ...]");
    process.exit(1);
  }

  console.log(`🔍 Comparing ${mints.length} tokens...\n`);
  const comparison = await compareTokens(mints);
  console.log(formatComparisonTable(comparison));
}

async function cmdDev(wallet: string | undefined) {
  if (!wallet) {
    console.error("❌ Usage: pumpscan dev <wallet-address>");
    process.exit(1);
  }

  console.log(`🔍 Analyzing dev wallet ${wallet}...\n`);
  const profile = await analyzeDevWallet(wallet);
  console.log(formatDevProfile(profile));
}

async function cmdWatch(mint: string | undefined, intervalSec: number) {
  if (!mint) {
    console.error("❌ Usage: pumpscan watch <mint> [interval-sec]");
    process.exit(1);
  }

  const resolvedMint = extractMint(mint);
  if (!resolvedMint) {
    console.error("❌ Invalid mint:", mint);
    process.exit(1);
  }

  console.log(`👀 Watching ${resolvedMint} (polling every ${intervalSec}s)`);
  console.log(`   Press Ctrl+C to stop\n`);

  let previousRisk = -1;

  const poll = async () => {
    try {
      const result = await analyze(resolvedMint);
      const now = new Date().toLocaleTimeString();
      const change = previousRisk >= 0
        ? result.riskScore - previousRisk
        : 0;
      const changeStr = change !== 0
        ? (change > 0 ? ` ↑+${change}` : ` ↓${change}`)
        : "";

      console.log(
        `[${now}] ${result.vitals.symbol.padEnd(8)} ` +
        `${result.verdict.toUpperCase().padEnd(8)} ` +
        `risk ${result.riskScore}/100${changeStr} · ` +
        `${result.vitals.holders} holders · ` +
        `${formatUsd(result.vitals.mcapUsd)}`
      );

      previousRisk = result.riskScore;
    } catch (err) {
      const now = new Date().toLocaleTimeString();
      console.error(`[${now}] ❌ Error: ${err instanceof Error ? err.message : "Unknown"}`);
    }
  };

  await poll();
  setInterval(poll, intervalSec * 1000);
}

function showHelp() {
  console.log(`
╔══════════════════════════════════════════════╗
║           Pumpscan CLI — Help               ║
╚══════════════════════════════════════════════╝

Usage:
  pumpscan analyze <mint-or-url>     Analyze a single token
  pumpscan batch <mint1> <mint2>...  Batch scan multiple tokens
  pumpscan compare <a> <b> [c...]    Side-by-side comparison
  pumpscan dev <wallet>              Analyze a dev wallet's tokens
  pumpscan watch <mint> [sec]        Watch a token for changes
  pumpscan collectors <mints...>     Find real collectors across graduates
  pumpscan airdrop <csv> <mint> <n>  Dry-run an airdrop plan from a wallet CSV

Examples:
  pumpscan analyze 6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN
  pumpscan batch mint1 mint2 mint3
  pumpscan compare mint1 mint2
  pumpscan dev GvyLS9WFxUBzoiVPKTJAR2bGLocnoEVWRYh4D8i5z7m1
  pumpscan watch 6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN 60
  pumpscan collectors mint1 mint2 mint3 --top=25 --recency=30
  pumpscan collectors mint1 mint2 --token=ADue87cP...pump --airdrop=1000 --airdrop-top=10
  pumpscan airdrop ./recipients.csv ADue87cP...pump 1000
`);
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
