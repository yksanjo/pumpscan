/**
 * Token Comparator — side-by-side comparison of multiple pump.fun tokens.
 * Shows risk metrics, concentration, bundles, and vitals in a unified view.
 */

import { analyze } from "./analyze";
import type { AnalysisResult } from "./types";

export interface ComparisonRow {
  metric: string;
  values: Array<{ mint: string; value: string; severity?: "good" | "warning" | "bad" }>;
}

export interface TokenComparison {
  tokens: AnalysisResult[];
  rows: ComparisonRow[];
  generatedAt: number;
}

/**
 * Compare multiple tokens side by side
 */
export async function compareTokens(mints: string[]): Promise<TokenComparison> {
  const tokens = await Promise.all(
    mints.map((mint) => analyze(mint))
  );

  const rows: ComparisonRow[] = [
    {
      metric: "Verdict",
      values: tokens.map((t) => ({
        mint: t.mint,
        value: t.verdict.toUpperCase(),
        severity: t.verdict === "avoid" ? "bad" : t.verdict === "caution" ? "warning" : "good",
      })),
    },
    {
      metric: "Risk Score",
      values: tokens.map((t) => ({
        mint: t.mint,
        value: `${t.riskScore}/100`,
        severity: t.riskScore >= 60 ? "bad" : t.riskScore >= 30 ? "warning" : "good",
      })),
    },
    {
      metric: "Confidence",
      values: tokens.map((t) => ({
        mint: t.mint,
        value: `${Math.round(t.confidence * 100)}%`,
      })),
    },
    {
      metric: "Market Cap",
      values: tokens.map((t) => ({
        mint: t.mint,
        value: formatUsd(t.vitals.mcapUsd),
      })),
    },
    {
      metric: "Holders",
      values: tokens.map((t) => ({
        mint: t.mint,
        value: t.vitals.holders.toLocaleString(),
        severity: t.vitals.holders < 100 ? "bad" : t.vitals.holders < 500 ? "warning" : "good",
      })),
    },
    {
      metric: "Age",
      values: tokens.map((t) => ({
        mint: t.mint,
        value: t.vitals.ageHours < 24 ? `${t.vitals.ageHours}h` : `${Math.round(t.vitals.ageHours / 24)}d`,
        severity: t.vitals.ageHours < 1 ? "warning" : "good",
      })),
    },
    {
      metric: "24h Volume",
      values: tokens.map((t) => ({
        mint: t.mint,
        value: formatUsd(t.vitals.volume24hUsd),
      })),
    },
    {
      metric: "Top 10 Hold %",
      values: tokens.map((t) => ({
        mint: t.mint,
        value: `${t.concentration.top10Pct}%`,
        severity: t.concentration.top10Pct > 50 ? "bad" : t.concentration.top10Pct > 35 ? "warning" : "good",
      })),
    },
    {
      metric: "Gini Coefficient",
      values: tokens.map((t) => ({
        mint: t.mint,
        value: t.concentration.gini.toFixed(2),
        severity: t.concentration.gini > 0.9 ? "warning" : "good",
      })),
    },
    {
      metric: "Bundles Detected",
      values: tokens.map((t) => ({
        mint: t.mint,
        value: String(t.bundles.length),
        severity: t.bundles.length > 0 ? "bad" : "good",
      })),
    },
    {
      metric: "Dev Wallet Holds",
      values: tokens.map((t) => ({
        mint: t.mint,
        value: `${t.vitals.devWalletPctHeld}%`,
        severity: t.vitals.devWalletPctHeld > 10 ? "bad" : t.vitals.devWalletPctHeld > 5 ? "warning" : "good",
      })),
    },
    {
      metric: "Findings Count",
      values: tokens.map((t) => ({
        mint: t.mint,
        value: String(t.findings.length),
        severity: t.findings.length > 3 ? "bad" : t.findings.length > 1 ? "warning" : "good",
      })),
    },
  ];

  return { tokens, rows, generatedAt: Date.now() };
}

/**
 * Format comparison as a markdown table
 */
export function formatComparisonTable(comparison: TokenComparison): string {
  const headers = ["Metric", ...comparison.tokens.map((t) => t.vitals.symbol)];
  const separator = ["---", ...comparison.tokens.map(() => "---")];

  const lines: string[] = [];
  lines.push(`# Token Comparison — ${comparison.tokens.map((t) => t.vitals.symbol).join(" vs ")}`);
  lines.push("");
  lines.push(`Generated: ${new Date(comparison.generatedAt).toISOString()}`);
  lines.push("");

  // Header row
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`| ${separator.join(" | ")} |`);

  // Data rows
  for (const row of comparison.rows) {
    const metric = row.metric;
    const values = row.values.map((v) => {
      const icon = v.severity === "bad" ? "🔴 " : v.severity === "warning" ? "🟡 " : "🟢 ";
      return `${icon}${v.value}`;
    });
    lines.push(`| ${metric} | ${values.join(" | ")} |`);
  }

  lines.push("");
  lines.push("### Token Details");
  lines.push("");

  for (const t of comparison.tokens) {
    const emoji = t.verdict === "clean" ? "🟢" : t.verdict === "caution" ? "🟡" : "🔴";
    lines.push(`#### ${emoji} ${t.vitals.name} (${t.vitals.symbol})`);
    lines.push(`- **Mint**: \`${t.mint}\``);
    lines.push(`- **Risk**: ${t.riskScore}/100 · **Confidence**: ${Math.round(t.confidence * 100)}%`);
    lines.push(`- **MCap**: ${formatUsd(t.vitals.mcapUsd)} · **Holders**: ${t.vitals.holders}`);
    lines.push(`- **Dev**: ${t.vitals.devWallet ? `\`${t.vitals.devWallet.slice(0, 8)}...\` holds ${t.vitals.devWalletPctHeld}%` : "Unknown"}`);
    if (t.narration) {
      lines.push(`- **Narration**: ${t.narration}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
