/**
 * Batch Scanner — analyze multiple pump.fun tokens at once
 * and get a ranked comparison of risk profiles.
 *
 * Usage:
 *   import { batchScan } from "@/lib/batch-scanner";
 *   const results = await batchScan(["mint1", "mint2", "mint3"]);
 */

import { analyze } from "./analyze";
import type { AnalysisResult, Verdict } from "./types";

export interface BatchSummary {
  scanned: number;
  succeeded: number;
  failed: number;
  verdictCounts: Record<Verdict, number>;
  averageRisk: number;
  highestRisk: AnalysisResult | null;
  lowestRisk: AnalysisResult | null;
  results: AnalysisResult[];
  errors: Array<{ mint: string; error: string }>;
  generatedAt: number;
}

export async function batchScan(
  mints: string[],
  concurrency = 3
): Promise<BatchSummary> {
  const results: AnalysisResult[] = [];
  const errors: Array<{ mint: string; error: string }> = [];

  // Process in batches to avoid rate limits
  for (let i = 0; i < mints.length; i += concurrency) {
    const batch = mints.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((mint) => analyze(mint))
    );

    for (let j = 0; j < batch.length; j++) {
      const result = batchResults[j];
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        errors.push({
          mint: batch[j],
          error: result.reason instanceof Error ? result.reason.message : "Unknown error",
        });
      }
    }
  }

  const verdictCounts: Record<Verdict, number> = {
    clean: 0,
    caution: 0,
    avoid: 0,
  };

  let totalRisk = 0;
  let highestRisk: AnalysisResult | null = null;
  let lowestRisk: AnalysisResult | null = null;

  for (const r of results) {
    verdictCounts[r.verdict]++;
    totalRisk += r.riskScore;

    if (!highestRisk || r.riskScore > highestRisk.riskScore) {
      highestRisk = r;
    }
    if (!lowestRisk || r.riskScore < lowestRisk.riskScore) {
      lowestRisk = r;
    }
  }

  return {
    scanned: mints.length,
    succeeded: results.length,
    failed: errors.length,
    verdictCounts,
    averageRisk: results.length > 0 ? Math.round(totalRisk / results.length) : 0,
    highestRisk,
    lowestRisk,
    results: results.sort((a, b) => b.riskScore - a.riskScore),
    errors,
    generatedAt: Date.now(),
  };
}

/**
 * Format batch scan results as a readable table string
 */
export function formatBatchSummary(summary: BatchSummary): string {
  const lines: string[] = [];
  lines.push("╔══════════════════════════════════════════════╗");
  lines.push("║        Pumpscan Batch Scan Results          ║");
  lines.push("╚══════════════════════════════════════════════╝");
  lines.push("");
  lines.push(`  Scanned: ${summary.scanned} tokens`);
  lines.push(`  Succeeded: ${summary.succeeded}`);
  lines.push(`  Failed: ${summary.failed}`);
  lines.push(`  Average Risk: ${summary.averageRisk}/100`);
  lines.push("");
  lines.push(`  Verdicts:`);
  lines.push(`    🟢 Clean:  ${summary.verdictCounts.clean}`);
  lines.push(`    🟡 Caution: ${summary.verdictCounts.caution}`);
  lines.push(`    🔴 Avoid:  ${summary.verdictCounts.avoid}`);
  lines.push("");

  if (summary.highestRisk) {
    const h = summary.highestRisk;
    lines.push(`  🔴 Highest Risk: ${h.vitals.name} (${h.vitals.symbol}) — ${h.riskScore}/100`);
  }
  if (summary.lowestRisk) {
    const l = summary.lowestRisk;
    lines.push(`  🟢 Lowest Risk:  ${l.vitals.name} (${l.vitals.symbol}) — ${l.riskScore}/100`);
  }

  lines.push("");
  lines.push("  ── Ranked Results ──");
  lines.push("");

  for (const r of summary.results) {
    const emoji = r.verdict === "clean" ? "🟢" : r.verdict === "caution" ? "🟡" : "🔴";
    lines.push(
      `  ${emoji} ${r.riskScore.toString().padStart(3)}/100  ${r.vitals.symbol.padEnd(8)} ` +
      `${r.vitals.name.padEnd(20)} ${r.vitals.holders} holders · $${formatCompact(r.vitals.mcapUsd)}`
    );
  }

  if (summary.errors.length > 0) {
    lines.push("");
    lines.push("  ── Errors ──");
    for (const e of summary.errors) {
      lines.push(`    ❌ ${e.mint.slice(0, 16)}... — ${e.error}`);
    }
  }

  return lines.join("\n");
}

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}
