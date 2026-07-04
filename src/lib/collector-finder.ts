/**
 * Collector finder — given a set of pump.fun graduates, returns the real
 * collectors among their pooled top holders.
 *
 * Pipeline mirrors the tweet:
 *   1. Pull top-N holders from each graduate
 *   2. Dedupe wallets across mints
 *   3. Pull each wallet's swap history (concurrent, with rate-limit slack)
 *   4. Classify into dormant / quiet / lightly_active / active
 *   5. Apply the real-collector filter (60+d history, 20+ swaps, recent)
 *   6. Rank survivors by pump.fun bags held, then by history length
 */

import { fetchTopHolders, fetchWalletSwapHistory } from "./helius";
import { classifyWallet, DEFAULT_CONFIG, type ClassifierConfig } from "./collector-classifier";
import { cacheGet, cacheSet } from "./cache";
import type {
  ActivityTier,
  CollectorMintAppearance,
  CollectorRecord,
  CollectorScan,
  TopHolder,
  WalletSwapHistory,
} from "./types";

export interface CollectorScanOptions {
  holdersPerToken?: number;  // top-N per graduate, default 25
  recencyDays?: number;      // override classifier recency window
  walletConcurrency?: number; // parallel swap-history fetches, default 4
  maxSwapsPerWallet?: number; // cap per-wallet samples, default 200
  classifier?: Partial<ClassifierConfig>;
}

export async function findCollectors(
  mints: string[],
  opts: CollectorScanOptions = {}
): Promise<CollectorScan> {
  const holdersPerToken = opts.holdersPerToken ?? 25;
  const recencyDays = opts.recencyDays ?? DEFAULT_CONFIG.recencyDays;
  const walletConcurrency = opts.walletConcurrency ?? 4;
  const maxSwapsPerWallet = opts.maxSwapsPerWallet ?? 200;
  const cfg: ClassifierConfig = { ...DEFAULT_CONFIG, ...opts.classifier, recencyDays };

  const cacheKey = `collectors:${mints.slice().sort().join(",")}:${holdersPerToken}:${recencyDays}`;
  const cached = cacheGet<CollectorScan>(cacheKey);
  if (cached) return cached;

  const errors: CollectorScan["errors"] = [];

  const holdersByMint = await pullHoldersConcurrently(mints, holdersPerToken, errors);

  const appearances = new Map<string, CollectorMintAppearance[]>();
  for (const [mint, holders] of holdersByMint.entries()) {
    for (const h of holders) {
      const list = appearances.get(h.address) ?? [];
      list.push({ mint, pctSupply: h.pctSupply, amount: h.amount });
      appearances.set(h.address, list);
    }
  }

  const wallets = Array.from(appearances.keys());
  const histories = await pullHistoriesConcurrently(
    wallets,
    { maxSwaps: maxSwapsPerWallet, lookbackDays: 365 },
    walletConcurrency,
    errors
  );

  const tierCounts: Record<ActivityTier, number> = {
    dormant: 0,
    quiet: 0,
    lightly_active: 0,
    active: 0,
  };

  const collectors: CollectorRecord[] = [];
  for (const history of histories) {
    const classified = classifyWallet(history, cfg);
    tierCounts[classified.tier]++;
    if (!classified.isRealCollector) continue;
    collectors.push({
      ...classified,
      appearances: appearances.get(history.wallet) ?? [],
    });
  }

  collectors.sort((a, b) => {
    if (b.pumpFunBags !== a.pumpFunBags) return b.pumpFunBags - a.pumpFunBags;
    const aDays = a.firstSwapDaysAgo ?? 0;
    const bDays = b.firstSwapDaysAgo ?? 0;
    return bDays - aDays;
  });

  const holdersInspected = Array.from(holdersByMint.values()).reduce((acc, h) => acc + h.length, 0);

  const scan: CollectorScan = {
    generatedAt: Date.now(),
    mintsScanned: mints,
    holdersPerToken,
    recencyDays,
    totals: {
      holdersInspected,
      walletsClassified: histories.length,
      realCollectors: collectors.length,
    },
    tierCounts,
    collectors,
    errors,
  };

  cacheSet(cacheKey, scan);
  return scan;
}

