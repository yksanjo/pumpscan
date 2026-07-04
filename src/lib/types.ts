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

export interface TopHolder {
  address: string;
  amount: number;
  pctSupply: number;
  isLp?: boolean;
  isBurn?: boolean;
}

export interface WalletSwapSample {
  signature: string;
  timestamp: number;
  involvedMints: string[];
}

export interface WalletSwapHistory {
  wallet: string;
  totalSwaps: number;
  firstSwapTs: number | null;
  lastSwapTs: number | null;
  pumpFunBags: number;
  samples: WalletSwapSample[];
}

export type ActivityTier = "dormant" | "quiet" | "lightly_active" | "active";

export interface WalletClassification {
  wallet: string;
  tier: ActivityTier;
  isRealCollector: boolean;
  totalSwaps: number;
  swaps30d: number;
  firstSwapDaysAgo: number | null;
  lastSwapDaysAgo: number | null;
  pumpFunBags: number;
  reason: string;
}

export interface CollectorMintAppearance {
  mint: string;
  pctSupply: number;
  amount: number;
}

export interface CollectorRecord extends WalletClassification {
  /** Which scanned graduates this wallet appeared in as a top holder. */
  appearances: CollectorMintAppearance[];
}

export interface CollectorScan {
  generatedAt: number;
  mintsScanned: string[];
  holdersPerToken: number;
  recencyDays: number;
  totals: {
    holdersInspected: number;
    walletsClassified: number;
    realCollectors: number;
  };
  tierCounts: Record<ActivityTier, number>;
  collectors: CollectorRecord[];
  errors: Array<{ stage: "holders" | "swaps"; mint?: string; wallet?: string; error: string }>;
}

export interface AirdropRecipient {
  wallet: string;
  amount: number;
}

export interface AirdropPlan {
  mint: string;
  totalRecipients: number;
  totalAmount: number;
  dryRun: boolean;
  recipients: AirdropRecipient[];
  csv: string;
  /** Set only when execute mode is wired up; null in plan-only mode. */
  signatures: string[] | null;
  notes: string[];
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
