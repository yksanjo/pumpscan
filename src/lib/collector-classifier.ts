/**
 * Wallet activity classification — splits a wallet's swap history into
 * one of four tiers, and flags "real collectors" who pass the launch
 * filter (60+ day history, 20+ swaps, recent activity).
 *
 * Tier thresholds match the BONK holder breakdown:
 *   - dormant        last swap > 60d ago
 *   - quiet          last swap 30-60d ago
 *   - lightly_active < 30d ago, 1-7 swaps in last 30d
 *   - active         < 30d ago, 8+ swaps in last 30d
 *
 * The "real collector" rule (used to send 1000 $SOAG):
 *   firstSwap >= 60d ago  AND  totalSwaps >= 20  AND  recently active
 */

import type {
  ActivityTier,
  WalletClassification,
  WalletSwapHistory,
} from "./types";

export interface ClassifierConfig {
  recencyDays: number;       // "recent activity" window, default 30
  dormantDays: number;       // > this with no activity = dormant, default 60
  minHistoryDays: number;    // real-collector min first-swap age, default 60
  minTotalSwaps: number;     // real-collector min swaps, default 20
  activeSwapThreshold: number; // swaps in recencyDays to flip lightly_active -> active
}

export const DEFAULT_CONFIG: ClassifierConfig = {
  recencyDays: 30,
  dormantDays: 60,
  minHistoryDays: 60,
  minTotalSwaps: 20,
  activeSwapThreshold: 8,
};

export function classifyWallet(
  history: WalletSwapHistory,
  cfg: ClassifierConfig = DEFAULT_CONFIG
): WalletClassification {
  const nowSec = Math.floor(Date.now() / 1000);
  const day = 86_400;

  const firstSwapDaysAgo = history.firstSwapTs
    ? Math.floor((nowSec - history.firstSwapTs) / day)
    : null;
  const lastSwapDaysAgo = history.lastSwapTs
    ? Math.floor((nowSec - history.lastSwapTs) / day)
    : null;

  const recencyCutoff = nowSec - cfg.recencyDays * day;
  const swaps30d = history.samples.filter((s) => s.timestamp >= recencyCutoff).length;

  const tier = pickTier(lastSwapDaysAgo, swaps30d, cfg);

  const passesHistory = firstSwapDaysAgo !== null && firstSwapDaysAgo >= cfg.minHistoryDays;
  const passesVolume = history.totalSwaps >= cfg.minTotalSwaps;
  const passesRecency = tier === "lightly_active" || tier === "active";
  const isRealCollector = passesHistory && passesVolume && passesRecency;

  const reason = isRealCollector
    ? `${history.totalSwaps} swaps over ${firstSwapDaysAgo}d, active in last ${lastSwapDaysAgo}d`
    : explainReject({ tier, passesHistory, passesVolume, passesRecency, firstSwapDaysAgo, totalSwaps: history.totalSwaps, lastSwapDaysAgo });

  return {
    wallet: history.wallet,
    tier,
    isRealCollector,
    totalSwaps: history.totalSwaps,
    swaps30d,
    firstSwapDaysAgo,
    lastSwapDaysAgo,
    pumpFunBags: history.pumpFunBags,
    reason,
  };
}

function pickTier(
  lastSwapDaysAgo: number | null,
  swaps30d: number,
  cfg: ClassifierConfig
): ActivityTier {
  if (lastSwapDaysAgo === null) return "dormant";
  if (lastSwapDaysAgo > cfg.dormantDays) return "dormant";
  if (lastSwapDaysAgo > cfg.recencyDays) return "quiet";
  if (swaps30d >= cfg.activeSwapThreshold) return "active";
  return "lightly_active";
}

function explainReject(input: {
  tier: ActivityTier;
  passesHistory: boolean;
  passesVolume: boolean;
  passesRecency: boolean;
  firstSwapDaysAgo: number | null;
  totalSwaps: number;
  lastSwapDaysAgo: number | null;
}): string {
  const reasons: string[] = [];
  if (!input.passesHistory) {
    reasons.push(
      input.firstSwapDaysAgo === null
        ? "no swap history found"
        : `only ${input.firstSwapDaysAgo}d history (<60d)`
    );
  }
  if (!input.passesVolume) reasons.push(`${input.totalSwaps} swaps (<20)`);
  if (!input.passesRecency) {
    reasons.push(
      input.tier === "dormant"
        ? `dormant — last swap ${input.lastSwapDaysAgo ?? "n/a"}d ago`
        : `quiet — last swap ${input.lastSwapDaysAgo ?? "n/a"}d ago`
    );
  }
  return reasons.join("; ");
}

export function tierEmoji(tier: ActivityTier): string {
  switch (tier) {
    case "dormant": return "😴";
    case "quiet": return "🌙";
    case "lightly_active": return "🌤";
    case "active": return "⚡";
  }
}

export function tierLabel(tier: ActivityTier): string {
  switch (tier) {
    case "dormant": return "Dormant";
    case "quiet": return "Quiet";
    case "lightly_active": return "Lightly Active";
    case "active": return "Active";
  }
}
