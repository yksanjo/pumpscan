#!/usr/bin/env tsx
/**
 * Build the public Pump.fun Real Collectors leaderboard JSON.
 *
 * Scans the configured mint list with pumpscan's findCollectors pipeline,
 * ranks survivors by pumpFunBags then history length, and writes the
 * payload to public/leaderboard.json so the /leaderboard page can serve
 * a static snapshot without re-scanning per request.
 *
 *   npx tsx scripts/build-leaderboard.ts
 *   npx tsx scripts/build-leaderboard.ts --mints=AAA...,BBB...   # override
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local (pumpscan's standard env file) before importing modules that
// read process.env at import-time. tsx doesn't auto-load env files the way
// Next.js does.
const envPath = resolve(__dirname, "..", ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (key && !process.env[key]) process.env[key] = value;
  }
}

import { findCollectors } from "../src/lib/collector-finder";
import type { CollectorRecord } from "../src/lib/types";

// Hardcoded list from yksanjo's thread of pump.fun graduates spanning
// $8M–$62M MC. Pending user-supplied mint addresses; UNKNOWN entries are
// skipped at scan time. Add the real addresses below or pass --mints=.
//
// To add a mint: replace the empty string. Symbol is for log clarity only.
const DEFAULT_GRADUATES: Array<{ symbol: string; mint: string }> = [
  { symbol: "NEURIX",   mint: "Hrpq2D2YHzaYMUNNAt37TnHyQKRv5CSjvGWWRViHpump" },
  { symbol: "SOAG",     mint: "ADue87cPcDhsyGq2hrDsukp7j8AFTSnaYHSanDATpump" },
  { symbol: "POPCAT",   mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr" },
  { symbol: "PNUT",     mint: "2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump" },
  { symbol: "MOODENG",  mint: "ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY" },
  { symbol: "BOME",     mint: "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82" },
  { symbol: "SPX",      mint: "J3NKxxXZcnNiMjKw9hYb2K4LUxgwB6t1FtPtQVsv3KFr" },
  { symbol: "GOAT",     mint: "CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump" },
  { symbol: "CHILLGUY", mint: "Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump" },
  { symbol: "ACT",      mint: "GJAFwWjJ3vnTsrQVabjBVK2TYB1YtRCQXRDfDgUnpump" },
  { symbol: "FWOG",     mint: "A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump" },
];

interface LeaderboardEntry {
  rank: number;
  wallet: string;
  tier: "ELITE" | "HIGH" | "MID" | "LOW" | "MIN";
  pumpFunBags: number;
  totalSwaps: number;
  firstSwapDaysAgo: number | null;
  lastSwapDaysAgo: number | null;
  appearances: Array<{ mint: string; pctSupply: number }>;
}

interface LeaderboardSnapshot {
  generatedAt: number;
  mintsScanned: string[];
  totals: {
    holdersInspected: number;
    walletsClassified: number;
    realCollectors: number;
  };
  tierCounts: Record<LeaderboardEntry["tier"], number>;
  entries: LeaderboardEntry[];
  methodology: {
    topHoldersPerToken: number;
    minHistoryDays: number;
    minTotalSwaps: number;
    minSwaps30d: number;
    repoUrl: string;
  };
}

function bagsTier(bags: number): LeaderboardEntry["tier"] {
  if (bags >= 50) return "ELITE";
  if (bags >= 20) return "HIGH";
  if (bags >= 10) return "MID";
  if (bags >= 3)  return "LOW";
  return "MIN";
}

async function main() {
  const flag = process.argv.find((a) => a.startsWith("--mints="));
  const overrideMints = flag
    ? flag.slice("--mints=".length).split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  const sources = overrideMints
    ? overrideMints.map((m) => ({ symbol: m.slice(0, 6), mint: m }))
    : DEFAULT_GRADUATES;

  const validMints = sources.filter((s) => s.mint && s.mint.length >= 32);
  const skipped = sources.filter((s) => !s.mint || s.mint.length < 32);

  if (validMints.length === 0) {
    console.error("✗ No valid mints to scan. Edit DEFAULT_GRADUATES or pass --mints=...");
    process.exit(1);
  }

  console.log(`Scanning ${validMints.length} mint(s):`);
  for (const s of validMints) console.log(`  • ${s.symbol.padEnd(10)} ${s.mint}`);
  if (skipped.length > 0) {
    console.log(`Skipping ${skipped.length} mint(s) with no address:`);
    for (const s of skipped) console.log(`  · ${s.symbol} (UNKNOWN)`);
  }
  console.log("");

  // Leaderboard uses a wider recency window (60d) than puzzle generation
  // (30d). The top holders of old pump.fun graduates are mostly dormant;
  // 60d lets in real collectors who held bags for months but didn't trade
  // every week. The minHistoryDays (60) + minTotalSwaps (20) checks still
  // filter out airdrop bots and brand-new wallets.
  // Leaderboard uses a wider recency window (120d) than puzzle generation
  // (30d). The top holders of old pump.fun graduates are mostly dormant;
  // 120d captures "real collectors" who held bags for months without
  // trading every week. Setting recencyDays=dormantDays=120 collapses the
  // intermediate "quiet" bucket so anyone idle ≤120d passes the filter.
  // minHistoryDays (60) + minTotalSwaps (20) still exclude airdrop bots
  // and brand-new wallets.
  const scan = await findCollectors(
    validMints.map((s) => s.mint),
    {
      holdersPerToken: 100,
      recencyDays: 180,
      classifier: {
        dormantDays: 180,    // anyone idle ≤180d passes recency
        minTotalSwaps: 10,   // 10 sample txs = not an airdrop bot, more inclusive than 20
      },
    }
  );

  const entries: LeaderboardEntry[] = scan.collectors.map(
    (c: CollectorRecord, i: number): LeaderboardEntry => ({
      rank:             i + 1,
      wallet:           c.wallet,
      tier:             bagsTier(c.pumpFunBags),
      pumpFunBags:      c.pumpFunBags,
      totalSwaps:       c.totalSwaps,
      firstSwapDaysAgo: c.firstSwapDaysAgo,
      lastSwapDaysAgo:  c.lastSwapDaysAgo,
      appearances:      c.appearances.map((a) => ({ mint: a.mint, pctSupply: a.pctSupply })),
    })
  );

  const tierCounts: LeaderboardSnapshot["tierCounts"] = {
    ELITE: 0, HIGH: 0, MID: 0, LOW: 0, MIN: 0,
  };
  for (const e of entries) tierCounts[e.tier]++;

  const snapshot: LeaderboardSnapshot = {
    generatedAt: Date.now(),
    mintsScanned: validMints.map((s) => s.mint),
    totals: scan.totals,
    tierCounts,
    entries,
    methodology: {
      topHoldersPerToken: 100,
      minHistoryDays: 60,
      minTotalSwaps: 20,
      minSwaps30d: 3,
      repoUrl: "https://github.com/yksanjo/pumpscan",
    },
  };

  const outPath = resolve(__dirname, "..", "public", "leaderboard.json");
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  console.log(`✓ Wrote ${entries.length} collectors to ${outPath}`);
  console.log(`  Tiers:  ELITE=${tierCounts.ELITE}  HIGH=${tierCounts.HIGH}  MID=${tierCounts.MID}  LOW=${tierCounts.LOW}  MIN=${tierCounts.MIN}`);
  console.log(`  Source: ${validMints.length} mints, ${scan.totals.holdersInspected} holders inspected, ${scan.totals.walletsClassified} classified`);
}

main().catch((err) => {
  console.error("✗ leaderboard build failed:", err);
  process.exit(1);
});
