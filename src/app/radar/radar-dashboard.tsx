"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  BellRing,
  ChevronRight,
  Clock3,
  ExternalLink,
  Radar,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { RadarEvent, RadarSnapshot } from "@/lib/radar-events";

type RadarFilter = "all" | "active" | "breakout" | "launch" | "risk";

const FILTERS: Array<{ id: RadarFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "breakout", label: "Breakouts" },
  { id: "launch", label: "Launches" },
  { id: "risk", label: "Risk" },
];

export default function RadarDashboard({ snapshot }: { snapshot: RadarSnapshot }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filter = normalizeFilter(searchParams.get("filter"));
  const query = searchParams.get("q") ?? "";

  const filteredEvents = useMemo(
    () =>
      snapshot.events.filter((event) => {
        if (filter === "active" && !isActiveEvent(event)) return false;
        if (filter === "breakout" && event.kind !== "breakout") return false;
        if (filter === "launch" && event.kind !== "new-token") return false;
        if (filter === "risk" && event.status !== "risk") return false;
        if (!query.trim()) return true;

        const haystack = [event.symbol, event.name, event.mint, event.source, event.signal]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query.trim().toLowerCase());
      }),
    [filter, query, snapshot.events]
  );

  const stats = useMemo(() => buildStats(snapshot.events), [snapshot.events]);

  function updateSearch(next: { filter?: RadarFilter; q?: string }) {
    const params = new URLSearchParams(searchParams.toString());

    if (next.filter !== undefined) {
      if (next.filter === "all") params.delete("filter");
      else params.set("filter", next.filter);
    }

    if (next.q !== undefined) {
      if (next.q.trim()) params.set("q", next.q);
      else params.delete("q");
    }

    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5">
      <header className="rounded-lg border border-border bg-background/90 p-4 backdrop-blur sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex min-h-8 items-center gap-2 rounded-md border border-emerald/30 bg-emerald/10 px-2.5 py-1 text-xs font-medium text-emerald">
                <Radar className="size-4" aria-hidden="true" />
                Radar
              </span>
              <span className={sourceBadgeClass(snapshot.source)}>
                {sourceLabel(snapshot.source)}
              </span>
              <span className="inline-flex min-h-8 items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                <Clock3 className="size-4" aria-hidden="true" />
                {formatTimestamp(snapshot.generatedAt)}
              </span>
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Market Radar
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Scanner finds, breakout signals, caught market caps, and live multiples in one dashboard.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-100 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Analyze token
            </Link>
            <Link
              href="/leaderboard"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-100 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Collectors
            </Link>
            <Link
              href="/#telegram-alerts"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-[opacity,transform] duration-100 ease-out hover:opacity-90 active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <BellRing className="size-4" aria-hidden="true" />
              Alerts
            </Link>
          </div>
        </div>

        {snapshot.source === "demo" && (
          <div className="mt-4 rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm leading-6 text-foreground">
            Demo snapshot shown until the scanner writes <span className="font-mono">{snapshot.eventsFile}</span>.
          </div>
        )}

        {snapshot.error && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-red/30 bg-red/10 px-3 py-2 text-sm text-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red" aria-hidden="true" />
            <p>{snapshot.error}</p>
          </div>
        )}
      </header>

      <section className="grid gap-3 md:grid-cols-4" aria-label="Radar summary">
        <StatCard icon={Activity} label="Tracked" value={stats.total.toLocaleString()} detail="signals in log" />
        <StatCard icon={TrendingUp} label="Active" value={stats.active.toLocaleString()} detail="not marked risk" tone="good" />
        <StatCard icon={ShieldAlert} label="Risk" value={stats.risk.toLocaleString()} detail="flagged by scanner" tone="bad" />
        <StatCard icon={Radar} label="Avg Score" value={stats.avgScore.toString()} detail="signal quality" tone="accent" />
      </section>

      <section className="rounded-lg border border-border bg-background/90 p-3 backdrop-blur" aria-label="Radar filters">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={filter === item.id}
                onClick={() => updateSearch({ filter: item.id })}
                className={[
                  "inline-flex min-h-10 items-center justify-center rounded-md border px-3 py-2 text-sm font-medium transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  filter === item.id
                    ? "border-accent bg-accent text-white"
                    : "border-border text-foreground hover:bg-muted",
                ].join(" ")}
              >
                {item.label}
              </button>
            ))}
          </div>

          <label className="relative block w-full lg:max-w-sm">
            <span className="sr-only">Search radar</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => updateSearch({ q: event.target.value })}
              placeholder="Search token, mint, signal"
              autoComplete="off"
              spellCheck={false}
              className="min-h-10 w-full rounded-md border border-border bg-muted py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </label>
        </div>
      </section>

      {filteredEvents.length === 0 ? (
        <EmptyState hasEvents={snapshot.events.length > 0} />
      ) : (
        <section className="space-y-3" aria-label="Radar signals">
          <div className="hidden grid-cols-[minmax(190px,1fr)_150px_160px_110px_110px_120px_44px] gap-3 px-3 text-xs font-medium uppercase text-muted-foreground lg:grid">
            <span>Token</span>
            <span>Signal</span>
            <span>Caught</span>
            <span className="text-right">Peak</span>
            <span className="text-right">Now</span>
            <span className="text-right">Score</span>
            <span className="sr-only">Open</span>
          </div>
          {filteredEvents.map((event, index) => (
            <RadarRow key={event.id} event={event} rank={index + 1} />
          ))}
        </section>
      )}

      <footer className="pb-6 text-center text-xs leading-5 text-muted-foreground">
        Informational only. Radar signals are scanner output, not financial advice.
      </footer>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "neutral",
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "good" | "bad" | "accent";
}) {
  const toneClass =
    tone === "good"
      ? "border-emerald/30 bg-emerald/10 text-emerald"
      : tone === "bad"
        ? "border-red/30 bg-red/10 text-red"
        : tone === "accent"
          ? "border-accent/30 bg-accent/10 text-foreground"
          : "border-border bg-muted text-muted-foreground";

  return (
    <div className="rounded-lg border border-border bg-background/90 p-4 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className={["flex size-9 items-center justify-center rounded-md border", toneClass].join(" ")}>
          <Icon className="size-4" aria-hidden="true" />
        </div>
      </div>
      <p className="mt-3 font-mono text-3xl font-semibold tabular-nums text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function RadarRow({ event, rank }: { event: RadarEvent; rank: number }) {
  const currentMultiple = event.currentMultiple;
  const hasCurrentMultiple =
    currentMultiple !== null && Number.isFinite(currentMultiple);
  const isGreen = hasCurrentMultiple && currentMultiple >= 1;
  const MultipleIcon = isGreen ? TrendingUp : TrendingDown;
  const externalUrl = event.chartUrl ?? event.terminalUrl;

  return (
    <article className="rounded-lg border border-border bg-background/90 p-3 backdrop-blur transition-colors duration-100 hover:bg-muted/30">
      <div className="grid gap-4 lg:grid-cols-[minmax(190px,1fr)_150px_160px_110px_110px_120px_44px] lg:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted font-mono text-xs text-muted-foreground">
              {rank}
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-semibold text-foreground">{event.symbol}</h2>
                <span className={statusClass(event.status)}>{statusLabel(event.status)}</span>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">{event.name}</p>
            </div>
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-foreground">{event.signal}</p>
          <p className="mt-1 text-xs text-muted-foreground">{event.source}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:block">
          <Metric label={event.caughtMcapUsd !== null ? "MCap" : "Volume"} value={event.caughtMcapUsd !== null ? formatUsd(event.caughtMcapUsd) : formatUsd(event.volumeUsd)} />
          <Metric label="Seen" value={relativeTime(event.detectedAt)} />
          <Metric label="Mint" value={shortMint(event.mint)} mono />
          <Metric label="Gate" value={event.dailyAction ? event.dailyAction.toUpperCase() : event.verdict?.toUpperCase() ?? "TRACK"} />
        </div>

        <div className="flex items-baseline justify-between gap-2 lg:block lg:text-right">
          <span className="text-xs text-muted-foreground lg:hidden">Peak</span>
          <span className="font-mono text-lg font-semibold tabular-nums text-emerald">
            {formatMultiple(event.peakMultiple)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 lg:justify-end">
          <span className="text-xs text-muted-foreground lg:hidden">Now</span>
          <span className={["inline-flex items-center gap-1 font-mono text-lg font-semibold tabular-nums", !hasCurrentMultiple ? "text-muted-foreground" : isGreen ? "text-emerald" : "text-red"].join(" ")}>
            {hasCurrentMultiple && <MultipleIcon className="size-4" aria-hidden="true" />}
            {formatMultiple(event.currentMultiple)}
          </span>
        </div>

        <div className="lg:text-right">
          <div className="inline-flex min-h-9 items-center rounded-md border border-border bg-muted px-2.5 py-1 font-mono text-sm font-semibold tabular-nums text-foreground">
            {event.score}/100
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground lg:text-right">
            {event.reason}
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <a
            href={externalUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={event.chartUrl ? `Open ${event.symbol} chart` : `Open ${event.symbol} terminal`}
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors duration-100 hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>
          <Link
            href={`/analyze/${event.mint}`}
            aria-label={`Analyze ${event.symbol}`}
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md bg-accent text-white transition-[opacity,transform] duration-100 ease-out hover:opacity-90 active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}

function Metric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0 lg:mt-1">
      <p className="text-xs text-muted-foreground lg:hidden">{label}</p>
      <p className={["truncate text-sm text-foreground", mono ? "font-mono tabular-nums" : ""].join(" ")}>
        {value}
      </p>
    </div>
  );
}

function EmptyState({ hasEvents }: { hasEvents: boolean }) {
  return (
    <section className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-border bg-background/90 p-8 text-center backdrop-blur">
      <div className="flex size-12 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
        {hasEvents ? <SlidersHorizontal className="size-5" aria-hidden="true" /> : <Radar className="size-5" aria-hidden="true" />}
      </div>
      <h2 className="mt-4 text-lg font-semibold text-foreground">
        {hasEvents ? "No matching signals" : "No radar events yet"}
      </h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        {hasEvents
          ? "Adjust the filter or search query to bring more signals back into view."
          : "Start the scanner service and new token or breakout events will appear here automatically."}
      </p>
    </section>
  );
}

function buildStats(events: RadarEvent[]) {
  const total = events.length;
  const active = events.filter(isActiveEvent).length;
  const risk = events.filter((event) => event.status === "risk").length;
  const avgScore =
    total === 0
      ? 0
      : Math.round(events.reduce((sum, event) => sum + event.score, 0) / total);

  return { total, active, risk, avgScore };
}

function isActiveEvent(event: RadarEvent): boolean {
  return event.status !== "risk";
}

function normalizeFilter(value: string | null): RadarFilter {
  return FILTERS.some((filter) => filter.id === value) ? (value as RadarFilter) : "all";
}

function sourceLabel(source: RadarSnapshot["source"]): string {
  if (source === "file") return "Live log";
  if (source === "empty") return "Waiting for signals";
  return "Demo snapshot";
}

function sourceBadgeClass(source: RadarSnapshot["source"]): string {
  const base = "inline-flex min-h-8 items-center rounded-md border px-2.5 py-1 text-xs font-medium";
  if (source === "file") return `${base} border-emerald/30 bg-emerald/10 text-emerald`;
  if (source === "empty") return `${base} border-border bg-muted text-muted-foreground`;
  return `${base} border-amber/30 bg-amber/10 text-foreground`;
}

function statusLabel(status: RadarEvent["status"]): string {
  switch (status) {
    case "active":
      return "Active";
    case "watch":
      return "Watch";
    case "review":
      return "Review";
    case "risk":
      return "Risk";
  }
}

function statusClass(status: RadarEvent["status"]): string {
  const base = "inline-flex min-h-7 items-center rounded-md border px-2 py-0.5 text-xs font-medium";
  if (status === "risk") return `${base} border-red/30 bg-red/10 text-red`;
  if (status === "review") return `${base} border-amber/30 bg-amber/10 text-foreground`;
  if (status === "watch") return `${base} border-emerald/30 bg-emerald/10 text-emerald`;
  return `${base} border-accent/30 bg-accent/10 text-foreground`;
}

function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return "Tracking";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatMultiple(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "tracking";
  return `${value.toFixed(value >= 10 ? 1 : 2)}x`;
}

function relativeTime(timestamp: number): string {
  const diffMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function shortMint(mint: string): string {
  if (mint.length <= 12) return mint;
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}
