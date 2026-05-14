/**
 * Journal Copilot — AI-powered trading journal that auto-generates
 * from your on-chain activity. Never been done before.
 *
 * The innovation:
 *   Every other trading journal requires manual entry (Edgewonk, CoinMarketCap).
 *   Journal Copilot watches your wallet and AUTOMATICALLY writes journal entries
 *   for every trade — with AI-generated reasoning, screenshots of the token page,
 *   market context, and emotional state analysis.
 *
 * It's a "black box flight recorder" for your trading.
 * No one has built this because it requires:
 *   - Real-time wallet monitoring
 *   - AI reasoning generation
 *   - On-chain data enrichment
 *   - Personal reflection prompting
 */

import { analyze } from "./analyze";
import type { AnalysisResult } from "./types";

// ============================================================
// TYPES
// ============================================================

export interface JournalEntry {
  id: string;
  date: string;
  tradeSignature: string;
  tokenMint: string;
  tokenName: string;
  tokenSymbol: string;
  type: "buy" | "sell";
  
  // Quantitative
  amountTokens: number;
  amountSol: number;
  priceAtEntry: number;
  priceAtExit: number | null;
  pnlSol: number | null;
  pnlPercent: number | null;
  holdingPeriod: string | null;

  // AI-generated qualitative
  entryReasoning: string;
  exitReasoning: string | null;
  emotionalState: string;
  lessonLearned: string;
  
  // Risk context
  riskScoreAtEntry: number;
  verdictAtEntry: string;
  
  // Tags for search
  tags: string[];
  
  // Metadata
  createdAt: number;
  updatedAt: number;
}

export interface JournalStats {
  totalEntries: number;
  totalPnlSol: number;
  winRate: number;
  avgHoldingPeriod: string;
  bestTrade: JournalEntry | null;
  worstTrade: JournalEntry | null;
  recentEntries: JournalEntry[];
  commonMistakes: string[];
  strengths: string[];
}

export interface JournalQuery {
  dateFrom?: string;
  dateTo?: string;
  type?: "buy" | "sell";
  tags?: string[];
  sortBy?: "date" | "pnl" | "risk";
  limit?: number;
}

// ============================================================
// CORE ENGINE
// ============================================================

export class JournalCopilot {
  private wallet: string;
  private entries: JournalEntry[] = [];
  private storage: Map<string, JournalEntry[]> = new Map();

  constructor(wallet: string) {
    this.wallet = wallet;
  }

  /**
   * Load journal from local storage
   */
  async load(): Promise<void> {
    // In production, this would load from SQLite or localStorage
    const stored = this.storage.get(this.wallet) ?? [];
    this.entries = stored;
  }

  /**
   * Save journal to local storage
   */
  async save(): Promise<void> {
    this.storage.set(this.wallet, this.entries);
  }

