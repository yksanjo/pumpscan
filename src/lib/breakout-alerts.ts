import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface OhlcvCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BreakoutSignal {
  mint: string;
  name: string;
  symbol: string;
  network: string;
  poolAddress: string;
  poolName: string;
  timeframeMinutes: number;
  lookbackCandles: number;
  minBreakoutPct: number;
  triggerMode: BreakoutTriggerMode;
  breakoutPrice: number;
  breakoutSource: BreakoutSource;
  breakoutClose: number;
  previousLookbackClose: number;
  breakoutPct: number;
  candleOpenedAt: number;
  candleClosedAt: number;
  volumeUsd: number;
  detectedAt: number;
  dailyTrend: DailyTrendContext;
}

export interface BreakoutRuleConfig {
  timeframeMinutes: number;
  lookbackCandles: number;
  minBreakoutPct: number;
  triggerMode: BreakoutTriggerMode;
}

export type BreakoutTriggerMode = "close" | "live";
export type BreakoutSource = "close" | "high";
export type DailyTrendDirection = "downtrend" | "uptrend" | "flat" | "mixed" | "unknown";
export type DailyTrendAction = "pass" | "neutral" | "review";

export interface DailyTrendContext {
  direction: DailyTrendDirection;
  action: DailyTrendAction;
  reason: string;
  lookbackDays: number;
  changePct: number | null;
  rangePct: number | null;
  latestClose: number | null;
  shortSma: number | null;
  longSma: number | null;
}

export interface BreakoutScannerConfig {
  mints: string[];
  network: string;
  timeframeMinutes: number;
  lookbackCandles: number;
  minBreakoutPct: number;
  triggerMode: BreakoutTriggerMode;
  rules: BreakoutRuleConfig[];
  dailyTrendLookbackDays: number;
  dailyTrendMinMovePct: number;
  dailyFlatMaxRangePct: number;
  includeRecentGraduates: boolean;
  recentGraduatesPages: number;
  recentGraduatesMaxAgeMinutes: number;
  maxDynamicMints: number;
  stateFile: string;
  sourceBaseUrl: string;
  sourceMaxRetries: number;
  sourceRetryDelayMs: number;
}

interface BreakoutAlertState {
  version: 2;
  lastAlertByKey: Record<string, number>;
  lastAlertByMint?: Record<string, number>;
}

interface GeckoPool {
  address: string;
  name: string;
  reserveUsd: number;
  baseSymbol: string;
}

type FetchLike = typeof fetch;
type GeckoOhlcvUnit = "minute" | "hour" | "day";

interface MintBreakoutCandidates {
  pool: GeckoPool;
  signals: BreakoutSignal[];
}

interface ResolvedBreakoutTimeframe {
  minutes: number;
  intervalMs: number;
  unit: GeckoOhlcvUnit;
  aggregate: number;
  label: string;
}

const DEFAULT_SOURCE_BASE_URL = "https://api.geckoterminal.com/api/v2";
const DEFAULT_STATE_FILE = "data/breakout-alert-state.json";
const GECKO_ACCEPT_HEADER = "application/json;version=20230203";
const EMPTY_STATE: BreakoutAlertState = { version: 2, lastAlertByKey: {} };

export const DEFAULT_BREAKOUT_TIMEFRAME_MINUTES = 15;
export const DEFAULT_BREAKOUT_LOOKBACK_CANDLES = 20;
export const DEFAULT_BREAKOUT_MIN_PCT = 0;
export const DEFAULT_BREAKOUT_TRIGGER_MODE: BreakoutTriggerMode = "close";
export const DEFAULT_DAILY_TREND_LOOKBACK_DAYS = 120;
export const DEFAULT_DAILY_TREND_MIN_MOVE_PCT = 20;
export const DEFAULT_DAILY_FLAT_MAX_RANGE_PCT = 35;
export const DEFAULT_INCLUDE_RECENT_GRADUATES = false;
export const DEFAULT_RECENT_GRADUATES_PAGES = 1;
export const DEFAULT_RECENT_GRADUATES_MAX_AGE_MINUTES = 180;
export const DEFAULT_MAX_DYNAMIC_MINTS = 25;
export const DEFAULT_SOURCE_MAX_RETRIES = 2;
export const DEFAULT_SOURCE_RETRY_DELAY_MS = 1_000;
const CLOSE_CONFIRMED_TIMEFRAMES = new Set([15]);

export class BreakoutAlertScanner {
  private readonly config: BreakoutScannerConfig;
  private readonly fetchImpl: FetchLike;
  private readonly poolCache = new Map<string, GeckoPool>();

