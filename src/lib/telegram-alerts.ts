import type { NewTokenAlert } from "./new-token-scanner";
import { formatBreakoutTimeframe, type BreakoutSignal } from "./breakout-alerts";
import { formatSoagAmount, MIN_SOAG_FOR_ALERTS } from "./soag-access";

export interface TelegramBotInfo {
  configured: boolean;
  username?: string;
  url?: string;
  source: "public-env" | "telegram-token" | "missing";
  error?: string;
}

export class TelegramDeliveryError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "TelegramDeliveryError";
  }
}

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export async function getTelegramBotInfo(): Promise<TelegramBotInfo> {
  const publicUrl = process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL?.trim();
  if (publicUrl) {
    return {
      configured: true,
      username: usernameFromBotUrl(publicUrl),
      url: publicUrl,
      source: "public-env",
    };
  }

  const publicUsername = normalizeTelegramBotUsername(
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
  );
  if (publicUsername) {
    return {
      configured: true,
      username: publicUsername,
      url: `https://t.me/${publicUsername}`,
      source: "public-env",
    };
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { configured: false, source: "missing" };
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
    cache: "force-cache",
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    return {
      configured: false,
      source: "telegram-token",
      error: "Telegram bot lookup failed.",
    };
  }

  const payload = (await res.json()) as {
    ok?: boolean;
    result?: { username?: string };
  };
  const username = normalizeTelegramBotUsername(payload.result?.username);

  if (!payload.ok || !username) {
    return {
      configured: false,
      source: "telegram-token",
      error: "Telegram bot username is unavailable.",
    };
  }

  return {
    configured: true,
    username,
    url: `https://t.me/${username}`,
    source: "telegram-token",
  };
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new TelegramDeliveryError("Telegram bot token is not configured.");
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { description?: string };
      detail = body.description ? ` ${body.description}` : "";
    } catch {
      // Keep the status-only error if Telegram returned a non-JSON response.
    }
    throw new TelegramDeliveryError(`Telegram delivery failed.${detail}`, res.status);
  }
}

export function formatNewTokenTelegramAlert(alert: NewTokenAlert): string {
  const status =
    alert.riskScore <= 25
      ? "LOW RISK"
      : alert.riskScore >= 55
        ? "HIGH RISK"
        : "WATCH";

  return [
    `${status}: ${alert.name} (${alert.symbol})`,
    "",
    `Risk: ${alert.riskScore}/100 · ${alert.verdict.toUpperCase()}`,
    `MCap: ${formatUsd(alert.mcapUsd)} · Holders: ${alert.holders}`,
    `Dev holds: ${alert.devHoldsPct}% · Bundles: ${alert.bundlesFound}`,
    `Age: ${alert.ageSeconds}s · Curve: ${alert.curveProgress ?? "?"}%`,
    "",
    alert.mint,
    `Terminal: ${formatPadreTerminalUrl(alert.mint)}`,
    `https://pumpscan.musicailab.com/analyze/${alert.mint}`,
  ].join("\n");
}

export function formatBreakoutTelegramAlert(signal: BreakoutSignal): string {
  const timeframe = formatBreakoutTimeframe(signal.timeframeMinutes);
  const modeLabel = signal.triggerMode === "live" ? "LIVE" : "CLOSE";
  const triggerLabel = signal.breakoutSource === "high" ? "High" : "Close";
  const candleTimeLabel = signal.triggerMode === "live" ? "Candle opened" : "Candle closed";
  const candleTime = signal.triggerMode === "live" ? signal.candleOpenedAt : signal.candleClosedAt;

  return [
    `${timeframe} ${modeLabel} BREAKOUT: ${signal.symbol}`,
    "",
    `Daily: ${formatDailyTrendAction(signal.dailyTrend.action)} · ${signal.dailyTrend.direction.toUpperCase()}`,
    signal.dailyTrend.reason,
    "",
    `${triggerLabel}: ${formatPriceUsd(signal.breakoutPrice)} (${signal.breakoutPct.toFixed(2)}% above lookback)`,
    signal.triggerMode === "live" && signal.breakoutSource === "high"
      ? `Latest close: ${formatPriceUsd(signal.breakoutClose)}`
      : null,
    `Lookback: ${signal.lookbackCandles} closed candles · high close ${formatPriceUsd(signal.previousLookbackClose)}`,
    signal.minBreakoutPct > 0 ? `Min move: ${signal.minBreakoutPct}%` : null,
    signal.triggerMode === "live"
      ? `Rule: active ${timeframe} candle high/close > previous closes`
      : `Rule: latest closed ${timeframe} candle close > previous closes`,
    `Volume: ${formatUsd(signal.volumeUsd)}`,
    `${candleTimeLabel}: ${new Date(candleTime).toISOString()}`,
    "",
    signal.mint,
    `Terminal: ${formatPadreTerminalUrl(signal.mint)}`,
    `https://www.geckoterminal.com/${signal.network}/pools/${signal.poolAddress}`,
  ].filter((line): line is string => line !== null).join("\n");
}

export function formatWelcomeTelegramAlert(input: {
  wallet: string;
  balance: number;
}): string {
  return [
    "Breakout Radar Telegram alerts are active.",
    "",
    `Wallet: ${input.wallet.slice(0, 4)}...${input.wallet.slice(-4)}`,
    `Verified balance: ${formatSoagAmount(input.balance)}`,
    `Required: ${formatSoagAmount(MIN_SOAG_FOR_ALERTS)}`,
    "",
    "You will receive scanner finds, risk warnings, and Breakout Radar alerts here.",
  ].join("\n");
}

function formatUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatPriceUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n >= 1) return `$${n.toFixed(4)}`;
  if (n >= 0.01) return `$${n.toFixed(6)}`;
  if (n >= 0.000001) return `$${n.toFixed(8)}`;
  return `$${n.toExponential(3)}`;
}

function formatPadreTerminalUrl(mint: string): string {
  return `https://trade.padre.gg/trade/solana/${encodeURIComponent(mint)}`;
}

function formatDailyTrendAction(action: BreakoutSignal["dailyTrend"]["action"]): string {
  switch (action) {
    case "pass":
      return "PASS";
    case "review":
      return "REVIEW";
    case "neutral":
      return "NEUTRAL";
  }
}

export function normalizeTelegramBotUsername(value?: string): string {
  if (!value) return "";
  return value
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^t\.me\//i, "")
    .replace(/[/?#].*$/, "");
}

function usernameFromBotUrl(url: string): string {
  return normalizeTelegramBotUsername(url);
}
