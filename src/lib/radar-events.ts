import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BreakoutSignal } from "./breakout-alerts";
import { formatBreakoutTimeframe } from "./breakout-alerts";
import type { NewTokenAlert } from "./new-token-scanner";

export type RadarEventKind = "new-token" | "breakout";
export type RadarEventStatus = "active" | "watch" | "review" | "risk";

export interface RadarEvent {
  id: string;
  kind: RadarEventKind;
  status: RadarEventStatus;
  mint: string;
  symbol: string;
  name: string;
  network: string;
  detectedAt: number;
  source: string;
  signal: string;
  reason: string;
  score: number;
  caughtMcapUsd: number | null;
  volumeUsd: number | null;
  peakMultiple: number | null;
  currentMultiple: number | null;
  riskScore: number | null;
  verdict: string | null;
  timeframe: string | null;
  breakoutPct: number | null;
  dailyAction: string | null;
  terminalUrl: string;
  chartUrl: string | null;
}

export interface RadarSnapshot {
  generatedAt: number;
  source: "file" | "demo" | "empty";
  eventsFile: string;
  events: RadarEvent[];
  error: string | null;
}

const DEFAULT_RADAR_EVENTS_FILE = "data/radar-events.json";
const DEFAULT_MAX_EVENTS = 500;

export function radarEventsFile(): string {
  return process.env.RADAR_EVENTS_FILE || DEFAULT_RADAR_EVENTS_FILE;
}

export async function readRadarSnapshot(opts: {
  allowDemo?: boolean;
  eventsFile?: string;
} = {}): Promise<RadarSnapshot> {
  const eventsFile = opts.eventsFile ?? radarEventsFile();

  try {
    const events = await readStoredEvents(eventsFile);
    return {
      generatedAt: Date.now(),
      source: events.length > 0 ? "file" : "empty",
      eventsFile,
      events,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Radar event log could not be read.";
    if (!opts.allowDemo) throw err;

    return {
      generatedAt: Date.now(),
      source: "demo",
      eventsFile,
      events: demoRadarEvents(),
      error: message.includes("ENOENT") ? null : message,
    };
  }
}

export async function appendRadarEvent(
  event: RadarEvent,
  opts: { eventsFile?: string; maxEvents?: number } = {}
): Promise<void> {
  const eventsFile = opts.eventsFile ?? radarEventsFile();
  const maxEvents = Math.max(1, Math.floor(opts.maxEvents ?? DEFAULT_MAX_EVENTS));
  let currentEvents: RadarEvent[] = [];

  try {
    currentEvents = await readStoredEvents(eventsFile);
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes("ENOENT")) throw err;
  }

  const nextEvents = [event, ...currentEvents.filter((item) => item.id !== event.id)]
    .sort((a, b) => b.detectedAt - a.detectedAt)
    .slice(0, maxEvents);

  await writeStoredEvents(eventsFile, nextEvents);
}

export function newTokenAlertToRadarEvent(alert: NewTokenAlert): RadarEvent {
  const isClean = alert.riskScore <= 25;
  const isRisk = alert.riskScore >= 55;

  return {
    id: stableRadarEventId("new-token", alert.mint, alert.detectedAt),
    kind: "new-token",
    status: isClean ? "watch" : isRisk ? "risk" : "review",
    mint: alert.mint,
    symbol: cleanSymbol(alert.symbol, alert.mint),
    name: alert.name || cleanSymbol(alert.symbol, alert.mint),
    network: "solana",
    detectedAt: alert.detectedAt,
    source: "New token scanner",
    signal: isClean ? "Low-risk launch" : isRisk ? "High-risk launch" : "Fresh launch",
    reason: `${alert.holders.toLocaleString()} holders, ${alert.bundlesFound} bundle cluster${alert.bundlesFound === 1 ? "" : "s"}, dev holds ${formatPercent(alert.devHoldsPct)}.`,
    score: clampScore(100 - alert.riskScore),
    caughtMcapUsd: alert.mcapUsd,
    volumeUsd: null,
    peakMultiple: null,
    currentMultiple: null,
    riskScore: alert.riskScore,
    verdict: alert.verdict,
    timeframe: null,
    breakoutPct: null,
    dailyAction: null,
    terminalUrl: padreTerminalUrl(alert.mint),
    chartUrl: null,
  };
}

