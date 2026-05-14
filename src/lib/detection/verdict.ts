import type { RiskFinding, TokenVitals, Verdict } from "../types";

export function scoreVerdict(
  findings: RiskFinding[],
  vitals: TokenVitals
): { verdict: Verdict; confidence: number; riskScore: number; extraFindings: RiskFinding[] } {
  const extra: RiskFinding[] = [];

  if (vitals.holders < 100) {
    extra.push({
      id: "low-holders",
      category: "concentration",
      severity: "medium",
      title: "Very few holders",
      detail: `Only ${vitals.holders} holders. Limited distribution increases manipulation risk.`,
      evidence: [{ label: "Holders", value: String(vitals.holders) }],
      scoreDelta: 15,
    });
  }

  if (vitals.devWalletPctHeld > 5) {
    extra.push({
      id: "dev-still-holds",
      category: "insider",
      severity: vitals.devWalletPctHeld > 10 ? "high" : "medium",
      title: `Dev wallet still holds ${vitals.devWalletPctHeld}%`,
      detail: "Dev wallet has not fully exited. Sudden dump risk remains.",
      evidence: [
        { label: "Dev holds", value: `${vitals.devWalletPctHeld}%` },
        ...(vitals.devWallet
          ? [{ label: "Dev wallet", value: truncate(vitals.devWallet), link: `https://solscan.io/account/${vitals.devWallet}` }]
          : []),
      ],
      scoreDelta: vitals.devWalletPctHeld > 10 ? 20 : 10,
    });
  }

  const all = [...findings, ...extra];
  const rawScore = all.reduce((acc, f) => acc + f.scoreDelta, 0);
  const riskScore = Math.max(0, Math.min(100, rawScore));

  const verdict: Verdict =
    riskScore >= 60 ? "avoid" : riskScore >= 30 ? "caution" : "clean";

  const severeCount = all.filter((f) => f.severity === "high" || f.severity === "critical").length;
  const confidence = Math.min(
    0.95,
    0.55 + 0.1 * severeCount + (all.length >= 3 ? 0.1 : 0)
  );

  return {
    verdict,
    confidence: Math.round(confidence * 100) / 100,
    riskScore,
    extraFindings: extra,
  };
}

function truncate(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}