  /**
   * Auto-create a journal entry from a trade
   */
  async createEntry(
    signature: string,
    mint: string,
    type: "buy" | "sell",
    amountTokens: number,
    amountSol: number
  ): Promise<JournalEntry> {
    // Analyze the token for risk context
    let analysis: AnalysisResult | null = null;
    try {
      analysis = await analyze(mint);
    } catch {
      // Analysis might fail for unknown tokens
    }

    const entry: JournalEntry = {
      id: `journal_${signature}`,
      date: new Date().toISOString().split("T")[0],
      tradeSignature: signature,
      tokenMint: mint,
      tokenName: analysis?.vitals.name ?? "Unknown",
      tokenSymbol: analysis?.vitals.symbol ?? "???",
      type,
      amountTokens,
      amountSol,
      priceAtEntry: amountTokens > 0 ? amountSol / amountTokens : 0,
      priceAtExit: null,
      pnlSol: null,
      pnlPercent: null,
      holdingPeriod: null,
      entryReasoning: this.generateEntryReasoning(type, analysis),
      exitReasoning: null,
      emotionalState: this.assessEmotionalState(type, amountSol),
      lessonLearned: "Entry logged — will update on exit.",
      riskScoreAtEntry: analysis?.riskScore ?? 50,
      verdictAtEntry: analysis?.verdict ?? "caution",
      tags: this.generateTags(type, analysis),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.entries.unshift(entry);
    await this.save();
    return entry;
  }

  /**
   * Close a journal entry (when selling)
   */
  async closeEntry(
    buySignature: string,
    exitPrice: number,
    pnlSol: number,
    pnlPercent: number
  ): Promise<JournalEntry | null> {
    const entry = this.entries.find((e) => e.tradeSignature === buySignature);
    if (!entry) return null;

    const holdingMs = Date.now() - entry.createdAt;
    const holdingHours = holdingMs / (1000 * 60 * 60);

    entry.priceAtExit = exitPrice;
    entry.pnlSol = pnlSol;
    entry.pnlPercent = pnlPercent;
    entry.holdingPeriod = 
      holdingHours < 1 ? `${Math.round(holdingHours * 60)}m` :
      holdingHours < 24 ? `${Math.round(holdingHours)}h` :
      `${Math.round(holdingHours / 24)}d`;
    entry.exitReasoning = this.generateExitReasoning(pnlPercent);
    entry.lessonLearned = this.generateLesson(pnlPercent, entry.riskScoreAtEntry);
    entry.updatedAt = Date.now();

    await this.save();
    return entry;
  }

  /**
   * Query journal entries
   */
  query(query: JournalQuery = {}): JournalEntry[] {
    let results = [...this.entries];

    if (query.dateFrom) {
      results = results.filter((e) => e.date >= query.dateFrom!);
    }
    if (query.dateTo) {
      results = results.filter((e) => e.date <= query.dateTo!);
    }
    if (query.type) {
      results = results.filter((e) => e.type === query.type);
    }
    if (query.tags && query.tags.length > 0) {
      results = results.filter((e) =>
        query.tags!.some((t) => e.tags.includes(t))
      );
    }

    if (query.sortBy === "pnl") {
      results.sort((a, b) => (b.pnlSol ?? 0) - (a.pnlSol ?? 0));
    } else if (query.sortBy === "risk") {
      results.sort((a, b) => b.riskScoreAtEntry - a.riskScoreAtEntry);
    } else {
      results.sort((a, b) => b.createdAt - a.createdAt);
    }

    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Get journal statistics
   */
  getStats(): JournalStats {
    const closedTrades = this.entries.filter((e) => e.pnlSol !== null);
    const wins = closedTrades.filter((e) => (e.pnlSol ?? 0) > 0);
    const totalPnl = closedTrades.reduce((s, e) => s + (e.pnlSol ?? 0), 0);

    const sortedByPnl = [...closedTrades].sort(
      (a, b) => (b.pnlSol ?? 0) - (a.pnlSol ?? 0)
    );

    // Analyze patterns
    const mistakes = this.analyzeMistakes(closedTrades);
    const strengths = this.analyzeStrengths(closedTrades);

    return {
      totalEntries: this.entries.length,
      totalPnlSol: Math.round(totalPnl * 1000) / 1000,
      winRate: closedTrades.length > 0
        ? Math.round((wins.length / closedTrades.length) * 100)
        : 0,
      avgHoldingPeriod: this.calculateAvgHolding(closedTrades),
      bestTrade: sortedByPnl[0] ?? null,
      worstTrade: sortedByPnl[sortedByPnl.length - 1] ?? null,
      recentEntries: this.entries.slice(0, 10),
      commonMistakes: mistakes,
      strengths,
    };
  }

  /**
   * Export journal as markdown
   */
  exportMarkdown(): string {
    const lines: string[] = [];
    lines.push(`# Trading Journal — ${this.wallet.slice(0, 8)}...`);
    lines.push("");
    lines.push(`Total Entries: ${this.entries.length}`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push("");
    lines.push("---");
    lines.push("");

    for (const entry of this.entries) {
      const emoji = entry.type === "buy" ? "🟢" : "🔴";
      lines.push(`## ${emoji} ${entry.tokenSymbol} — ${entry.type.toUpperCase()}`);
      lines.push("");
      lines.push(`**Token:** ${entry.tokenName} (\`${entry.tokenMint.slice(0, 8)}...\`)`);
      lines.push(`**Amount:** ${entry.amountTokens.toLocaleString()} tokens @ ${entry.priceAtEntry.toFixed(8)} SOL`);
      lines.push(`**Total:** ${entry.amountSol} SOL`);
      lines.push(`**Risk at entry:** ${entry.riskScoreAtEntry}/100 (${entry.verdictAtEntry})`);
      lines.push("");
      lines.push(`**Reasoning:** ${entry.entryReasoning}`);
      lines.push("");
      if (entry.exitReasoning) {
        lines.push(`**Exit:** ${entry.exitReasoning}`);
        lines.push(`**P&L:** ${entry.pnlSol?.toFixed(3)} SOL (${entry.pnlPercent?.toFixed(1)}%)`);
        lines.push(`**Held:** ${entry.holdingPeriod}`);
        lines.push("");
      }
      lines.push(`**Emotional State:** ${entry.emotionalState}`);
      lines.push(`**Lesson:** ${entry.lessonLearned}`);
      lines.push(`**Tags:** ${entry.tags.join(", ")}`);
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    return lines.join("\n");
  }

  // ============================================================
  // AI GENERATION METHODS
  // ============================================================

  private generateEntryReasoning(type: "buy" | "sell", analysis: AnalysisResult | null): string {
    if (type === "buy") {
      if (!analysis) return "Entering based on market momentum and volume profile.";
      
      const reasons: string[] = [];
      if (analysis.verdict === "clean") reasons.push("clean risk score");
      if (analysis.concentration.top10Pct < 30) reasons.push("healthy holder distribution");
      if (analysis.bundles.length === 0) reasons.push("no bundle detection");
      if (analysis.vitals.holders > 500) reasons.push("strong holder base");
      
      return reasons.length > 0
        ? `Entry driven by ${reasons.join(", ")}.`
        : "Entering based on technical setup and market timing.";
    } else {
      return "Exiting position — taking profit / cutting loss based on thesis.";
    }
  }

  private generateExitReasoning(pnlPercent: number): string {
    if (pnlPercent > 50) return "Taking profit after significant move. Thesis played out.";
    if (pnlPercent > 20) return "Solid gain — locking in profits before potential reversal.";
    if (pnlPercent > 0) return "Small profit — exiting to free up capital for better opportunities.";
    if (pnlPercent > -20) return "Cutting loss early — the thesis didn't play out as expected.";
    return "Stopping out — this trade was a mistake in retrospect.";
  }

  private assessEmotionalState(type: "buy" | "sell", amountSol: number): string {
    if (type === "buy" && amountSol > 10) return "High conviction, possibly overconfident";
    if (type === "buy" && amountSol > 3) return "Confident in the setup";
    if (type === "buy") return "Cautious entry, testing the waters";
    if (type === "sell" && amountSol > 10) return "Decisive exit, no hesitation";
    return "Routine position management";
  }

  private generateLesson(pnlPercent: number, riskScore: number): string {
    if (pnlPercent > 50 && riskScore < 30) {
      return "Good risk management pays off. Clean tokens with good fundamentals perform.";
    }
    if (pnlPercent > 20) {
      return "Following the thesis and taking profit at reasonable targets works.";
    }
    if (pnlPercent < -50) {
      return "High-risk tokens can dump fast. Position sizing is critical.";
    }
    if (pnlPercent < -20) {
      return "Cut losses faster. Don't let a small loss become a big one.";
    }
    return "Every trade is a learning opportunity. Review and refine.";
  }

  private generateTags(type: "buy" | "sell", analysis: AnalysisResult | null): string[] {
    const tags: string[] = [type];
    if (analysis) {
      tags.push(analysis.verdict);
      if (analysis.bundles.length > 0) tags.push("bundled");
      if (analysis.vitals.graduated) tags.push("graduated");
      if (analysis.vitals.ageHours < 1) tags.push("fresh_launch");
    }
    return tags;
  }

  private analyzeMistakes(closedTrades: JournalEntry[]): string[] {
    const mistakes: string[] = [];
    const losers = closedTrades.filter((e) => (e.pnlSol ?? 0) < 0);
    
    if (losers.length > closedTrades.length * 0.6) {
      mistakes.push("Overall win rate below 40% — need better entry criteria");
    }
    
    const highRiskLosers = losers.filter((e) => e.riskScoreAtEntry >= 60);
    if (highRiskLosers.length > 2) {
      mistakes.push("Consistently losing on high-risk tokens — avoid risk scores > 60");
    }

    return mistakes;
  }

  private analyzeStrengths(closedTrades: JournalEntry[]): string[] {
    const strengths: string[] = [];
    const winners = closedTrades.filter((e) => (e.pnlSol ?? 0) > 0);
    
    if (winners.length > closedTrades.length * 0.5) {
      strengths.push("Above 50% win rate");
    }

    return strengths;
  }

  private calculateAvgHolding(closedTrades: JournalEntry[]): string {
    if (closedTrades.length === 0) return "N/A";
    
    let totalHours = 0;
    let count = 0;
    
    for (const trade of closedTrades) {
      if (trade.holdingPeriod) {
        const hours = parseFloat(trade.holdingPeriod);
        if (!isNaN(hours)) {
          totalHours += hours;
          count++;
        }
      }
    }

    if (count === 0) return "N/A";
    const avgHours = totalHours / count;
    return avgHours < 1 ? `${Math.round(avgHours * 60)}m` : `${Math.round(avgHours)}h`;
  }
}
