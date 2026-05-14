import type { HolderInfo, ConcentrationStats, RiskFinding } from "../types";

export function computeConcentration(holders: HolderInfo[]): ConcentrationStats {
  const eligible = holders.filter((h) => !h.isLp && !h.isBurn);
  const sorted = [...eligible].sort((a, b) => b.pctSupply - a.pctSupply);

  const sumTop = (n: number) =>
    sorted.slice(0, n).reduce((acc, h) => acc + h.pctSupply, 0);

  return {
    top10Pct: round(sumTop(10)),
    top25Pct: round(sumTop(25)),
    top100Pct: round(sumTop(100)),
    gini: round(gini(sorted.map((h) => h.pctSupply))),
  };
}

function gini(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * sorted[i];
  return (2 * cum) / (n * sum) - (n + 1) / n;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function concentrationFinding(stats: ConcentrationStats): RiskFinding | null {
  const evidence = [
    { label: "Top 10 hold", value: `${stats.top10Pct}%` },
    { label: "Top 25 hold", value: `${stats.top25Pct}%` },
    { label: "Gini", value: stats.gini.toFixed(2) },
  ];

  if (stats.top10Pct > 50) {
    return {
      id: "conc-extreme",
      category: "concentration",
      severity: "critical",
      title: "Extreme top-holder concentration",
      detail: `Top 10 wallets (excluding LP and burn) hold ${stats.top10Pct}% of supply. A coordinated sell would crater the price.`,
      evidence,
      scoreDelta: 35,
    };
  }
  if (stats.top10Pct > 35) {
    return {
      id: "conc-high",
      category: "concentration",
      severity: "high",
      title: "High top-holder concentration",
      detail: `Top 10 wallets hold ${stats.top10Pct}% of supply. Above the comfort threshold.`,
      evidence,
      scoreDelta: 20,
    };
  }
  if (stats.top10Pct < 20 && stats.gini < 0.85) {
    return {
      id: "conc-good",
      category: "concentration",
      severity: "low",
      title: "Healthy distribution",
      detail: `Top 10 hold only ${stats.top10Pct}%, Gini ${stats.gini.toFixed(2)} — wider holder spread than typical pump.fun launches.`,
      evidence,
      scoreDelta: -10,
    };
  }
  return null;
}