async function pullHoldersConcurrently(
  mints: string[],
  holdersPerToken: number,
  errors: CollectorScan["errors"],
  concurrency = 3
): Promise<Map<string, TopHolder[]>> {
  const out = new Map<string, TopHolder[]>();
  for (let i = 0; i < mints.length; i += concurrency) {
    const batch = mints.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((mint) => fetchTopHolders(mint, holdersPerToken))
    );
    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled") {
        out.set(batch[j], r.value);
      } else {
        errors.push({
          stage: "holders",
          mint: batch[j],
          error: r.reason instanceof Error ? r.reason.message : "unknown",
        });
      }
    }
  }
  return out;
}

async function pullHistoriesConcurrently(
  wallets: string[],
  opts: { maxSwaps: number; lookbackDays: number },
  concurrency: number,
  errors: CollectorScan["errors"]
): Promise<WalletSwapHistory[]> {
  const out: WalletSwapHistory[] = [];
  for (let i = 0; i < wallets.length; i += concurrency) {
    const batch = wallets.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((wallet) => fetchWalletSwapHistory(wallet, opts))
    );
    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled") {
        out.push(r.value);
      } else {
        errors.push({
          stage: "swaps",
          wallet: batch[j],
          error: r.reason instanceof Error ? r.reason.message : "unknown",
        });
      }
    }
  }
  return out;
}

export function formatCollectorScan(scan: CollectorScan): string {
  const lines: string[] = [];
  lines.push("╔══════════════════════════════════════════════╗");
  lines.push("║         Pumpscan Collector Finder           ║");
  lines.push("╚══════════════════════════════════════════════╝");
  lines.push("");
  lines.push(`  Scanned graduates:   ${scan.mintsScanned.length}`);
  lines.push(`  Top holders / token: ${scan.holdersPerToken}`);
  lines.push(`  Holders inspected:   ${scan.totals.holdersInspected}`);
  lines.push(`  Wallets classified:  ${scan.totals.walletsClassified}`);
  lines.push(`  ➜ Real collectors:   ${scan.totals.realCollectors}`);
  lines.push("");
  lines.push("  Tier breakdown:");
  lines.push(`    😴 Dormant:        ${scan.tierCounts.dormant}`);
  lines.push(`    🌙 Quiet:          ${scan.tierCounts.quiet}`);
  lines.push(`    🌤  Lightly Active: ${scan.tierCounts.lightly_active}`);
  lines.push(`    ⚡ Active:         ${scan.tierCounts.active}`);
  lines.push("");

  if (scan.collectors.length === 0) {
    lines.push("  No real collectors survived the filter.");
    return lines.join("\n");
  }

  lines.push("  ── Real Collectors (ranked) ──");
  lines.push("");
  for (let i = 0; i < scan.collectors.length; i++) {
    const c = scan.collectors[i];
    lines.push(
      `  ${String(i + 1).padStart(2)}. ${c.wallet.slice(0, 6)}…${c.wallet.slice(-4)}  ` +
      `${c.pumpFunBags} bags · ${c.totalSwaps} swaps · ` +
      `${c.firstSwapDaysAgo}d history · last active ${c.lastSwapDaysAgo}d ago`
    );
  }

  if (scan.errors.length > 0) {
    lines.push("");
    lines.push(`  ── Errors (${scan.errors.length}) ──`);
    for (const e of scan.errors.slice(0, 5)) {
      const target = e.mint ?? e.wallet ?? "?";
      lines.push(`    ❌ [${e.stage}] ${target.slice(0, 12)}… — ${e.error}`);
    }
  }

  return lines.join("\n");
}