  constructor(
    config: Partial<BreakoutScannerConfig> & { mints: string[] },
    fetchImpl: FetchLike = fetch
  ) {
    const mergedConfig = {
      network: "solana",
      timeframeMinutes: DEFAULT_BREAKOUT_TIMEFRAME_MINUTES,
      lookbackCandles: DEFAULT_BREAKOUT_LOOKBACK_CANDLES,
      minBreakoutPct: DEFAULT_BREAKOUT_MIN_PCT,
      triggerMode: DEFAULT_BREAKOUT_TRIGGER_MODE,
      rules: [],
      dailyTrendLookbackDays: DEFAULT_DAILY_TREND_LOOKBACK_DAYS,
      dailyTrendMinMovePct: DEFAULT_DAILY_TREND_MIN_MOVE_PCT,
      dailyFlatMaxRangePct: DEFAULT_DAILY_FLAT_MAX_RANGE_PCT,
      includeRecentGraduates: DEFAULT_INCLUDE_RECENT_GRADUATES,
      recentGraduatesPages: DEFAULT_RECENT_GRADUATES_PAGES,
      recentGraduatesMaxAgeMinutes: DEFAULT_RECENT_GRADUATES_MAX_AGE_MINUTES,
      maxDynamicMints: DEFAULT_MAX_DYNAMIC_MINTS,
      stateFile: DEFAULT_STATE_FILE,
      sourceBaseUrl: DEFAULT_SOURCE_BASE_URL,
      sourceMaxRetries: DEFAULT_SOURCE_MAX_RETRIES,
      sourceRetryDelayMs: DEFAULT_SOURCE_RETRY_DELAY_MS,
      ...config,
      mints: dedupeMints(config.mints),
    };
    const fallbackRule = normalizeBreakoutRule({
      timeframeMinutes: mergedConfig.timeframeMinutes,
      lookbackCandles: mergedConfig.lookbackCandles,
      minBreakoutPct: mergedConfig.minBreakoutPct,
      triggerMode: mergedConfig.triggerMode,
    });
    const rules = normalizeBreakoutRules(config.rules, fallbackRule);
    this.config = {
      ...mergedConfig,
      ...fallbackRule,
      rules,
      triggerMode: fallbackRule.triggerMode,
      recentGraduatesPages: Math.max(1, Math.floor(mergedConfig.recentGraduatesPages)),
      recentGraduatesMaxAgeMinutes: Math.max(
        1,
        Math.floor(mergedConfig.recentGraduatesMaxAgeMinutes)
      ),
      maxDynamicMints: Math.max(0, Math.floor(mergedConfig.maxDynamicMints)),
      sourceMaxRetries: Math.max(0, Math.floor(mergedConfig.sourceMaxRetries)),
      sourceRetryDelayMs: Math.max(0, Math.floor(mergedConfig.sourceRetryDelayMs)),
    };
    this.fetchImpl = fetchImpl;
  }

  getConfig(): BreakoutScannerConfig {
    return {
      ...this.config,
      mints: [...this.config.mints],
      rules: this.config.rules.map((rule) => ({ ...rule })),
    };
  }

  async checkAll(nowMs = Date.now()): Promise<BreakoutSignal[]> {
    const watchMints = await this.resolveWatchMints();
    if (watchMints.length === 0) return [];

    const state = await this.readState();
    const signals: BreakoutSignal[] = [];
    let stateChanged = false;

    for (const mint of watchMints) {
      try {
        const { pool, signals: mintSignals } = await this.checkMint(mint, nowMs);
        const unalertedSignals: BreakoutSignal[] = [];

        for (const signal of mintSignals) {
          const alertKey = this.alertStateKey(mint, signal);
          const lastAlertedCandle = state.lastAlertByKey[alertKey];
          if (lastAlertedCandle === signal.candleOpenedAt) continue;
          unalertedSignals.push(signal);
        }

        if (unalertedSignals.length === 0) continue;

        const dailyTrend = await this.fetchDailyTrend(mint, pool.address, nowMs);
        for (const signal of unalertedSignals) {
          const enrichedSignal = { ...signal, dailyTrend };
          const alertKey = this.alertStateKey(mint, signal);
          signals.push(enrichedSignal);
          state.lastAlertByKey[alertKey] = signal.candleOpenedAt;
          stateChanged = true;
        }
      } catch (err) {
        console.error(`[Breakout] ${mint.slice(0, 8)}... check failed:`, err);
      }
    }

    if (stateChanged) {
      await this.writeState(state);
    }

    return signals;
  }

