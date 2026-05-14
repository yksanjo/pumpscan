import type {
  HolderInfo,
  LaunchTx,
  FunderEdge,
  TokenVitals,
} from "./types";
import type { TokenFixture } from "./fixtures";

const PUMPFUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const KNOWN_LP_PROGRAMS = new Set([
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium AMM v4
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", // Raydium CLMM
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", // Orca Whirlpools
]);
const PUMPFUN_BONDING_CURVE_HINT = "BondingCurve";

function rpcUrl(): string {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error("HELIUS_API_KEY not set");
  return `https://mainnet.helius-rpc.com/?api-key=${key}`;
}

function enhancedUrl(path: string, params: Record<string, string | number> = {}): string {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error("HELIUS_API_KEY not set");
  const qs = new URLSearchParams({ "api-key": key, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  return `https://api.helius.xyz${path}?${qs}`;
}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "pumpscan", method, params }),
  });
  if (!res.ok) throw new Error(`Helius RPC ${method} failed: ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`Helius RPC ${method} error: ${json.error.message}`);
  if (json.result === undefined) throw new Error(`Helius RPC ${method} returned no result`);
  return json.result;
}

interface DasAsset {
  content?: {
    metadata?: { name?: string; symbol?: string };
  };
  token_info?: {
    decimals?: number;
    supply?: number | string;
    price_info?: { price_per_token?: number };
  };
  ownership?: { owner?: string };
}

async function fetchAsset(mint: string): Promise<DasAsset> {
  return rpc<DasAsset>("getAsset", { id: mint });
}

interface TokenAccount {
  address: string;
  owner: string;
  amount: number | string;
}

async function fetchAllTokenAccounts(mint: string, maxAccounts = 5000): Promise<TokenAccount[]> {
  const accounts: TokenAccount[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10 && accounts.length < maxAccounts; i++) {
    const result = await rpc<{ token_accounts?: TokenAccount[]; cursor?: string }>(
      "getTokenAccounts",
      { mint, limit: 1000, ...(cursor ? { cursor } : {}) }
    );
    const batch = result.token_accounts ?? [];
    accounts.push(...batch);
    if (!result.cursor || batch.length === 0) break;
    cursor = result.cursor;
  }
  return accounts;
}

interface EnhancedTx {
  signature: string;
  timestamp: number;
  slot: number;
  type?: string;
  description?: string;
  feePayer?: string;
  nativeTransfers?: Array<{ fromUserAccount: string; toUserAccount: string; amount: number }>;
  tokenTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    tokenAmount: number;
    mint: string;
  }>;
  events?: { swap?: unknown };
}

async function fetchAddressTxs(
  address: string,
  opts: { before?: string; type?: string; limit?: number } = {}
): Promise<EnhancedTx[]> {
  const params: Record<string, string | number> = { limit: opts.limit ?? 100 };
  if (opts.before) params.before = opts.before;
  if (opts.type) params.type = opts.type;
  const res = await fetch(enhancedUrl(`/v0/addresses/${address}/transactions`, params));
  if (!res.ok) throw new Error(`Helius enhanced /transactions failed: ${res.status}`);
  return (await res.json()) as EnhancedTx[];
}

function toLamports(n: number): number {
  return n / 1e9;
}

export async function buildFixtureFromHelius(mint: string): Promise<TokenFixture> {
  const [asset, tokenAccounts, earliestTxs] = await Promise.all([
    fetchAsset(mint),
    fetchAllTokenAccounts(mint, 2000),
    fetchOldestMintTxs(mint),
  ]);

  const decimals = asset.token_info?.decimals ?? 6;
  const rawSupply = Number(asset.token_info?.supply ?? 0);
  const supply = rawSupply / 10 ** decimals;
  const pricePerToken = asset.token_info?.price_info?.price_per_token ?? 0;
  const mcapUsd = supply * pricePerToken;

  const ownerTotals = new Map<string, number>();
  for (const acc of tokenAccounts) {
    const amount = Number(acc.amount) / 10 ** decimals;
    if (!isFinite(amount) || amount <= 0) continue;
    ownerTotals.set(acc.owner, (ownerTotals.get(acc.owner) ?? 0) + amount);
  }

  const holders: HolderInfo[] = Array.from(ownerTotals.entries())
    .map(([address, amount]) => {
      const pctSupply = supply > 0 ? (amount / supply) * 100 : 0;
      const lower = address.toLowerCase();
      const isLp = KNOWN_LP_PROGRAMS.has(address) || lower.includes("pool") || lower.includes("whirl");
      const isBurn = address === "1nc1nerator11111111111111111111111111111111";
      return {
        address,
        amount,
        pctSupply: Math.round(pctSupply * 100) / 100,
        isLp,
        isBurn,
      };
    })
    .sort((a, b) => b.pctSupply - a.pctSupply);

  const firstBuyTime = earliestTxs[0]?.timestamp ?? Math.floor(Date.now() / 1000);
  const firstBuySlot = earliestTxs[0]?.slot ?? 0;

  const launchTxs: LaunchTx[] = earliestTxs
    .filter((tx) => isBuyForMint(tx, mint))
    .slice(0, 200)
    .map((tx) => {
      const buyer = inferBuyer(tx, mint);
      const tokenAmount = sumTokenIn(tx, mint, buyer);
      const solAmount = sumSolOut(tx, buyer);
      return {
        signature: tx.signature,
        blockTime: tx.timestamp,
        slot: tx.slot,
        buyer,
        amountTokens: tokenAmount,
        amountSol: solAmount,
      };
    })
    .filter((tx) => !!tx.buyer);

  const earlySlotCutoff = firstBuySlot + 10;
  const earlyBuyers = Array.from(
    new Set(
      launchTxs.filter((tx) => tx.slot <= earlySlotCutoff).map((tx) => tx.buyer)
    )
  ).slice(0, 30);

  const funderEdges = await fetchFunderEdges(earlyBuyers, firstBuyTime);

  const devWallet = inferDevWallet(earliestTxs, mint);
  const devWalletPctHeld = devWallet
    ? holders.find((h) => h.address === devWallet)?.pctSupply ?? 0
    : 0;

  const oldestSec = Math.min(...earliestTxs.map((t) => t.timestamp).filter(Boolean));
  const ageHours = isFinite(oldestSec) ? Math.max(0, Math.round((Date.now() / 1000 - oldestSec) / 3600)) : 0;

  const vitals: TokenVitals = {
    mint,
    name: asset.content?.metadata?.name ?? "Unknown",
    symbol: asset.content?.metadata?.symbol ?? "???",
    mcapUsd,
    holders: ownerTotals.size,
    volume24hUsd: 0,
    ageHours,
    curveProgressPct: null,
    graduated: false,
    devWallet,
    devWalletPctHeld,
  };

  return { vitals, holders, launchTxs, funderEdges };
}

async function fetchOldestMintTxs(mint: string): Promise<EnhancedTx[]> {
  const all: EnhancedTx[] = [];
  let before: string | undefined;
  for (let i = 0; i < 5; i++) {
    const batch = await fetchAddressTxs(mint, { limit: 100, before });
    if (batch.length === 0) break;
    all.push(...batch);
    before = batch[batch.length - 1].signature;
    if (batch.length < 100) break;
  }
  return all.sort((a, b) => a.timestamp - b.timestamp);
}

function isBuyForMint(tx: EnhancedTx, mint: string): boolean {
  if (!tx.tokenTransfers) return false;
  return tx.tokenTransfers.some((t) => t.mint === mint && t.tokenAmount > 0);
}

function inferBuyer(tx: EnhancedTx, mint: string): string {
  const inbound = tx.tokenTransfers?.find((t) => t.mint === mint && t.tokenAmount > 0);
  return inbound?.toUserAccount ?? tx.feePayer ?? "";
}

function sumTokenIn(tx: EnhancedTx, mint: string, buyer: string): number {
  return (tx.tokenTransfers ?? [])
    .filter((t) => t.mint === mint && t.toUserAccount === buyer)
    .reduce((acc, t) => acc + t.tokenAmount, 0);
}

function sumSolOut(tx: EnhancedTx, buyer: string): number {
  return toLamports(
    (tx.nativeTransfers ?? [])
      .filter((t) => t.fromUserAccount === buyer)
      .reduce((acc, t) => acc + t.amount, 0)
  );
}

function inferDevWallet(txs: EnhancedTx[], mint: string): string | null {
  const sorted = [...txs].sort((a, b) => a.timestamp - b.timestamp);
  for (const tx of sorted) {
    const isMintEvent =
      tx.type === "TOKEN_MINT" ||
      (tx.tokenTransfers ?? []).some((t) => t.mint === mint && t.fromUserAccount === "");
    if (isMintEvent && tx.feePayer) return tx.feePayer;
  }
  return sorted[0]?.feePayer ?? null;
}

async function fetchFunderEdges(wallets: string[], beforeTime: number): Promise<FunderEdge[]> {
  const edges: FunderEdge[] = [];
  const FUND_WINDOW_SEC = 86400 * 3;
  for (const wallet of wallets) {
    try {
      const txs = await fetchAddressTxs(wallet, { limit: 100, type: "TRANSFER" });
      const sorted = [...txs].sort((a, b) => a.timestamp - b.timestamp);
      const incoming = sorted.find((tx) => {
        if (tx.timestamp >= beforeTime) return false;
        if (tx.timestamp < beforeTime - FUND_WINDOW_SEC) return false;
        return (tx.nativeTransfers ?? []).some(
          (t) => t.toUserAccount === wallet && t.amount > 0
        );
      });
      if (!incoming) continue;
      const transfer = incoming.nativeTransfers!.find(
        (t) => t.toUserAccount === wallet && t.amount > 0
      )!;
      edges.push({
        wallet,
        funder: transfer.fromUserAccount,
        amountSol: toLamports(transfer.amount),
        fundedAt: incoming.timestamp,
      });
    } catch {
      // skip wallet on error, don't fail whole analysis
    }
  }
  return edges;
}
