import type { HolderInfo, LaunchTx, FunderEdge, TokenVitals } from "../types";

export const BUNDLED_MINT = "BUNDLExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

export const BUNDLED_VITALS: TokenVitals = {
  mint: BUNDLED_MINT,
  name: "Rocket Pepe",
  symbol: "RPEPE",
  mcapUsd: 412_000,
  holders: 287,
  volume24hUsd: 38_000,
  ageHours: 6,
  curveProgressPct: 78,
  graduated: false,
  devWallet: "DEVRUGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  devWalletPctHeld: 8.2,
};

const BUNDLE_FUNDER = "RUGFUNDERxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

const BUNDLE_MEMBERS = Array.from({ length: 8 }, (_, i) =>
  `BUNDLED_BOT_${String(i).padStart(2, "0")}xxxxxxxxxxxxxxxxxxxxxxx`
);

export const BUNDLED_HOLDERS: HolderInfo[] = [
  { address: "DEVRUGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", amount: 82_000_000, pctSupply: 8.2 },
  ...BUNDLE_MEMBERS.map((addr, i) => ({
    address: addr,
    amount: 45_000_000 - i * 2_000_000,
    pctSupply: 4.5 - i * 0.2,
  })),
  ...Array.from({ length: 20 }, (_, i) => ({
    address: `BUNDLED_HOLDER_${String(i).padStart(3, "0")}xxxxxxxxxxxxxxxxx`,
    amount: 2_000_000 - i * 50_000,
    pctSupply: 0.2 - i * 0.005,
  })),
  ...Array.from({ length: 258 }, (_, i) => ({
    address: `BUNDLED_DUST_${String(i).padStart(4, "0")}xxxxxxxxxxxxxxxxxxxx`,
    amount: 50_000,
    pctSupply: 0.005,
  })),
];

const LAUNCH_BLOCK_TIME = 1715000000;

export const BUNDLED_LAUNCH_TXS: LaunchTx[] = [
  ...BUNDLE_MEMBERS.map((buyer, i) => ({
    signature: `sig_bundle_${i}`,
    blockTime: LAUNCH_BLOCK_TIME + Math.floor(i / 4),
    slot: 250_000_000 + Math.floor(i / 4),
    buyer,
    amountTokens: 45_000_000 - i * 2_000_000,
    amountSol: 2.0,
  })),
  ...Array.from({ length: 20 }, (_, i) => ({
    signature: `sig_normal_${i}`,
    blockTime: LAUNCH_BLOCK_TIME + 60 + i * 30,
    slot: 250_000_010 + i * 3,
    buyer: `BUNDLED_HOLDER_${String(i).padStart(3, "0")}xxxxxxxxxxxxxxxxx`,
    amountTokens: 2_000_000 - i * 50_000,
    amountSol: 0.3 + i * 0.05,
  })),
];

export const BUNDLED_FUNDER_EDGES: FunderEdge[] = [
  ...BUNDLE_MEMBERS.map((wallet) => ({
    wallet,
    funder: BUNDLE_FUNDER,
    amountSol: 2.5,
    fundedAt: LAUNCH_BLOCK_TIME - 1800,
  })),
  ...Array.from({ length: 20 }, (_, i) => ({
    wallet: `BUNDLED_HOLDER_${String(i).padStart(3, "0")}xxxxxxxxxxxxxxxxx`,
    funder: `RANDOM_${i}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`,
    amountSol: 1 + Math.random() * 5,
    fundedAt: LAUNCH_BLOCK_TIME - 86400 * (1 + Math.floor(Math.random() * 60)),
  })),
];
