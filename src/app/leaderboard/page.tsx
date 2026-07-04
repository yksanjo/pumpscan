import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import Link from "next/link";

export const dynamic = "force-dynamic"; // always re-read leaderboard.json
export const revalidate = 0;

interface Appearance {
  mint: string;
  pctSupply: number;
}

interface LeaderboardEntry {
  rank: number;
  wallet: string;
  tier: "ELITE" | "HIGH" | "MID" | "LOW" | "MIN";
  pumpFunBags: number;
  totalSwaps: number;
  firstSwapDaysAgo: number | null;
  lastSwapDaysAgo: number | null;
  appearances: Appearance[];
}

interface LeaderboardSnapshot {
  generatedAt: number;
  mintsScanned: string[];
  totals: {
    holdersInspected: number;
    walletsClassified: number;
    realCollectors: number;
  };
  tierCounts: Record<LeaderboardEntry["tier"], number>;
  entries: LeaderboardEntry[];
  methodology: {
    topHoldersPerToken: number;
    minHistoryDays: number;
    minTotalSwaps: number;
    minSwaps30d: number;
    repoUrl: string;
  };
}

function loadSnapshot(): LeaderboardSnapshot | null {
  const path = resolve(process.cwd(), "public", "leaderboard.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LeaderboardSnapshot;
  } catch {
    return null;
  }
}

const TIER_META: Record<LeaderboardEntry["tier"], { emoji: string; label: string; color: string }> = {
  ELITE: { emoji: "⚡", label: "ELITE",  color: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
  HIGH:  { emoji: "🔥", label: "HIGH",   color: "bg-rose-500/20 text-rose-300 border-rose-500/40" },
  MID:   { emoji: "💫", label: "MID",    color: "bg-sky-500/20 text-sky-300 border-sky-500/40" },
  LOW:   { emoji: "✦",  label: "LOW",    color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" },
  MIN:   { emoji: "·",  label: "MIN",    color: "bg-zinc-500/20 text-zinc-300 border-zinc-500/40" },
};

function maskShort(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export default function LeaderboardPage() {
  const snap = loadSnapshot();

  if (!snap) {
    return (
      <main className="flex-1 px-6 py-16">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-2xl font-semibold mb-3">🏆 Pump.fun Real Collectors</h1>
          <p className="text-muted-foreground">
            Leaderboard not generated yet. Run{" "}
            <code className="bg-muted px-2 py-1 rounded">npx tsx scripts/build-leaderboard.ts</code>{" "}
            to populate.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 px-6 py-12">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold mb-2">🏆 Pump.fun Real Collectors</h1>
          <p className="text-muted-foreground text-sm">
            Top holders of {snap.mintsScanned.length} pump.fun graduates who are
            <b className="text-foreground"> still actively trading</b> — ranked by pump.fun bags held.
          </p>
          <p className="text-muted-foreground text-xs mt-3">
            Updated {formatTimestamp(snap.generatedAt)} · scanned{" "}
            <b className="text-foreground">{snap.totals.holdersInspected.toLocaleString()}</b> top holders ·
            only{" "}
            <b className="text-foreground">{snap.totals.realCollectors}</b> are still active
            ({((snap.totals.realCollectors / Math.max(1, snap.totals.holdersInspected)) * 100).toFixed(1)}%).
          </p>
          <p className="text-muted-foreground text-xs mt-1">
            The other {(snap.totals.holdersInspected - snap.totals.realCollectors).toLocaleString()}{" "}
            top holders are dormant — bag and forget, in real time.
          </p>
        </header>

        <section className="mb-6 rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          <div className="font-medium text-foreground mb-1">Methodology</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Top {snap.methodology.topHoldersPerToken} holders × {snap.mintsScanned.length} pump.fun graduates</li>
            <li>≥{snap.methodology.minHistoryDays}d swap history · ≥{snap.methodology.minTotalSwaps} total swaps · ≥{snap.methodology.minSwaps30d} swaps in last 30d</li>
            <li>
              Open source:{" "}
              <Link href={snap.methodology.repoUrl} className="underline hover:text-foreground">
                github.com/yksanjo/pumpscan
              </Link>
            </li>
          </ul>
        </section>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          {(["ELITE", "HIGH", "MID", "LOW", "MIN"] as const).map((tier) => (
            <span
              key={tier}
              className={`px-2.5 py-1 rounded-full border text-xs ${TIER_META[tier].color}`}
            >
              {TIER_META[tier].emoji} {TIER_META[tier].label}: {snap.tierCounts[tier]}
            </span>
          ))}
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 w-12">#</th>
                <th className="text-left px-3 py-2">Wallet</th>
                <th className="text-left px-3 py-2">Tier</th>
                <th className="text-right px-3 py-2">Bags</th>
                <th className="text-right px-3 py-2">Swaps</th>
                <th className="text-right px-3 py-2">History</th>
                <th className="text-right px-3 py-2">Last active</th>
                <th className="text-right px-3 py-2">In</th>
              </tr>
            </thead>
            <tbody>
              {snap.entries.map((e) => {
                const meta = TIER_META[e.tier];
                return (
                  <tr key={e.wallet} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 text-muted-foreground">{e.rank}</td>
                    <td className="px-3 py-2 font-mono">
                      <Link
                        href={`https://solscan.io/account/${e.wallet}`}
                        target="_blank"
                        className="underline-offset-2 hover:underline"
                        title={e.wallet}
                      >
                        {maskShort(e.wallet)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded border text-xs ${meta.color}`}>
                        {meta.emoji} {meta.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{e.pumpFunBags}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {e.totalSwaps}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {e.firstSwapDaysAgo !== null ? `${e.firstSwapDaysAgo}d` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {e.lastSwapDaysAgo !== null ? `${e.lastSwapDaysAgo}d ago` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {e.appearances.length}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <footer className="mt-8 text-xs text-muted-foreground text-center">
          Built on <Link href="/" className="underline">pumpscan</Link>. Methodology open-source, treasury public.
          {" "}<Link href="https://musicailab.com" className="underline">musicailab.com</Link>
        </footer>
      </div>
    </main>
  );
}
