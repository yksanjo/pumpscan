import { fetchWalletTokenBalance } from "./helius";

export const SOAG_MINT = "ADue87cPcDhsyGq2hrDsukp7j8AFTSnaYHSanDATpump";
export const MIN_SOAG_FOR_ALERTS = 5_000_000;

export interface SoagAccessResult {
  balance: number;
  required: number;
  eligible: boolean;
}

export async function checkSoagAlertAccess(wallet: string): Promise<SoagAccessResult> {
  const balance = await fetchWalletTokenBalance(wallet, SOAG_MINT);
  return {
    balance,
    required: MIN_SOAG_FOR_ALERTS,
    eligible: balance >= MIN_SOAG_FOR_ALERTS,
  };
}

export function formatSoagAmount(amount: number): string {
  return `${Math.floor(amount).toLocaleString()} SOAG`;
}