  private async checkMint(mint: string, nowMs: number): Promise<MintBreakoutCandidates> {
    const pool = await this.findTopPool(mint);
    const signals: BreakoutSignal[] = [];

    for (const group of groupBreakoutRulesByTimeframe(this.config.rules)) {
      const candles = await this.fetchBreakoutCandles(
        mint,
        pool.address,
        group.timeframeMinutes,
        group.lookbackCandles + 3,
        nowMs,
        group.includeLiveCandle
      );

      for (const rule of group.rules) {
        const signal = evaluateBreakout({
          mint,
          name: pool.name,
          symbol: pool.baseSymbol || mint.slice(0, 6),
          network: this.config.network,
          poolAddress: pool.address,
          poolName: pool.name,
          candles,
          timeframeMinutes: rule.timeframeMinutes,
          lookbackCandles: rule.lookbackCandles,
          minBreakoutPct: rule.minBreakoutPct,
          triggerMode: rule.triggerMode,
          nowMs,
        });
        if (signal) signals.push(signal);
      }
    }

    return { pool, signals };
  }

  private async resolveWatchMints(): Promise<string[]> {
    if (!this.config.includeRecentGraduates || this.config.maxDynamicMints === 0) {
      return [...this.config.mints];
    }

    try {
      const recentGraduates = await this.fetchRecentGraduateMints();
      return dedupeMints([...this.config.mints, ...recentGraduates]);
    } catch (err) {
      console.error("[Breakout] Recent graduate discovery failed:", err);
      return [...this.config.mints];
    }
  }

  private async fetchRecentGraduateMints(): Promise<string[]> {
    const found: string[] = [];
    const cutoffMs = Date.now() - this.config.recentGraduatesMaxAgeMinutes * 60_000;

    for (let page = 1; page <= this.config.recentGraduatesPages; page += 1) {
      const url = new URL(`${this.config.sourceBaseUrl}/networks/${this.config.network}/new_pools`);
      url.searchParams.set("include", "base_token,quote_token,dex");
      url.searchParams.set("page", String(page));

      const payload = await this.fetchJson<GeckoPoolsResponse>(url);
      for (const pool of payload.data ?? []) {
        const attrs = pool.attributes ?? {};
        const poolCreatedAt = parseTimestampMs(attrs.pool_created_at);
        if (poolCreatedAt !== null && poolCreatedAt < cutoffMs) continue;

        const baseTokenId = pool.relationships?.base_token?.data?.id;
        const quoteTokenId = pool.relationships?.quote_token?.data?.id;
        const baseMint = tokenAddress(payload.included, baseTokenId);
        const quoteMint = tokenAddress(payload.included, quoteTokenId);
        const mint = isPumpFunMint(baseMint) ? baseMint : quoteMint;
        const tokenId = mint === baseMint ? baseTokenId : quoteTokenId;
        if (!isPumpFunMint(mint)) continue;

        this.poolCache.set(mint, {
          address: attrs.address || pool.id.replace(`${this.config.network}_`, ""),
          name: attrs.name || attrs.pool_name || mint.slice(0, 6),
          reserveUsd: Number(attrs.reserve_in_usd ?? 0),
          baseSymbol: tokenSymbol(payload.included, tokenId),
        });
        found.push(mint);

        if (found.length >= this.config.maxDynamicMints) {
          return dedupeMints(found);
        }
      }
    }

    return dedupeMints(found);
  }

  private async findTopPool(mint: string): Promise<GeckoPool> {
    const cached = this.poolCache.get(mint);
    if (cached) return cached;

    const url = new URL(
      `${this.config.sourceBaseUrl}/networks/${this.config.network}/tokens/${mint}/pools`
    );
    url.searchParams.set("include", "base_token,quote_token");
    url.searchParams.set("page", "1");
    url.searchParams.set("sort", "h24_volume_usd_liquidity_desc");

    const payload = await this.fetchJson<GeckoPoolsResponse>(url);
    const pools = (payload.data ?? [])
      .map((pool) => {
        const attrs = pool.attributes ?? {};
        return {
          address: attrs.address || pool.id.replace(`${this.config.network}_`, ""),
          name: attrs.name || attrs.pool_name || mint.slice(0, 6),
          reserveUsd: Number(attrs.reserve_in_usd ?? 0),
          baseSymbol: tokenSymbol(payload.included, pool.relationships?.base_token?.data?.id),
        };
      })
      .filter((pool): pool is GeckoPool => Boolean(pool.address))
      .sort((a, b) => b.reserveUsd - a.reserveUsd);

    const pool = pools[0];
    if (!pool) {
      throw new Error("No GeckoTerminal pool found for token.");
    }

    this.poolCache.set(mint, pool);
    return pool;
  }

