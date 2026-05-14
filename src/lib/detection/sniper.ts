/**
 * Sniper Detection Engine — identifies sniper bot patterns in pump.fun launches.
 *
 * Pump.fun snipers use various techniques:
 *   1. **Jito tip bidding** — Paying Jito validators to land transactions first
 *   2. **Multi-wallet sniping** — Same entity buying from many wallets simultaneously
 *   3. **Front-running** — Watching the mempool and inserting before others
 *   4. **Sandwich attacks** — Buying before and selling after a target's transaction
 *   5. **Same-funder clusters** — Multiple wallets funded by same source buying in same block
 *
 * This goes beyond the basic bundler detection to identify sophisticated sniper patterns.
 */

import type { LaunchTx, FunderEdge, HolderInfo, RiskFinding } from "../types";

export interface SniperCluster {
  /** The common funder or identifying characteristic */
  identifier: string;
  /** Wallet addresses in this cluster */
  wallets: string[];
  /** Total supply controlled */
  pctSupply: number;
  /** How they were detected */
  pattern: "same_funder" | "same_block" | "jito_tip" | "multi_wallet" | "sandwich";
  /** Evidence details */
  evidence: Array<{ label: string; value: string; link?: string }>;
  /** Risk score contribution */
  scoreDelta: number;
}

/**
 * Detect sniper patterns from launch transactions and funder edges.
 * More sophisticated than basic bundler detection.
 */
export function detectSnipers(
  launchTxs: LaunchTx[],
  funderEdges: FunderEdge[],
  holders: HolderInfo[]
): SniperCluster[] {
  const clusters: SniperCluster[] = [];
  const holderPctMap = new Map(holders.map((h) => [h.address, h.pctSupply]));

  if (launchTxs.length === 0) return clusters;

  const sortedBySlot = [...launchTxs].sort((a, b) => a.slot - b.slot);
  const firstSlot = sortedBySlot[0].slot;

  // --- Pattern 1: Same-block sniping ---
  // Multiple wallets buying in the exact same slot = coordinated sniping
  const bySlot = new Map<number, LaunchTx[]>();
  for (const tx of sortedBySlot) {
    const arr = bySlot.get(tx.slot) ?? [];
    arr.push(tx);
    bySlot.set(tx.slot, arr);
  }

  for (const [slot, txs] of bySlot) {
    if (txs.length >= 3) {
      const wallets = txs.map((t) => t.buyer);
      const pctSupply = wallets.reduce(
        (sum, w) => sum + (holderPctMap.get(w) ?? 0),
        0
      );

      clusters.push({
        identifier: `Block ${slot}`,
        wallets,
        pctSupply: Math.round(pctSupply * 100) / 100,
        pattern: "same_block",
        evidence: [
          { label: "Slot", value: String(slot) },
          { label: "Buyers in block", value: String(wallets.length) },
          { label: "Supply bought", value: `${Math.round(pctSupply * 100) / 100}%` },
          { label: "Block offset", value: `${slot - firstSlot} blocks from launch` },
        ],
        scoreDelta: wallets.length >= 5 ? 25 : 15,
      });
    }
  }

  // --- Pattern 2: Same-funder sniping ---
  // Multiple wallets funded by same source buying within seconds of each other
  const funderMap = new Map<string, FunderEdge[]>();
  for (const edge of funderEdges) {
    const arr = funderMap.get(edge.funder) ?? [];
    arr.push(edge);
    funderMap.set(edge.funder, arr);
  }

  for (const [funder, edges] of funderMap) {
    if (edges.length < 2) continue;

    const wallets = edges.map((e) => e.wallet);
    const pctSupply = wallets.reduce(
      (sum, w) => sum + (holderPctMap.get(w) ?? 0),
      0
    );
    const times = edges.map((e) => e.fundedAt);
    const spread = Math.max(...times) - Math.min(...times);

    // Only flag if funded within a short window
    if (spread > 3600) continue;

    clusters.push({
      identifier: funder,
      wallets,
      pctSupply: Math.round(pctSupply * 100) / 100,
      pattern: "same_funder",
      evidence: [
        { label: "Funder", value: truncate(funder), link: solscanLink(funder) },
        { label: "Wallets funded", value: String(wallets.length) },
        { label: "Supply controlled", value: `${Math.round(pctSupply * 100) / 100}%` },
        { label: "Funded within", value: `${spread}s` },
      ],
      scoreDelta: edges.length >= 5 ? 30 : edges.length >= 3 ? 20 : 10,
    });
  }

  // --- Pattern 3: Jito tip sniping ---
  // Detect by looking at transactions that paid Jito tips (high priority fees)
  // This is inferred from rapid sequential buys from different wallets
  const timeWindows = findRapidSequentialBuys(sortedBySlot, 3, 2); // 3+ buys within 2 slots
  for (const window of timeWindows) {
    const wallets = window.map((t) => t.buyer);
    const pctSupply = wallets.reduce(
      (sum, w) => sum + (holderPctMap.get(w) ?? 0),
      0
    );

    // Skip if already caught by same-block detection
    const alreadyCaught = clusters.some((c) =>
      c.pattern === "same_block" &&
      c.wallets.some((w) => wallets.includes(w))
    );
    if (alreadyCaught) continue;

    clusters.push({
      identifier: `Rapid sequence at slot ${window[0].slot}`,
      wallets,
      pctSupply: Math.round(pctSupply * 100) / 100,
      pattern: "jito_tip",
      evidence: [
        { label: "Buyers", value: String(wallets.length) },
        { label: "Span (slots)", value: `${window[window.length - 1].slot - window[0].slot}` },
        { label: "Supply bought", value: `${Math.round(pctSupply * 100) / 100}%` },
        { label: "Pattern", value: "Rapid sequential buys (Jito tip bidding)" },
      ],
      scoreDelta: 20,
    });
  }

  return clusters;
}

