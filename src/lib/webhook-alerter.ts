/**
 * Webhook Alerter — monitor tokens and send alerts when risk patterns change.
 * Supports Discord, Slack, Telegram, and generic webhooks.
 *
 * Usage:
 *   import { AlertManager } from "@/lib/webhook-alerter";
 *   const alerts = new AlertManager();
 *   alerts.addWatch("mint-address", { riskThreshold: 50 });
 *   alerts.addWebhook("discord", "https://discord.com/api/webhooks/...");
 *   await alerts.checkAll();
 */

import { analyze } from "./analyze";
import type { AnalysisResult, Verdict } from "./types";

export type WebhookType = "discord" | "slack" | "telegram" | "generic";

export interface WebhookConfig {
  type: WebhookType;
  url: string;
  /** Optional: only send alerts above this severity */
  minSeverity?: "low" | "medium" | "high" | "critical";
}

export interface WatchConfig {
  mint: string;
  /** Alert if risk score exceeds this threshold */
  riskThreshold?: number;
  /** Alert if verdict changes */
  watchVerdict?: boolean;
  /** Alert if holder count drops below this */
  minHolders?: number;
  /** Alert if dev wallet sells below this % */
  devExitThreshold?: number;
  /** Custom label for the token */
  label?: string;
}

export interface AlertEvent {
  id: string;
  mint: string;
  label: string;
  type: "risk_spike" | "verdict_change" | "holder_drop" | "dev_exit" | "bundle_detected";
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  message: string;
  previous?: Partial<AnalysisResult>;
  current: Partial<AnalysisResult>;
  timestamp: number;
}

interface WatchState {
  config: WatchConfig;
  lastResult: AnalysisResult | null;
}

export class AlertManager {
  private watches = new Map<string, WatchState>();
  private webhooks: WebhookConfig[] = [];
  private alertHistory: AlertEvent[] = [];
  private maxHistory = 100;

  /**
   * Add a token to watch
   */
  addWatch(config: WatchConfig): void {
    this.watches.set(config.mint, {
      config,
      lastResult: null,
    });
  }

  /**
   * Remove a token from watch
   */
  removeWatch(mint: string): void {
    this.watches.delete(mint);
  }

  /**
   * Add a webhook destination
   */
  addWebhook(webhook: WebhookConfig): void {
    this.webhooks.push(webhook);
  }

  /**
   * Remove all webhooks
   */
  clearWebhooks(): void {
    this.webhooks = [];
  }

  /**
   * Get recent alert history
   */
  getRecentAlerts(count = 10): AlertEvent[] {
    return this.alertHistory.slice(-count).reverse();
  }

  /**
   * Check all watched tokens for changes
   */
  async checkAll(): Promise<AlertEvent[]> {
    const alerts: AlertEvent[] = [];

    for (const [mint, state] of this.watches) {
      try {
        const result = await analyze(mint);
        const events = this.detectChanges(state, result);
        alerts.push(...events);

        // Update state
        state.lastResult = result;
      } catch (err) {
        console.error(`Alert check failed for ${mint}:`, err);
      }
    }

    // Store alerts
    this.alertHistory.push(...alerts);
    if (this.alertHistory.length > this.maxHistory) {
      this.alertHistory = this.alertHistory.slice(-this.maxHistory);
    }

    // Send to webhooks
    if (alerts.length > 0) {
      await Promise.allSettled(
        this.webhooks.map((wh) => this.sendAlert(wh, alerts))
      );
    }

    return alerts;
  }

