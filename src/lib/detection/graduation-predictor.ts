/**
 * Graduation Predictor — predicts whether a pump.fun token will
 * successfully graduate to Raydium or die on the bonding curve.
 *
 * pump.fun tokens need to fill their bonding curve to graduate.
 * This analyzes on-chain signals to predict the outcome.
 *
 * Key signals:
 *   - Bonding curve fill rate (speed of buying pressure)
 *   - Holder distribution (are snipers dumping?)
 *   - Dev wallet behavior (is dev buying back?)
 *   - Social signals (name/symbol patterns)
 *   - Volume consistency (organic vs bot-driven)
 */

import type { AnalysisResult, TokenVitals, ConcentrationStats, BundleCluster, RiskFinding } from "../types";

export interface GraduationPrediction {
  /** Probability of graduating (0-100) */
  probability: number;
  /** Estimated time to graduation in hours (or null if unlikely) */
  estimatedHours: number | null;
  /** Key factors influencing the prediction */
  factors: Array<{
    signal: string;
    impact: "positive" | "negative" | "neutral";
    detail: string;
  }>;
  /** Verdict on whether this will graduate */
  verdict: "likely" | "possible" | "unlikely";
}

/**
 * Predict graduation probability for a token
 */
export function predictGraduation(
  vitals: TokenVitals,
  concentration: ConcentrationStats,
  bundles: BundleCluster[],
  findings: RiskFinding[]
): GraduationPrediction {
  const factors: GraduationPrediction["factors"] = [];
  let score = 50; // Start at neutral

  // --- Factor 1: Holder count ---
  if (vitals.holders >= 500) {
    score += 15;
    factors.push({
      signal: "Holder count",
      impact: "positive",
      detail: `${vitals.holders} holders — strong distribution, less likely to dump`,
    });
  } else if (vitals.holders >= 200) {
    score += 8;
    factors.push({
      signal: "Holder count",
      impact: "positive",
      detail: `${vitals.holders} holders — moderate distribution`,
    });
  } else if (vitals.holders < 50) {
    score -= 20;
    factors.push({
      signal: "Holder count",
      impact: "negative",
      detail: `Only ${vitals.holders} holders — extremely concentrated, high dump risk`,
    });
  } else {
    score -= 5;
    factors.push({
      signal: "Holder count",
      impact: "negative",
      detail: `${vitals.holders} holders — below ideal distribution threshold`,
    });
  }

  // --- Factor 2: Top-10 concentration ---
  if (concentration.top10Pct > 60) {
    score -= 20;
    factors.push({
      signal: "Top-10 concentration",
      impact: "negative",
      detail: `Top 10 hold ${concentration.top10Pct}% — a few wallets can crash the curve`,
    });
  } else if (concentration.top10Pct > 40) {
    score -= 10;
    factors.push({
      signal: "Top-10 concentration",
      impact: "negative",
      detail: `Top 10 hold ${concentration.top10Pct}% — moderate concentration risk`,
    });
  } else if (concentration.top10Pct < 20) {
    score += 10;
    factors.push({
      signal: "Top-10 concentration",
      impact: "positive",
      detail: `Top 10 hold only ${concentration.top10Pct}% — healthy distribution`,
    });
  }

  // --- Factor 3: Bundles/snipers ---
  if (bundles.length > 0) {
    const totalBundledPct = bundles.reduce((s, b) => s + b.pctSupply, 0);
    if (totalBundledPct > 30) {
      score -= 25;
      factors.push({
        signal: "Bundle concentration",
        impact: "negative",
        detail: `${bundles.length} bundle(s) control ${totalBundledPct}% — coordinated wallets will likely dump`,
      });
    } else if (totalBundledPct > 15) {
      score -= 15;
      factors.push({
        signal: "Bundle concentration",
        impact: "negative",
        detail: `${bundles.length} bundle(s) control ${totalBundledPct}% — significant coordinated holding`,
      });
    } else {
      score -= 5;
      factors.push({
        signal: "Bundle concentration",
        impact: "negative",
        detail: `${bundles.length} bundle(s) detected (${totalBundledPct}%)`,
      });
    }
  } else {
    score += 10;
    factors.push({
      signal: "No bundles",
      impact: "positive",
      detail: "No coordinated buying detected — organic distribution",
    });
  }

  // --- Factor 4: Dev wallet behavior ---
  if (vitals.devWalletPctHeld > 15) {
    score -= 20;
    factors.push({
      signal: "Dev wallet",
      impact: "negative",
      detail: `Dev still holds ${vitals.devWalletPctHeld}% — high risk of dev dump before graduation`,
    });
  } else if (vitals.devWalletPctHeld > 5) {
    score -= 8;
    factors.push({
      signal: "Dev wallet",
      impact: "negative",
      detail: `Dev holds ${vitals.devWalletPctHeld}% — moderate dev concentration`,
    });
  } else if (vitals.devWalletPctHeld <= 2 && vitals.devWalletPctHeld > 0) {
    score += 8;
    factors.push({
      signal: "Dev wallet",
      impact: "positive",
      detail: `Dev holds only ${vitals.devWalletPctHeld}% — minimal dev risk`,
    });
  }

  // --- Factor 5: Age and momentum ---
  if (vitals.ageHours < 1) {
    score += 5; // Early days, momentum could build
    factors.push({
      signal: "Token age",
      impact: "neutral",
      detail: `Only ${vitals.ageHours}h old — still in early discovery phase`,
    });
  } else if (vitals.ageHours > 48 && vitals.holders < 100) {
    score -= 15;
    factors.push({
      signal: "Stagnation",
      impact: "negative",
      detail: `${Math.round(vitals.ageHours / 24)}d old with only ${vitals.holders} holders — failed to gain traction`,
    });
  }

  // --- Factor 6: Market cap ---
  if (vitals.mcapUsd >= 500_000) {
    score += 10;
    factors.push({
      signal: "Market cap",
      impact: "positive",
      detail: `${formatUsd(vitals.mcapUsd)} market cap — significant value locked`,
    });
  } else if (vitals.mcapUsd < 10_000 && vitals.holders < 30) {
    score -= 10;
    factors.push({
      signal: "Market cap",
      impact: "negative",
      detail: `Tiny market cap (${formatUsd(vitals.mcapUsd)}) with few holders — likely dead`,
    });
  }

  // --- Factor 7: Risk findings ---
  const criticalFindings = findings.filter(
    (f) => f.severity === "critical" || f.severity === "high"
  ).length;
  if (criticalFindings >= 3) {
    score -= 15;
    factors.push({
      signal: "Risk findings",
      impact: "negative",
      detail: `${criticalFindings} high/critical risk findings — multiple red flags`,
    });
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  // Determine verdict
  const verdict: GraduationPrediction["verdict"] =
    score >= 65 ? "likely" : score >= 35 ? "possible" : "unlikely";

  // Estimate time to graduation
  let estimatedHours: number | null = null;
  if (score >= 65 && vitals.curveProgressPct !== null) {
    const remaining = 100 - vitals.curveProgressPct;
    const ageHours = Math.max(1, vitals.ageHours);
    const progressRate = vitals.curveProgressPct / ageHours;
    if (progressRate > 0) {
      estimatedHours = Math.round(remaining / progressRate);
    }
  }

  return {
    probability: score,
    estimatedHours,
    factors,
    verdict,
  };
}

/**
 * Format graduation prediction as a readable string
 */
export function formatGraduationPrediction(pred: GraduationPrediction): string {
  const emoji = pred.verdict === "likely" ? "🟢" : pred.verdict === "possible" ? "🟡" : "🔴";
  const lines: string[] = [];

  lines.push(`${emoji} Graduation: ${pred.verdict.toUpperCase()} (${pred.probability}% probability)`);

  if (pred.estimatedHours !== null) {
    const hours = pred.estimatedHours;
    lines.push(`   ⏱ Estimated: ${hours < 1 ? "<1 hour" : hours < 24 ? `~${hours}h` : `~${Math.round(hours / 24)}d`}`);
  }

  lines.push(`   Key factors:`);
  for (const f of pred.factors.slice(0, 5)) {
    const icon = f.impact === "positive" ? "✅" : f.impact === "negative" ? "❌" : "➖";
    lines.push(`   ${icon} ${f.detail}`);
  }

  if (pred.factors.length > 5) {
    lines.push(`   ...and ${pred.factors.length - 5} more factors`);
  }

  return lines.join("\n");
}

function formatUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