  private async fetchBreakoutCandles(
    mint: string,
    poolAddress: string,
    timeframeMinutes: number,
    limitCandles: number,
    nowMs: number,
    includeLiveCandle: boolean
  ): Promise<OhlcvCandle[]> {
    const timeframe = resolveBreakoutTimeframe(timeframeMinutes);
    const intervalSeconds = timeframe.minutes * 60;
    const currentIntervalStart = Math.floor(nowMs / 1000 / intervalSeconds) * intervalSeconds;
    const beforeTimestamp = includeLiveCandle
      ? currentIntervalStart + intervalSeconds
      : currentIntervalStart;
    const url = new URL(
      `${this.config.sourceBaseUrl}/networks/${this.config.network}/pools/${poolAddress}/ohlcv/${timeframe.unit}`
    );
    url.searchParams.set("aggregate", String(timeframe.aggregate));
    url.searchParams.set("before_timestamp", String(beforeTimestamp));
    url.searchParams.set("limit", String(limitCandles));
    url.searchParams.set("currency", "usd");
    url.searchParams.set("token", mint);
    url.searchParams.set("include_empty_intervals", "false");

    const payload = await this.fetchJson<GeckoOhlcvResponse>(url);
    return normalizeOhlcvList(payload.data?.attributes?.ohlcv_list ?? []);
  }

  private async fetchDailyTrend(
    mint: string,
    poolAddress: string,
    nowMs: number
  ): Promise<DailyTrendContext> {
    try {
      const currentDayStart = Math.floor(nowMs / 1000 / 86_400) * 86_400;
      const url = new URL(
        `${this.config.sourceBaseUrl}/networks/${this.config.network}/pools/${poolAddress}/ohlcv/day`
      );
      url.searchParams.set("aggregate", "1");
      url.searchParams.set("before_timestamp", String(currentDayStart));
      url.searchParams.set("limit", String(this.config.dailyTrendLookbackDays + 3));
      url.searchParams.set("currency", "usd");
      url.searchParams.set("token", mint);
      url.searchParams.set("include_empty_intervals", "false");

      const payload = await this.fetchJson<GeckoOhlcvResponse>(url);
      return evaluateDailyTrendContext(normalizeOhlcvList(payload.data?.attributes?.ohlcv_list ?? []), {
        lookbackDays: this.config.dailyTrendLookbackDays,
        minTrendMovePct: this.config.dailyTrendMinMovePct,
        flatMaxRangePct: this.config.dailyFlatMaxRangePct,
        nowMs,
      });
    } catch (err) {
      return unknownDailyTrend(
        `Daily chart unavailable: ${err instanceof Error ? err.message : "fetch failed"}`
      );
    }
  }

  private async fetchJson<T>(url: URL): Promise<T> {
    for (let attempt = 0; attempt <= this.config.sourceMaxRetries; attempt += 1) {
      const res = await this.fetchImpl(url, {
        headers: { Accept: GECKO_ACCEPT_HEADER },
      });
      if (res.ok) {
        return (await res.json()) as T;
      }

      if (attempt >= this.config.sourceMaxRetries || !isRetryableHttpStatus(res.status)) {
        throw new Error(`GeckoTerminal returned ${res.status} for ${url.pathname}`);
      }

      const retryAfterMs = retryAfterHeaderMs(res.headers.get("retry-after"));
      const delayMs = retryAfterMs ?? this.config.sourceRetryDelayMs * 2 ** attempt;
      if (delayMs > 0) await delay(delayMs);
    }

    throw new Error(`GeckoTerminal request failed for ${url.pathname}`);
  }

  private async readState(): Promise<BreakoutAlertState> {
    try {
      const raw = await readFile(/* turbopackIgnore: true */ this.config.stateFile, "utf8");
      const parsed = JSON.parse(raw) as Partial<BreakoutAlertState>;
      const lastAlertByKey = { ...(parsed.lastAlertByKey ?? {}) };
      for (const [mint, candleOpenedAt] of Object.entries(parsed.lastAlertByMint ?? {})) {
        lastAlertByKey[this.alertStateKey(mint, this.config.rules[0])] ??= candleOpenedAt;
      }
      return {
        version: 2,
        lastAlertByKey,
      };
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        return { ...EMPTY_STATE, lastAlertByKey: {} };
      }
      throw err;
    }
  }

  private async writeState(state: BreakoutAlertState): Promise<void> {
    const file = this.config.stateFile;
    await mkdir(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(
      /* turbopackIgnore: true */ tmp,
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8"
    );
    await rename(/* turbopackIgnore: true */ tmp, file);
  }

  private alertStateKey(mint: string, rule: BreakoutRuleConfig): string {
    return [
      this.config.network,
      mint,
      formatBreakoutTimeframe(rule.timeframeMinutes),
      `${rule.lookbackCandles}c`,
      `${rule.minBreakoutPct}%`,
    ].join(":");
  }
}