export function breakoutSignalToRadarEvent(signal: BreakoutSignal): RadarEvent {
  const timeframe = formatBreakoutTimeframe(signal.timeframeMinutes);
  const triggerLabel = signal.breakoutSource === "high" ? "High" : "Close";

  return {
    id: stableRadarEventId("breakout", signal.mint, signal.candleOpenedAt, timeframe),
    kind: "breakout",
    status: signal.dailyTrend.action === "review" ? "review" : "active",
    mint: signal.mint,
    symbol: cleanSymbol(signal.symbol, signal.mint),
    name: signal.name || signal.poolName || cleanSymbol(signal.symbol, signal.mint),
    network: signal.network,
    detectedAt: signal.detectedAt,
    source: "Breakout Radar",
    signal: `${timeframe} ${signal.triggerMode} breakout`,
    reason: `${triggerLabel} cleared the ${signal.lookbackCandles}-candle close by ${formatPercent(signal.breakoutPct)}. Daily gate: ${signal.dailyTrend.action.toUpperCase()}.`,
    score: clampScore(60 + signal.breakoutPct * 4 + Math.log10(Math.max(1, signal.volumeUsd)) * 3),
    caughtMcapUsd: null,
    volumeUsd: signal.volumeUsd,
    peakMultiple: null,
    currentMultiple: null,
    riskScore: null,
    verdict: null,
    timeframe,
    breakoutPct: signal.breakoutPct,
    dailyAction: signal.dailyTrend.action,
    terminalUrl: padreTerminalUrl(signal.mint),
    chartUrl: `https://www.geckoterminal.com/${signal.network}/pools/${signal.poolAddress}`,
  };
}

async function readStoredEvents(eventsFile: string): Promise<RadarEvent[]> {
  const raw = await readFile(/* turbopackIgnore: true */ eventsFile, "utf8");
  const parsed = JSON.parse(raw) as { events?: unknown };
  if (!Array.isArray(parsed.events)) return [];

  return parsed.events
    .filter(isRadarEvent)
    .sort((a, b) => b.detectedAt - a.detectedAt);
}

