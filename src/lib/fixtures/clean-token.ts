import type { HolderInfo, LaunchTx, FunderEdge, TokenVitals } from "../types";

export const CLEAN_MINT = "CLEANxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

export const CLEAN_VITALS: TokenVitals = {
  mint: CLEAN_MINT,
  name: "Honest Cat",
  symbol: "HCAT",
  mcapUsd: 184_000,
  holders: 1247,
  volume24hUsd: 92_000,
  ageHours: 38,
  curveProgressPct: null,
  graduated: true,
  devWallet: "DEVCLEANxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  devWalletPctHeld: 1.4,
};

export const CLEAN_HOLDERS: HolderInfo[] = [
  { address: "RAYLPxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", amount: 220_000_000, pctSupply: 22.0, isLp: true },
  { address: "BURNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", amount: 50_000_000, pctSupply: 5.0, isBurn: true },
  ...Array.from({ length: 50 }, (_, i) => ({
    address: `CLEAN_HOLDER_${String(i).padStart(3, "0")}xxxxxxxxxxxxxxxxxxxx`,
    amount: 1_000_000 * (50 - i),
    pctSupply: ((50 - i) * 0.1),
  })),
  ...Array.from({ length: 1195 }, (_, i) => ({
    address: `CLEAN_DUST_${String(i).padStart(4, "0")}xxxxxxxxxxxxxxxxxxxxx`,
    amount: 10_000,
    pctSupply: 0.001,
  })),
];

const LAUNCH_BLOCK_TIME = 1715000000;

export const CLEAN_LAUNCH_TXS: LaunchTx[] = Array.from({ length: 50 }, (_, i) => ({
  signature: `sig_clean_${i}`,
  blockTime: LAUNCH_BLOCK_TIME + i * 6 + Math.floor(Math.random() * 30),
  slot: 250_000_000 + i * 2,
  buyer: `CLEAN_HOLDER_${String(i).padStart(3, "0")}xxxxxxxxxxxxxxxxxxxx`,
  amountTokens: 1_000_000 * (50 - i),
  amountSol: 0.1 + i * 0.05,
}));

export const CLEAN_FUNDER_EDGES: FunderEdge[] = CLEAN_LAUNCH_TXS.map((tx, i) => ({
  wallet: tx.buyer,
  funder: `INDEPENDENT_FUNDER_${i}xxxxxxxxxxxxxxxxxxxxx`,
  amountSol: 1 + Math.random() * 5,
  fundedAt: tx.blockTime - 86400 * (1 + Math.floor(Math.random() * 30)),
}));
