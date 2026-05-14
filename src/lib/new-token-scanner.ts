/**
 * New Token Scanner — polls pump.fun for newly created tokens in real-time
 * and runs instant risk analysis. This is the core of a sniper alert system.
 *
 * How it works:
 *   1. Polls pump.fun's API for the latest created coins
 *   2. Filters to only new tokens (not seen before)
 *   3. Runs quick risk pre-screen (holder count, dev wallet, concentration)
 *   4. Emits alerts for tokens that pass/fail thresholds
 *
 * This is the #1 most requested feature in the pump.fun ecosystem.
 */

import { analyze } from "./analyze";
import { extractMint } from "./parse-input";
import type { AnalysisResult } from "./types";

export interface NewTokenAlert {
  mint: string;
  name: string;
  symbol: string;
  riskScore: number;
  verdict: "clean" | "caution" | "avoid";
  mcapUsd: number;
  holders: number;
  ageSeconds: number;
  devWallet: string | null;
  devHoldsPct: number;
  bundlesFound: number;
  findingsCount: number;
  detectedAt: number;
  /** How quickly the bonding curve is filling (0-100) */
  curveProgress: number | null;
  /** Whether this token has graduated to Raydium */
  graduated: boolean;
}

export interface ScannerConfig {
  /** Poll interval in seconds (default: 15) */
  pollIntervalSec: number;
  /** Alert on tokens with risk BELOW this threshold (good finds) */
  maxRiskScore: number;
  /** Alert on tokens with risk ABOVE this threshold (rug alerts) */
  minRiskScore: number;
  /** Minimum holders to consider */
  minHolders: number;
  /** Maximum age in seconds to consider "new" */
  maxAgeSec: number;
  /** Webhook URLs to notify */
  webhooks: string[];
}

const DEFAULT_CONFIG: ScannerConfig = {
  pollIntervalSec: 15,
  maxRiskScore: 20,   // Alert on clean tokens (good opportunities)
  minRiskScore: 60,   // Alert on high-risk tokens (rug warnings)
  minHolders: 10,
  maxAgeSec: 300,     // 5 minutes
  webhooks: [],
};

/**
 * Scans pump.fun for new tokens by checking the Helius program logs
 * for the pump.fun program ID.
 */
export class NewTokenScanner {
  private seenMints = new Set<string>();
  private config: ScannerConfig;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private onToken: ((alert: NewTokenAlert) => void) | null = null;