export function parseBreakoutWatchMints(
  value: string | undefined,
  fallbackMints: string[] = []
): string[] {
  const configured = value
    ?.split(/[\s,]+/)
    .map((mint) => mint.trim())
    .filter(Boolean);
  return dedupeMints(configured?.length ? configured : fallbackMints);
}

export function parseBreakoutTimeframeMinutes(
  value: string | undefined,
  fallbackMinutes = DEFAULT_BREAKOUT_TIMEFRAME_MINUTES
): number {
  const raw = value?.trim().toLowerCase();
  if (!raw) return fallbackMinutes;

  const match = raw.match(/^(\d+)\s*([mhd])?$/);
  if (!match) return fallbackMinutes;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return fallbackMinutes;

  const unit = match[2] ?? "m";
  if (unit === "d") return amount * 24 * 60;
  if (unit === "h") return amount * 60;
  return amount;
}

export function parseBreakoutTriggerMode(
  value: string | undefined,
  fallback: BreakoutTriggerMode = DEFAULT_BREAKOUT_TRIGGER_MODE
): BreakoutTriggerMode {
  const raw = value?.trim().toLowerCase();
  if (raw === "live" || raw === "intracandle" || raw === "high") return "live";
  if (raw === "close" || raw === "closed") return "close";
  return fallback;
}

export function formatBreakoutTimeframe(timeframeMinutes: number): string {
  return resolveBreakoutTimeframe(timeframeMinutes).label;
}

