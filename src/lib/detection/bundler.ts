import type { HolderInfo, LaunchTx, FunderEdge, BundleCluster, RiskFinding } from "../types";

const EARLY_WINDOW_SLOTS = 10;
const FUNDING_WINDOW_SEC = 3600;
const MIN_CLUSTER_SIZE = 3;

export function detectBundles(
  holders: HolderInfo[],
  launchTxs: LaunchTx[],
  funderEdges: FunderEdge[]
): BundleCluster[] {
  if (launchTxs.length === 0) return [];

  const sortedByTime = [...launchTxs].sort((a, b) => a.blockTime - b.blockTime);
  const launchTime = sortedByTime[0].blockTime;
  const launchSlot = sortedByTime[0].slot;

  const earlyBuyers = new Set(
    sortedByTime
      .filter((tx) => tx.slot - launchSlot <= EARLY_WINDOW_SLOTS)
      .map((tx) => tx.buyer)
  );

  const funderMap = new Map<string, FunderEdge>();
  for (const edge of funderEdges) {
    funderMap.set(edge.wallet, edge);
  }

  const byFunder = new Map<string, FunderEdge[]>();
  for (const buyer of earlyBuyers) {
    const edge = funderMap.get(buyer);
    if (!edge) continue;
    if (Math.abs(launchTime - edge.fundedAt) > FUNDING_WINDOW_SEC) continue;
    const arr = byFunder.get(edge.funder) ?? [];
    arr.push(edge);
    byFunder.set(edge.funder, arr);
  }

  const holderPctMap = new Map(holders.map((h) => [h.address, h.pctSupply]));

  const clusters: BundleCluster[] = [];
  for (const [funder, edges] of byFunder) {
    if (edges.length < MIN_CLUSTER_SIZE) continue;
    const members = edges.map((e) => e.wallet);
    const pctSupply = members.reduce(
      (sum, m) => sum + (holderPctMap.get(m) ?? 0),
      0
    );
    const fundedAtTimes = edges.map((e) => e.fundedAt);
    const fundedWithinSec =
      Math.max(...fundedAtTimes) - Math.min(...fundedAtTimes);

    clusters.push({
      funder,
      members,
      pctSupply: Math.round(pctSupply * 100) / 100,
      fundedWithinSec,
    });
  }

  return clusters.sort((a, b) => b.pctSupply - a.pctSupply);
}

export function bundlerFindings(clusters: BundleCluster[]): RiskFinding[] {
  return clusters.map((c, i) => {
    const severity: RiskFinding["severity"] =
      c.pctSupply > 25 ? "critical" : c.pctSupply > 10 ? "high" : "medium";
    const scoreDelta = c.pctSupply > 25 ? 40 : c.pctSupply > 10 ? 25 : 12;
    return {
      id: `bundle-${i}`,
      category: "bundler",
      severity,
      title: `Bundle of ${c.members.length} wallets controls ${c.pctSupply}%`,
      detail: `${c.members.length} wallets funded by the same source (${truncate(c.funder)}) bought in the first 10 blocks. Coordinated entry strongly suggests a bundle.`,
      evidence: [
        { label: "Members", value: String(c.members.length) },
        { label: "Supply controlled", value: `${c.pctSupply}%` },
        { label: "Funder", value: truncate(c.funder), link: solscanLink(c.funder) },
        { label: "Funded within", value: `${c.fundedWithinSec}s of each other` },
      ],
      scoreDelta,
    };
  });
}

function truncate(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function solscanLink(addr: string): string {
  return `https://solscan.io/account/${addr}`;
}