/**
 * Find windows where N+ transactions happen within M slots of each other.
 * This indicates Jito tip bidding or mempool sniping.
 */
function findRapidSequentialBuys(
  txs: LaunchTx[],
  minCount: number,
  maxSlotSpan: number
): LaunchTx[][] {
  const windows: LaunchTx[][] = [];

  for (let i = 0; i < txs.length; i++) {
    const window: LaunchTx[] = [txs[i]];
    for (let j = i + 1; j < txs.length; j++) {
      if (txs[j].slot - txs[i].slot <= maxSlotSpan) {
        window.push(txs[j]);
      } else {
        break;
      }
    }
    if (window.length >= minCount) {
      windows.push(window);
      i += window.length - 1; // Skip ahead
    }
  }

  return windows;
}

/**
 * Convert sniper clusters to risk findings
 */
export function sniperFindings(clusters: SniperCluster[]): RiskFinding[] {
  const patternLabels: Record<string, string> = {
    same_block: "Same-block coordinated buys",
    same_funder: "Same-funder wallet cluster",
    jito_tip: "Jito tip sniping detected",
    multi_wallet: "Multi-wallet sniping pattern",
    sandwich: "Sandwich attack pattern",
  };

  return clusters.map((c, i) => {
    const severity: RiskFinding["severity"] =
      c.scoreDelta >= 25 ? "critical" : c.scoreDelta >= 15 ? "high" : "medium";

    return {
      id: `sniper-${i}`,
      category: "sniper",
      severity,
      title: `${patternLabels[c.pattern] ?? "Sniper pattern"}: ${c.wallets.length} wallets`,
      detail: `${c.wallets.length} wallets ${describePattern(c.pattern)}. Together they control ${c.pctSupply}% of supply. This pattern is consistent with automated sniping.`,
      evidence: c.evidence,
      scoreDelta: c.scoreDelta,
    };
  });
}

function describePattern(pattern: string): string {
  switch (pattern) {
    case "same_block":
      "bought in the same block — highly coordinated";
    case "same_funder":
      "were funded by the same source wallet";
    case "jito_tip":
      "executed rapid sequential buys (Jito tip bidding)";
    case "multi_wallet":
      "appear to be controlled by the same entity";
    case "sandwich":
      "executed a sandwich attack pattern";
    default:
      "exhibit sniper-like behavior";
  }
  return "exhibit suspicious coordinated behavior";
}

function truncate(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function solscanLink(addr: string): string {
  return `https://solscan.io/account/${addr}`;
}
