export type Verdict = "clean" | "caution" | "avoid";

export const VERDICT_META: Record<Verdict, { emoji: string; label: string; color: string }> = {
  clean: { emoji: "🟢", label: "Clean", color: "emerald" },
  caution: { emoji: "🟡", label: "Caution", color: "amber" },
  avoid: { emoji: "🔴", label: "Avoid", color: "red" },
};

export type Severity = "low" | "medium" | "high" | "critical";

export interface RiskFinding {
  id: string;
  category: "concentration" | "bundler" | "sniper" | "insider" | "smart_money" | "behavior";
  severity: Severity;
  title: string;
  detail: string;
  evidence: Array<{ label: string; value: string; link?: string }>;
  scoreDelta: number;
}

export interface HolderInfo {
  address: string;
  amount: number;
  pctSupply: number;
  isLp?: boolean;
  isBurn?: boolean;
}

export interface LaunchTx {
  signature: string;
  blockTime: number;
  slot: number;
  buyer: string;
  amountTokens: number;
  amountSol: number;
}

export interface FunderEdge {
  wallet: string;
  funder: string;
  amountSol: number;
  fundedAt: number;
}

export interface BundleCluster {
  funder: string;
  members: string[];
  pctSupply: number;
  fundedWithinSec: number;
}

export interface TokenVitals {
  mint: string;
  name: string;
  symbol: string;
  mcapUsd: number;
  holders: number;
  volume24hUsd: number;
  ageHours: number;
  curveProgressPct: number | null;
  graduated: boolean;
  devWallet: string | null;
  devWalletPctHeld: number;
}

export interface ConcentrationStats {
  top10Pct: number;
  top25Pct: number;
  top100Pct: number;
  gini: number;
}

export interface GraduationPrediction {
  probability: number;
  estimatedHours: number | null;
  factors: Array<{
    signal: string;
    impact: "positive" | "negative" | "neutral";
    detail: string;
  }>;
  verdict: "likely" | "possible" | "unlikely";
}

export interface AnalysisResult {
  mint: string;
  generatedAt: number;
  verdict: Verdict;
  confidence: number;
  riskScore: number;
  vitals: TokenVitals;
  concentration: ConcentrationStats;
  bundles: BundleCluster[];
  findings: RiskFinding[];
  narration: string | null;
  graduation?: GraduationPrediction;
}