async function writeStoredEvents(eventsFile: string, events: RadarEvent[]): Promise<void> {
  await mkdir(/* turbopackIgnore: true */ path.dirname(eventsFile), { recursive: true });
  const tmp = `${eventsFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(
    /* turbopackIgnore: true */ tmp,
    `${JSON.stringify({ version: 1, updatedAt: Date.now(), events }, null, 2)}\n`,
    "utf8"
  );
  await rename(/* turbopackIgnore: true */ tmp, eventsFile);
}

function isRadarEvent(value: unknown): value is RadarEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<RadarEvent>;
  return (
    typeof event.id === "string" &&
    (event.kind === "new-token" || event.kind === "breakout") &&
    (event.status === "active" ||
      event.status === "watch" ||
      event.status === "review" ||
      event.status === "risk") &&
    typeof event.mint === "string" &&
    typeof event.symbol === "string" &&
    typeof event.name === "string" &&
    typeof event.detectedAt === "number" &&
    typeof event.source === "string" &&
    typeof event.signal === "string" &&
    typeof event.reason === "string" &&
    typeof event.score === "number"
  );
}

function stableRadarEventId(
  kind: RadarEventKind,
  mint: string,
  detectedAt: number,
  suffix = ""
): string {
  if (!mint || !Number.isFinite(detectedAt)) return randomUUID();
  return [kind, mint, Math.floor(detectedAt), suffix].filter(Boolean).join(":");
}

function cleanSymbol(symbol: string, mint: string): string {
  const cleaned = symbol.trim().replace(/[^a-z0-9]/gi, "").toUpperCase();
  return cleaned || mint.slice(0, 6).toUpperCase();
}

function padreTerminalUrl(mint: string): string {
  return `https://trade.padre.gg/trade/solana/${encodeURIComponent(mint)}`;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatPercent(value: number): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function demoRadarEvents(): RadarEvent[] {
  const now = Date.now();
  const rows: Array<{
    symbol: string;
    name: string;
    caughtMcapUsd: number;
    peakMultiple: number;
    currentMultiple: number;
    score: number;
    minutesAgo: number;
    source: string;
    signal: string;
    reason: string;
  }> = [
    {
      symbol: "RELIGION",
      name: "Religion",
      caughtMcapUsd: 27_000,
      peakMultiple: 15.5,
      currentMultiple: 15.5,
      score: 94,
      minutesAgo: 6,
      source: "Breakout Radar",
      signal: "15M close breakout",
      reason: "Fresh high-volume close cleared the prior 20 candles.",
    },
    {
      symbol: "OILMAXXING",
      name: "Oilmaxxing",
      caughtMcapUsd: 25_000,
      peakMultiple: 9.22,
      currentMultiple: 8.89,
      score: 91,
      minutesAgo: 14,
      source: "New token scanner",
      signal: "Low-risk launch",
      reason: "Early holders spread cleanly with no major bundle cluster.",
    },
    {
      symbol: "UPLON",
      name: "Uplon",
      caughtMcapUsd: 103_000,
      peakMultiple: 3.97,
      currentMultiple: 2.51,
      score: 78,
      minutesAgo: 22,
      source: "Breakout Radar",
      signal: "1H live breakout",
      reason: "Active candle pushed above the close lookback with rising volume.",
    },
    {
      symbol: "POMNI",
      name: "Pomni",
      caughtMcapUsd: 86_000,
      peakMultiple: 3.63,
      currentMultiple: 2.9,
      score: 74,
      minutesAgo: 37,
      source: "New token scanner",
      signal: "Fresh launch",
      reason: "Momentum passed the holder and concentration thresholds.",
    },
    {
      symbol: "TRUAMP",
      name: "Truamp",
      caughtMcapUsd: 94_000,
      peakMultiple: 2.27,
      currentMultiple: 0.03,
      score: 42,
      minutesAgo: 58,
      source: "New token scanner",
      signal: "High-risk launch",
      reason: "The token retraced after a thin-liquidity spike.",
    },
  ];

  return rows.map((row, index) => ({
    id: `demo:${index}:${row.symbol}`,
    kind: row.source === "Breakout Radar" ? "breakout" : "new-token",
    status: row.currentMultiple >= 1 ? "active" : "risk",
    mint: `${row.symbol.toLowerCase()}DemoMint111111111111111111111pump`,
    symbol: row.symbol,
    name: row.name,
    network: "solana",
    detectedAt: now - row.minutesAgo * 60_000,
    source: row.source,
    signal: row.signal,
    reason: row.reason,
    score: row.score,
    caughtMcapUsd: row.caughtMcapUsd,
    volumeUsd: null,
    peakMultiple: row.peakMultiple,
    currentMultiple: row.currentMultiple,
    riskScore: row.source === "New token scanner" ? 100 - row.score : null,
    verdict: row.currentMultiple >= 1 ? "watch" : "avoid",
    timeframe: row.source === "Breakout Radar" ? row.signal.split(" ")[0] : null,
    breakoutPct: row.source === "Breakout Radar" ? row.peakMultiple * 2 : null,
    dailyAction: row.source === "Breakout Radar" ? "neutral" : null,
    terminalUrl: padreTerminalUrl(`${row.symbol.toLowerCase()}DemoMint111111111111111111111pump`),
    chartUrl: null,
  }));
}