  constructor(config: Partial<ScannerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start scanning for new tokens
   */
  start(onToken: (alert: NewTokenAlert) => void): void {
    this.onToken = onToken;
    console.log(`[Scanner] Starting — polling every ${this.config.pollIntervalSec}s`);

    // Initial scan
    this.scan();

    // Periodic scanning
    this.intervalId = setInterval(() => this.scan(), this.config.pollIntervalSec * 1000);
  }

  /**
   * Stop scanning
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log("[Scanner] Stopped");
  }

  /**
   * Get stats about what we've seen
   */
  getStats(): { totalSeen: number; config: ScannerConfig } {
    return {
      totalSeen: this.seenMints.size,
      config: this.config,
    };
  }

  private async scan(): Promise<void> {
    try {
      const newMints = await this.fetchNewMints();
      
      for (const mint of newMints) {
        if (this.seenMints.has(mint)) continue;
        this.seenMints.add(mint);

        // Quick async analysis
        this.analyzeAndAlert(mint).catch((err) => {
          console.error(`[Scanner] Analysis failed for ${mint.slice(0, 8)}...:`, err);
        });
      }
    } catch (err) {
      console.error("[Scanner] Scan failed:", err);
    }
  }

  /**
   * Fetch newly created tokens from Helius by watching pump.fun program logs.
   * The pump.fun program ID is 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
   */
  private async fetchNewMints(): Promise<string[]> {
    const key = process.env.HELIUS_API_KEY;
    if (!key) return [];

    try {
      // Use Helius webhook-style polling — get recent transactions for pump.fun program
      const url = `https://api.helius.xyz/v0/addresses/6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P/transactions?api-key=${key}&limit=20&type=TOKEN_MINT`;

      const res = await fetch(url);
      if (!res.ok) return [];

      const txs = await res.json() as Array<{
        signature: string;
        timestamp: number;
        tokenTransfers?: Array<{ mint: string; tokenAmount: number }>;
        feePayer?: string;
        type?: string;
      }>;

      const mints: string[] = [];
      const now = Math.floor(Date.now() / 1000);

      for (const tx of txs) {
        // Only consider very recent transactions
        if (now - tx.timestamp > this.config.maxAgeSec) continue;

        if (tx.tokenTransfers) {
          for (const transfer of tx.tokenTransfers) {
            const mint = transfer.mint;
            if (mint && mint.length >= 32 && !this.seenMints.has(mint)) {
              mints.push(mint);
            }
          }
        }
      }

      return mints;
    } catch (err) {
      console.error("[Scanner] Failed to fetch new mints:", err);
      return [];
    }
  }

  private async analyzeAndAlert(mint: string): Promise<void> {
    const result = await analyze(mint);
    const ageSeconds = result.vitals.ageHours * 3600;

    const alert: NewTokenAlert = {
      mint: result.mint,
      name: result.vitals.name,
      symbol: result.vitals.symbol,
      riskScore: result.riskScore,
      verdict: result.verdict,
      mcapUsd: result.vitals.mcapUsd,
      holders: result.vitals.holders,
      ageSeconds,
      devWallet: result.vitals.devWallet,
      devHoldsPct: result.vitals.devWalletPctHeld,
      bundlesFound: result.bundles.length,
      findingsCount: result.findings.length,
      detectedAt: Date.now(),
      curveProgress: result.vitals.curveProgressPct,
      graduated: result.vitals.graduated,
    };

    // Check if this token meets alert criteria
    const isGoodFind = result.riskScore <= this.config.maxRiskScore &&
                       result.vitals.holders >= this.config.minHolders;
    const isRugAlert = result.riskScore >= this.config.minRiskScore;

    if (isGoodFind || isRugAlert) {
      console.log(
        `[Scanner] ${isGoodFind ? "🟢" : "🔴"} ${result.vitals.symbol} — ` +
        `risk ${result.riskScore}/100 · ${result.vitals.holders} holders · ` +
        `${formatUsd(result.vitals.mcapUsd)}`
      );

      if (this.onToken) {
        this.onToken(alert);
      }

      // Send to webhooks
      await this.notifyWebhooks(alert);
    }
  }

  private async notifyWebhooks(alert: NewTokenAlert): Promise<void> {
    const emoji = alert.verdict === "clean" ? "🟢" : alert.verdict === "caution" ? "🟡" : "🔴";
    const title = alert.riskScore <= 20
      ? `🟢 Low-risk token found: ${alert.symbol}`
      : `🔴 High-risk token detected: ${alert.symbol}`;

    const message = [
      `${emoji} *${alert.name} (${alert.symbol})*`,
      `Risk: ${alert.riskScore}/100 · Verdict: ${alert.verdict.toUpperCase()}`,
      `MCap: ${formatUsd(alert.mcapUsd)} · Holders: ${alert.holders}`,
      `Dev holds: ${alert.devHoldsPct}% · Bundles: ${alert.bundlesFound}`,
      `Age: ${alert.ageSeconds}s · Curve: ${alert.curveProgress ?? "?"}%`,
      ``,
      `🔍 \`${alert.mint}\``,
      `https://pumpscan.musicailab.com/analyze/${alert.mint}`,
    ].join("\n");

    for (const url of this.config.webhooks) {
      try {
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: message,
            parse_mode: "Markdown",
            embeds: [{
              title,
              description: message,
              color: alert.riskScore >= 60 ? 0xef4444 : alert.riskScore >= 30 ? 0xf59e0b : 0x10b981,
              timestamp: new Date().toISOString(),
            }],
          }),
        });
      } catch {
        // Silently fail webhook notifications
      }
    }
  }
}

function formatUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