  private detectChanges(
    state: WatchState,
    current: AnalysisResult
  ): AlertEvent[] {
    const events: AlertEvent[] = [];
    const { config } = state;
    const prev = state.lastResult;

    // Risk threshold breach
    if (config.riskThreshold !== undefined && current.riskScore >= config.riskThreshold) {
      if (!prev || prev.riskScore < config.riskThreshold) {
        events.push(this.createEvent({
          mint: current.mint,
          label: config.label || current.vitals.symbol,
          type: "risk_spike",
          severity: current.riskScore >= 60 ? "critical" : current.riskScore >= 30 ? "high" : "medium",
          title: `Risk spike: ${current.vitals.symbol} hit ${current.riskScore}/100`,
          message: `${current.vitals.name} (${current.vitals.symbol}) risk score is now ${current.riskScore}/100. Verdict: ${current.verdict}. ${current.vitals.holders} holders, MCap ${formatUsd(current.vitals.mcapUsd)}.`,
          current: { riskScore: current.riskScore, verdict: current.verdict },
        }));
      }
    }

    // Verdict change
    if (config.watchVerdict && prev && prev.verdict !== current.verdict) {
      events.push(this.createEvent({
        mint: current.mint,
        label: config.label || current.vitals.symbol,
        type: "verdict_change",
        severity: current.verdict === "avoid" ? "critical" : current.verdict === "caution" ? "high" : "medium",
        title: `Verdict changed: ${current.vitals.symbol} → ${current.verdict.toUpperCase()}`,
        message: `${current.vitals.symbol} verdict changed from ${prev.verdict.toUpperCase()} to ${current.verdict.toUpperCase()}. Risk: ${current.riskScore}/100.`,
        previous: { verdict: prev.verdict },
        current: { verdict: current.verdict, riskScore: current.riskScore },
      }));
    }

    // Holder drop
    if (config.minHolders !== undefined && current.vitals.holders < config.minHolders) {
      if (!prev || prev.vitals.holders >= config.minHolders) {
        events.push(this.createEvent({
          mint: current.mint,
          label: config.label || current.vitals.symbol,
          type: "holder_drop",
          severity: "high",
          title: `Holder count dropped: ${current.vitals.symbol}`,
          message: `${current.vitals.symbol} now has only ${current.vitals.holders} holders (threshold: ${config.minHolders}).`,
          current: { vitals: { holders: current.vitals.holders } as any },
        }));
      }
    }

    // Dev exit detection
    if (config.devExitThreshold !== undefined && current.vitals.devWalletPctHeld < config.devExitThreshold) {
      if (!prev || prev.vitals.devWalletPctHeld >= config.devExitThreshold) {
        events.push(this.createEvent({
          mint: current.mint,
          label: config.label || current.vitals.symbol,
          type: "dev_exit",
          severity: "critical",
          title: `Dev may have exited: ${current.vitals.symbol}`,
          message: `Dev wallet now holds ${current.vitals.devWalletPctHeld}% (was ${prev?.vitals.devWalletPctHeld ?? "?"}%). Threshold: ${config.devExitThreshold}%.`,
          previous: { vitals: { devWalletPctHeld: prev?.vitals.devWalletPctHeld } as any },
          current: { vitals: { devWalletPctHeld: current.vitals.devWalletPctHeld } as any },
        }));
      }
    }

    // New bundles detected
    if (current.bundles.length > 0) {
      if (!prev || prev.bundles.length < current.bundles.length) {
        events.push(this.createEvent({
          mint: current.mint,
          label: config.label || current.vitals.symbol,
          type: "bundle_detected",
          severity: "high",
          title: `Bundle detected: ${current.vitals.symbol}`,
          message: `${current.bundles.length} bundle(s) found. Top bundle: ${current.bundles[0].members.length} wallets controlling ${current.bundles[0].pctSupply}% of supply.`,
          current: { bundles: current.bundles },
        }));
      }
    }

    return events;
  }

  private createEvent(data: Omit<AlertEvent, "id" | "timestamp">): AlertEvent {
    return {
      ...data,
      id: `${data.mint}-${data.type}-${Date.now()}`,
      timestamp: Date.now(),
    } as AlertEvent;
  }

  private async sendAlert(
    webhook: WebhookConfig,
    alerts: AlertEvent[]
  ): Promise<void> {
    const payload = this.formatPayload(webhook.type, alerts);
    if (!payload) return;

    try {
      const res = await fetch(webhook.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.error(`Webhook ${webhook.type} returned ${res.status}`);
      }
    } catch (err) {
      console.error(`Failed to send ${webhook.type} alert:`, err);
    }
  }

  private formatPayload(type: WebhookType, alerts: AlertEvent[]): unknown {
    const alert = alerts[0]; // Send first alert as primary

    switch (type) {
      case "discord":
        return {
          embeds: alerts.map((a) => ({
            title: a.title,
            description: a.message,
            color: a.severity === "critical" ? 0xef4444 : a.severity === "high" ? 0xf59e0b : a.severity === "medium" ? 0x3b82f6 : 0x10b981,
            timestamp: new Date(a.timestamp).toISOString(),
            footer: { text: `Pumpscan Alert · ${a.mint.slice(0, 8)}...` },
          })),
        };

      case "slack":
        return {
          text: `*${alert.title}*`,
          attachments: alerts.map((a) => ({
            color: a.severity === "critical" ? "danger" : a.severity === "high" ? "warning" : "good",
            text: a.message,
            ts: Math.floor(a.timestamp / 1000),
          })),
        };

      case "telegram":
        return {
          text: `🚨 *${alert.title}*\n\n${alert.message}\n\n🔍 \`${alert.mint}\``,
          parse_mode: "Markdown",
        };

      case "generic":
      default:
        return {
          event: "pumpscan_alert",
          alerts: alerts.map((a) => ({
            title: a.title,
            message: a.message,
            severity: a.severity,
            mint: a.mint,
            timestamp: a.timestamp,
          })),
        };
    }
  }
}

function formatUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