export function parseBreakoutRules(
  value: string | undefined,
  fallbackRule: BreakoutRuleConfig = {
    timeframeMinutes: DEFAULT_BREAKOUT_TIMEFRAME_MINUTES,
    lookbackCandles: DEFAULT_BREAKOUT_LOOKBACK_CANDLES,
    minBreakoutPct: DEFAULT_BREAKOUT_MIN_PCT,
    triggerMode: DEFAULT_BREAKOUT_TRIGGER_MODE,
  }
): BreakoutRuleConfig[] {
  const fallback = normalizeBreakoutRule(fallbackRule);
  const raw = value?.trim();
  if (!raw) return [fallback];

  const parsedRules = raw
    .split(/[,\s;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => parseBreakoutRule(part, fallback));

  return normalizeBreakoutRules(parsedRules, fallback);
}

export function evaluateBreakout(input: {
  mint: string;
  name: string;
  symbol: string;
  network: string;
  poolAddress: string;
  poolName: string;
  candles: OhlcvCandle[];
  timeframeMinutes: number;
  lookbackCandles: number;
  minBreakoutPct?: number;
  triggerMode?: BreakoutTriggerMode;
  nowMs?: number;
}): BreakoutSignal | null {
  const nowMs = input.nowMs ?? Date.now();
  const timeframe = resolveBreakoutTimeframe(input.timeframeMinutes);
  const timeframeMinutes = timeframe.minutes;
  const lookbackCandles = Math.max(1, Math.floor(input.lookbackCandles));
  const minBreakoutPct = input.minBreakoutPct ?? 0;
  const triggerMode = normalizeTriggerModeForTimeframe(
    timeframeMinutes,
    input.triggerMode ?? DEFAULT_BREAKOUT_TRIGGER_MODE
  );
  const intervalMs = timeframe.intervalMs;
  const sortedCandles = input.candles
    .filter((candle) => candle.timestamp <= nowMs)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (sortedCandles.length < lookbackCandles + 1) {
    return null;
  }

  const closedCandles = sortedCandles.filter((candle) =>
    isClosedCandle(candle, intervalMs, nowMs)
  );
  const liveCandle = sortedCandles
    .filter((candle) => candle.timestamp <= nowMs && candle.timestamp + intervalMs > nowMs)
    .at(-1);
  const signalCandle =
    triggerMode === "live" && liveCandle ? liveCandle : closedCandles.at(-1);

  if (!signalCandle) return null;

  const lookback = sortedCandles
    .filter((candle) => candle.timestamp + intervalMs <= signalCandle.timestamp)
    .slice(-lookbackCandles);

  if (lookback.length < lookbackCandles) {
    return null;
  }

  const previousLookbackClose = Math.max(...lookback.map((candle) => candle.close));
  if (!Number.isFinite(previousLookbackClose) || previousLookbackClose <= 0) {
    return null;
  }

  const isLiveSignal = !isClosedCandle(signalCandle, intervalMs, nowMs);
  const signalTriggerMode: BreakoutTriggerMode =
    triggerMode === "live" && isLiveSignal ? "live" : "close";
  const breakoutSource: BreakoutSource =
    triggerMode === "live" && isLiveSignal && signalCandle.high > signalCandle.close
      ? "high"
      : "close";
  const breakoutPrice = breakoutSource === "high" ? signalCandle.high : signalCandle.close;
  const breakoutPct = ((breakoutPrice - previousLookbackClose) / previousLookbackClose) * 100;
  if (breakoutPrice <= previousLookbackClose || breakoutPct < minBreakoutPct) {
    return null;
  }

  return {
    mint: input.mint,
    name: input.name,
    symbol: input.symbol,
    network: input.network,
    poolAddress: input.poolAddress,
    poolName: input.poolName,
    timeframeMinutes,
    lookbackCandles,
    minBreakoutPct,
    triggerMode: signalTriggerMode,
    breakoutPrice,
    breakoutSource,
    breakoutClose: signalCandle.close,
    previousLookbackClose,
    breakoutPct,
    candleOpenedAt: signalCandle.timestamp,
    candleClosedAt: signalCandle.timestamp + intervalMs,
    volumeUsd: signalCandle.volume,
    detectedAt: nowMs,
    dailyTrend: unknownDailyTrend("Daily chart context not checked."),
  };
}

export function evaluateCloseBreakout(input: {
  mint: string;
  name: string;
  symbol: string;
  network: string;
  poolAddress: string;
  poolName: string;
  candles: OhlcvCandle[];
  timeframeMinutes: number;
  lookbackCandles: number;
  minBreakoutPct?: number;
  nowMs?: number;
}): BreakoutSignal | null {
  return evaluateBreakout({ ...input, triggerMode: "close" });
}

export function evaluateDailyTrendContext(
  candles: OhlcvCandle[],
  opts: {
    lookbackDays?: number;
    minTrendMovePct?: number;
    flatMaxRangePct?: number;
    nowMs?: number;
  } = {}
): DailyTrendContext {
  const lookbackDays = Math.max(30, Math.floor(opts.lookbackDays ?? DEFAULT_DAILY_TREND_LOOKBACK_DAYS));
  const minTrendMovePct = Math.max(0, opts.minTrendMovePct ?? DEFAULT_DAILY_TREND_MIN_MOVE_PCT);
  const flatMaxRangePct = Math.max(0, opts.flatMaxRangePct ?? DEFAULT_DAILY_FLAT_MAX_RANGE_PCT);
  const dayMs = 86_400_000;
  const nowMs = opts.nowMs ?? Date.now();
  const closedCandles = candles
    .filter((candle) => isClosedCandle(candle, dayMs, nowMs))
    .sort((a, b) => a.timestamp - b.timestamp);
  const lookback = closedCandles.slice(-lookbackDays);

  if (lookback.length < Math.min(30, lookbackDays)) {
    return unknownDailyTrend("Not enough closed daily candles for trend context.");
  }

  const first = lookback[0];
  const latest = lookback[lookback.length - 1];
  const closes = lookback.map((candle) => candle.close);
  const highestClose = Math.max(...closes);
  const lowestClose = Math.min(...closes);
  const changePct = percentChange(first.close, latest.close);
  const rangePct = lowestClose > 0 ? ((highestClose - lowestClose) / lowestClose) * 100 : null;
  const shortSma = average(closes.slice(-Math.min(20, closes.length)));
  const longSma = average(closes.slice(-Math.min(60, closes.length)));

  if (
    changePct <= -minTrendMovePct &&
    latest.close < longSma &&
    shortSma <= longSma
  ) {
    return {
      direction: "downtrend",
      action: "pass",
      reason: `Daily downtrend: close is ${changePct.toFixed(1)}% over ${lookback.length}D and 20D avg is below 60D avg.`,
      lookbackDays: lookback.length,
      changePct,
      rangePct,
      latestClose: latest.close,
      shortSma,
      longSma,
    };
  }

  if (
    changePct >= minTrendMovePct &&
    latest.close > longSma &&
    shortSma >= longSma
  ) {
    return {
      direction: "uptrend",
      action: "neutral",
      reason: `Daily uptrend: close is +${changePct.toFixed(1)}% over ${lookback.length}D and 20D avg is above 60D avg.`,
      lookbackDays: lookback.length,
      changePct,
      rangePct,
      latestClose: latest.close,
      shortSma,
      longSma,
    };
  }

  if (
    lookback.length >= 60 &&
    Math.abs(changePct) <= minTrendMovePct &&
    rangePct !== null &&
    rangePct <= flatMaxRangePct
  ) {
    return {
      direction: "flat",
      action: "review",
      reason: `Flat daily chart: ${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}% over ${lookback.length}D inside a ${rangePct.toFixed(1)}% close range. Open chart and look for a reason to buy.`,
      lookbackDays: lookback.length,
      changePct,
      rangePct,
      latestClose: latest.close,
      shortSma,
      longSma,
    };
  }

  return {
    direction: "mixed",
    action: "neutral",
    reason: `Mixed daily chart: ${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}% over ${lookback.length}D with no clean trend gate.`,
    lookbackDays: lookback.length,
    changePct,
    rangePct,
    latestClose: latest.close,
    shortSma,
    longSma,
  };
}

export function normalizeOhlcvList(rows: unknown[]): OhlcvCandle[] {
  return rows
    .map((row) => {
      if (!Array.isArray(row) || row.length < 6) return null;
      const [timestamp, open, high, low, close, volume] = row.map(Number);
      const candle = { timestamp: timestamp * 1000, open, high, low, close, volume };
      return Object.values(candle).every(Number.isFinite) ? candle : null;
    })
    .filter((candle): candle is OhlcvCandle => Boolean(candle))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function resolveBreakoutTimeframe(timeframeMinutes: number): ResolvedBreakoutTimeframe {
  const minutes = Math.max(1, Math.floor(timeframeMinutes));
  const intervalMs = minutes * 60 * 1000;

  if (minutes % 1440 === 0) {
    const aggregate = minutes / 1440;
    return {
      minutes,
      intervalMs,
      unit: "day",
      aggregate,
      label: aggregate === 1 ? "1D" : `${aggregate}D`,
    };
  }

  if (minutes % 60 === 0) {
    const aggregate = minutes / 60;
    return {
      minutes,
      intervalMs,
      unit: "hour",
      aggregate,
      label: aggregate === 1 ? "1H" : `${aggregate}H`,
    };
  }

  return {
    minutes,
    intervalMs,
    unit: "minute",
    aggregate: minutes,
    label: `${minutes}M`,
  };
}

function parseBreakoutRule(value: string, fallback: BreakoutRuleConfig): BreakoutRuleConfig {
  const [timeframeRaw, lookbackRaw, thirdRaw, fourthRaw] = value.split(":");
  const thirdIsTrigger = isBreakoutTriggerModeRaw(thirdRaw);
  const minBreakoutPctRaw = thirdIsTrigger ? undefined : thirdRaw;
  const triggerModeRaw = thirdIsTrigger ? thirdRaw : fourthRaw;

  return normalizeBreakoutRule(
    {
      timeframeMinutes: parseBreakoutTimeframeMinutes(timeframeRaw, fallback.timeframeMinutes),
      lookbackCandles:
        lookbackRaw === undefined ? fallback.lookbackCandles : Number(lookbackRaw),
      minBreakoutPct:
        minBreakoutPctRaw === undefined ? fallback.minBreakoutPct : Number(minBreakoutPctRaw),
      triggerMode: parseBreakoutTriggerMode(triggerModeRaw, fallback.triggerMode),
    },
    fallback
  );
}

function normalizeBreakoutRules(
  rules: BreakoutRuleConfig[] | undefined,
  fallbackRule: BreakoutRuleConfig
): BreakoutRuleConfig[] {
  const normalized = (rules?.length ? rules : [fallbackRule]).map((rule) =>
    normalizeBreakoutRule(rule, fallbackRule)
  );
  const uniqueRules = new Map<string, BreakoutRuleConfig>();

  for (const rule of normalized) {
    uniqueRules.set(breakoutRuleKey(rule), rule);
  }

  return Array.from(uniqueRules.values()).sort((a, b) => {
    if (a.timeframeMinutes !== b.timeframeMinutes) return a.timeframeMinutes - b.timeframeMinutes;
    if (a.lookbackCandles !== b.lookbackCandles) return a.lookbackCandles - b.lookbackCandles;
    return a.minBreakoutPct - b.minBreakoutPct;
  });
}

function normalizeBreakoutRule(
  rule: Partial<BreakoutRuleConfig>,
  fallbackRule: BreakoutRuleConfig = {
    timeframeMinutes: DEFAULT_BREAKOUT_TIMEFRAME_MINUTES,
    lookbackCandles: DEFAULT_BREAKOUT_LOOKBACK_CANDLES,
    minBreakoutPct: DEFAULT_BREAKOUT_MIN_PCT,
    triggerMode: DEFAULT_BREAKOUT_TRIGGER_MODE,
  }
): BreakoutRuleConfig {
  const timeframeMinutes = Number.isFinite(rule.timeframeMinutes)
    ? Number(rule.timeframeMinutes)
    : fallbackRule.timeframeMinutes;
  const lookbackCandles = Number.isFinite(rule.lookbackCandles)
    ? Number(rule.lookbackCandles)
    : fallbackRule.lookbackCandles;
  const minBreakoutPct = Number.isFinite(rule.minBreakoutPct)
    ? Number(rule.minBreakoutPct)
    : fallbackRule.minBreakoutPct;
  const resolvedTimeframe = resolveBreakoutTimeframe(timeframeMinutes);
  const triggerMode = normalizeTriggerModeForTimeframe(
    resolvedTimeframe.minutes,
    parseBreakoutTriggerMode(rule.triggerMode, fallbackRule.triggerMode)
  );

  return {
    timeframeMinutes: resolvedTimeframe.minutes,
    lookbackCandles: Math.max(1, Math.floor(lookbackCandles)),
    minBreakoutPct: Math.max(0, minBreakoutPct),
    triggerMode,
  };
}

function normalizeTriggerModeForTimeframe(
  timeframeMinutes: number,
  triggerMode: BreakoutTriggerMode
): BreakoutTriggerMode {
  // 15m alerts are intentionally close-confirmed to avoid wick-only alerts.
  return CLOSE_CONFIRMED_TIMEFRAMES.has(timeframeMinutes) ? "close" : triggerMode;
}

function groupBreakoutRulesByTimeframe(rules: BreakoutRuleConfig[]): Array<{
  timeframeMinutes: number;
  lookbackCandles: number;
  includeLiveCandle: boolean;
  rules: BreakoutRuleConfig[];
}> {
  const groups = new Map<number, BreakoutRuleConfig[]>();

  for (const rule of rules) {
    const groupedRules = groups.get(rule.timeframeMinutes) ?? [];
    groupedRules.push(rule);
    groups.set(rule.timeframeMinutes, groupedRules);
  }

  return Array.from(groups.entries()).map(([timeframeMinutes, groupedRules]) => ({
    timeframeMinutes,
    lookbackCandles: Math.max(...groupedRules.map((rule) => rule.lookbackCandles)),
    includeLiveCandle: groupedRules.some((rule) => rule.triggerMode === "live"),
    rules: groupedRules,
  }));
}

function breakoutRuleKey(rule: BreakoutRuleConfig): string {
  return [
    formatBreakoutTimeframe(rule.timeframeMinutes),
    `${rule.lookbackCandles}c`,
    `${rule.minBreakoutPct}%`,
    rule.triggerMode,
  ].join(":");
}

function isClosedCandle(candle: OhlcvCandle, intervalMs: number, nowMs: number): boolean {
  return candle.timestamp + intervalMs <= nowMs;
}

function isBreakoutTriggerModeRaw(value: string | undefined): boolean {
  return value !== undefined && parseBreakoutTriggerMode(value, "close") !== "close"
    ? true
    : value?.trim().toLowerCase() === "close" || value?.trim().toLowerCase() === "closed";
}

function isRetryableHttpStatus(status: number): boolean {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

function retryAfterHeaderMs(value: string | null): number | null {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const dateMs = new Date(value).getTime();
  if (!Number.isFinite(dateMs)) return null;

  return Math.max(0, dateMs - Date.now());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unknownDailyTrend(reason: string): DailyTrendContext {
  return {
    direction: "unknown",
    action: "neutral",
    reason,
    lookbackDays: 0,
    changePct: null,
    rangePct: null,
    latestClose: null,
    shortSma: null,
    longSma: null,
  };
}

function percentChange(from: number, to: number): number {
  return from > 0 ? ((to - from) / from) * 100 : 0;
}

function average(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function dedupeMints(mints: string[]): string[] {
  return Array.from(new Set(mints.map((mint) => mint.trim()).filter(Boolean)));
}

function isPumpFunMint(mint: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}pump$/.test(mint);
}

function parseTimestampMs(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function tokenAddress(
  included: GeckoIncludedResource[] | undefined,
  tokenId: string | undefined
): string {
  if (!tokenId) return "";
  const resource = included?.find((item) => item.id === tokenId);
  const address = resource?.attributes?.address;
  if (address) return address;

  const separatorIndex = tokenId.indexOf("_");
  return separatorIndex >= 0 ? tokenId.slice(separatorIndex + 1) : tokenId;
}

function tokenSymbol(
  included: GeckoIncludedResource[] | undefined,
  tokenId: string | undefined
): string {
  if (!tokenId) return "";
  const resource = included?.find((item) => item.id === tokenId);
  return resource?.attributes?.symbol ?? "";
}

interface GeckoPoolsResponse {
  data?: Array<{
    id: string;
    attributes?: {
      address?: string;
      name?: string;
      pool_name?: string;
      pool_created_at?: string;
      reserve_in_usd?: string;
    };
    relationships?: {
      base_token?: { data?: { id?: string } };
      quote_token?: { data?: { id?: string } };
      dex?: { data?: { id?: string } };
    };
  }>;
  included?: GeckoIncludedResource[];
}

interface GeckoIncludedResource {
  id: string;
  attributes?: {
    address?: string;
    symbol?: string;
  };
}

interface GeckoOhlcvResponse {
  data?: {
    attributes?: {
      ohlcv_list?: unknown[];
    };
  };
}
