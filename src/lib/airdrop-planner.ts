/**
 * Airdrop planner — PLAN-ONLY by default.
 *
 * Builds the recipient list, per-wallet amount, and CSV export for an
 * airdrop. Signing and broadcasting are intentionally NOT wired up here:
 * pumpscan stays a read-only surface, and live token transfers are a
 * footgun if any input is wrong. To wire execution, drop in a
 * sol-agent-wallet call against the returned recipients[] and set
 * `signatures` on the returned plan.
 *
 * Matches the tweet flow: "Sent 1000 $SOAG to the top 10."
 */

import type {
  AirdropPlan,
  AirdropRecipient,
  CollectorRecord,
  CollectorScan,
} from "./types";

export interface AirdropInput {
  mint: string;
  recipients: Array<{ wallet: string; amount?: number }>;
  /** Default amount used when a recipient row has no amount. */
  defaultAmount: number;
  dryRun?: boolean;
}

export function planAirdrop(input: AirdropInput): AirdropPlan {
  const dryRun = input.dryRun ?? true;
  const seen = new Set<string>();
  const recipients: AirdropRecipient[] = [];
  const notes: string[] = [];

  for (const row of input.recipients) {
    const wallet = row.wallet.trim();
    if (wallet.length < 32 || wallet.length > 64) {
      notes.push(`skipped invalid wallet: ${wallet.slice(0, 12)}…`);
      continue;
    }
    if (seen.has(wallet)) {
      notes.push(`deduped repeat wallet: ${wallet.slice(0, 6)}…${wallet.slice(-4)}`);
      continue;
    }
    seen.add(wallet);
    recipients.push({ wallet, amount: row.amount ?? input.defaultAmount });
  }

  const totalAmount = recipients.reduce((acc, r) => acc + r.amount, 0);
  const csv = renderCsv(input.mint, recipients);

  if (!dryRun) {
    notes.push(
      "Execute mode requested but no signer is wired in pumpscan. " +
      "Pass `recipients` to sol-agent-wallet's bulk transfer, or run " +
      "`pumpscan airdrop ... --execute` once a signer is plugged in."
    );
  }

  return {
    mint: input.mint,
    totalRecipients: recipients.length,
    totalAmount,
    dryRun: true, // always true in current build; flip when execution lands
    recipients,
    csv,
    signatures: null,
    notes,
  };
}

/**
 * Convenience: take the top-N real collectors from a CollectorScan and
 * build an airdrop plan. Matches the tweet: top 10 → 1000 $SOAG each.
 */
export function planAirdropForScan(
  scan: CollectorScan,
  opts: { mint: string; topN: number; amountPerWallet: number; dryRun?: boolean }
): AirdropPlan {
  const top: CollectorRecord[] = scan.collectors.slice(0, opts.topN);
  return planAirdrop({
    mint: opts.mint,
    recipients: top.map((c) => ({ wallet: c.wallet, amount: opts.amountPerWallet })),
    defaultAmount: opts.amountPerWallet,
    dryRun: opts.dryRun ?? true,
  });
}

function renderCsv(mint: string, recipients: AirdropRecipient[]): string {
  const rows = [`wallet,amount,mint`];
  for (const r of recipients) rows.push(`${r.wallet},${r.amount},${mint}`);
  return rows.join("\n") + "\n";
}

export function formatAirdropPlan(plan: AirdropPlan): string {
  const lines: string[] = [];
  lines.push("╔══════════════════════════════════════════════╗");
  lines.push("║         Pumpscan Airdrop Plan (DRY)         ║");
  lines.push("╚══════════════════════════════════════════════╝");
  lines.push("");
  lines.push(`  Mint:       ${plan.mint}`);
  lines.push(`  Recipients: ${plan.totalRecipients}`);
  lines.push(`  Total send: ${plan.totalAmount.toLocaleString()}`);
  lines.push(`  Mode:       ${plan.dryRun ? "DRY RUN (no transactions sent)" : "EXECUTE"}`);
  lines.push("");
  lines.push("  ── Recipients ──");
  for (let i = 0; i < plan.recipients.length; i++) {
    const r = plan.recipients[i];
    lines.push(
      `  ${String(i + 1).padStart(2)}. ${r.wallet.slice(0, 6)}…${r.wallet.slice(-4)}  ${r.amount.toLocaleString()}`
    );
  }
  if (plan.notes.length > 0) {
    lines.push("");
    lines.push("  ── Notes ──");
    for (const n of plan.notes) lines.push(`    • ${n}`);
  }
  return lines.join("\n");
}
