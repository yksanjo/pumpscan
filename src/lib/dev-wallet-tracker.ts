/**
 * Dev Wallet Tracker — given a dev wallet address, find all tokens
 * they've deployed on pump.fun and analyze the risk profile.
 *
 * This uses Helius enhanced transactions to discover token mints
 * associated with a wallet, then runs the full analysis on each.
 */

import { analyze } from "./analyze";
import type { AnalysisResult } from "./types";

export interface DevToken {
  mint: string;
  name: string;
  symbol: string;
  riskScore: number;
  verdict: "clean" | "caution" | "avoid";
  holders: number;
  mcapUsd: number;
  devHoldsPct: number;
  ageHours: number;
  graduated: boolean;
}

export interface DevProfile {
  wallet: string;
  totalTokens: number;
  analyzedTokens: number;
  averageRisk: number;
  tokens: DevToken[];
  redFlags: string[];
  generatedAt: number;
}

/**
 * Fetch all token mints created by a dev wallet using Helius
 */
async function fetchDevMints(wallet: string): Promise<string[]> {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error("HELIUS_API_KEY not set");

  const url = `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${key}&limit=100&type=TOKEN_MINT`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch dev transactions: ${res.status}`);

  const txs = await res.json() as Array<{
    signature: string;
    timestamp: number;
    tokenTransfers?: Array<{ mint: string }>;
    feePayer?: string;
  }>;

  // Extract unique mints from token creation transactions
  const mints = new Set<string>();
  for (const tx of txs) {
    if (tx.tokenTransfers) {
      for (const t of tx.tokenTransfers) {
        if (t.mint) mints.add(t.mint);
      }
    }
  }

  return Array.from(mints);
}

/**
 * Build a profile of a dev wallet by analyzing all their tokens
 */
export async function analyzeDevWallet(
  wallet: string,
  maxTokens = 20
): Promise<DevProfile> {
  const mints = await fetchDevMints(wallet);
  const tokens: DevToken[] = [];
  const redFlags: string[] = [];

  const toAnalyze = mints.slice(0, maxTokens);

  for (const mint of toAnalyze) {
    try {
      const result = await analyze(mint);
      tokens.push({
        mint: result.mint,
        name: result.vitals.name,
        symbol: result.vitals.symbol,
        riskScore: result.riskScore,
        verdict: result.verdict,
        holders: result.vitals.holders,
        mcapUsd: result.vitals.mcapUsd,
        devHoldsPct: result.vitals.devWalletPctHeld,
        ageHours: result.vitals.ageHours,
        graduated: result.vitals.graduated,
      });

      // Collect red flags
      if (result.vitals.devWalletPctHeld > 5) {
        redFlags.push(
          `${result.vitals.symbol}: Dev still holds ${result.vitals.devWalletPctHeld}%`
        );
      }
      if (result.verdict === "avoid") {
        redFlags.push(`${result.vitals.symbol}: High risk (${result.riskScore}/100)`);
      }
      if (result.bundles.length > 0) {
        redFlags.push(
          `${result.vitals.symbol}: ${result.bundles.length} bundle(s) detected`
        );
      }
    } catch {
      // Skip tokens that fail analysis
    }
  }

  const totalRisk = tokens.reduce((sum, t) => sum + t.riskScore, 0);

  return {
    wallet,
    totalTokens: mints.length,
    analyzedTokens: tokens.length,
    averageRisk: tokens.length > 0 ? Math.round(totalRisk / tokens.length) : 0,
    tokens: tokens.sort((a, b) => b.riskScore - a.riskScore),
    redFlags: [...new Set(redFlags)],
    generatedAt: Date.now(),
  };
}

/**
 * Format dev profile as a readable report
 */
export function formatDevProfile(profile: DevProfile): string {
  const lines: string[] = [];
  lines.push("╔══════════════════════════════════════════════╗");
  lines.push("║        Dev Wallet Analysis Report           ║");
  lines.push("╚══════════════════════════════════════════════╝");
  lines.push("");
  lines.push(`  Wallet: ${profile.wallet}`);
  lines.push(`  Total tokens deployed: ${profile.totalTokens}`);
  lines.push(`  Analyzed: ${profile.analyzedTokens}`);
  lines.push(`  Average risk score: ${profile.averageRisk}/100`);
  lines.push("");

  if (profile.redFlags.length > 0) {
    lines.push("  🚩 Red Flags:");
    for (const flag of profile.redFlags) {
      lines.push(`    ⚠️  ${flag}`);
    }
    lines.push("");
  }

  lines.push("  ── Token Portfolio ──");
  lines.push("");

  for (const t of profile.tokens) {
    const emoji = t.verdict === "clean" ? "🟢" : t.verdict === "caution" ? "🟡" : "🔴";
    lines.push(
      `  ${emoji} ${t.riskScore.toString().padStart(3)}/100  ${t.symbol.padEnd(8)} ` +
      `${t.name.padEnd(20)} ${t.holders.toString().padStart(5)} holders · ` +
      `dev ${t.devHoldsPct}% · ${t.ageHours}h old`
    );
  }

  return lines.join("\n");
}
