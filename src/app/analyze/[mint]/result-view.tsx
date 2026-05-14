"use client";

import Link from "next/link";
import { useState } from "react";
import type { AnalysisResult, RiskFinding, Severity } from "@/lib/types";
import { VERDICT_META } from "@/lib/types";

const VERDICT_TW: Record<string, string> = {
  clean: "bg-emerald/10 border-emerald/30 text-emerald",
  caution: "bg-amber/10 border-amber/30 text-amber",
  avoid: "bg-red/10 border-red/30 text-red",
};

const SEVERITY_TW: Record<Severity, string> = {
  critical: "bg-red/15 text-red border-red/30",
  high: "bg-red/10 text-red border-red/20",
  medium: "bg-amber/10 text-amber border-amber/20",
  low: "bg-emerald/10 text-emerald border-emerald/20",
};

export function ResultView({ result }: { result: AnalysisResult }) {
  const meta = VERDICT_META[result.verdict];
  const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    `${meta.emoji} ${meta.label} verdict for ${result.vitals.symbol} on Pumpscan — risk ${result.riskScore}/100`
  )}`;

  return (
    <main className="flex-1 px-6 py-10 max-w-3xl mx-auto w-full">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
        ← Analyze another
      </Link>

      <section
        className={`mt-6 rounded-xl border p-6 ${VERDICT_TW[result.verdict]}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider opacity-70 mb-1">
              Verdict
            </div>
            <div className="flex items-center gap-3">
              <span className="text-4xl">{meta.emoji}</span>
              <h1 className="text-3xl font-semibold">{meta.label}</h1>
            </div>
            <p className="mt-2 text-sm opacity-80">
              {result.vitals.name} ({result.vitals.symbol}) · risk {result.riskScore}/100 · confidence {Math.round(result.confidence * 100)}%
            </p>
          </div>
          <a
            href={shareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-2 rounded-md border border-current/30 text-sm hover:opacity-80"
          >
            Share
          </a>
        </div>
        {result.narration && (
          <p className="mt-4 text-sm leading-relaxed opacity-90">
            {result.narration}
          </p>
        )}
      </section>

      <section className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Vital label="Mcap" value={formatUsd(result.vitals.mcapUsd)} />
        <Vital label="Holders" value={result.vitals.holders.toLocaleString()} />
        <Vital label="24h volume" value={formatUsd(result.vitals.volume24hUsd)} />
        <Vital
          label="Age"
          value={
            result.vitals.ageHours < 24
              ? `${result.vitals.ageHours}h`
              : `${Math.round(result.vitals.ageHours / 24)}d`
          }
        />
      </section>

      <section className="mt-6 rounded-xl border border-border bg-muted/30 p-5">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Concentration
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Top 10" value={`${result.concentration.top10Pct}%`} />
          <Stat label="Top 25" value={`${result.concentration.top25Pct}%`} />
          <Stat label="Top 100" value={`${result.concentration.top100Pct}%`} />
          <Stat label="Gini" value={result.concentration.gini.toFixed(2)} />
        </div>
      </section>

      {result.graduation && (
        <section className="mt-6 rounded-xl border border-border bg-muted/30 p-5">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Graduation Forecast
          </h2>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-3xl">
              {result.graduation.verdict === "likely" ? "🟢" : result.graduation.verdict === "possible" ? "🟡" : "🔴"}
            </span>
            <div>
              <div className="text-lg font-semibold capitalize">{result.graduation.verdict}</div>
              <div className="text-sm text-muted-foreground">
                {result.graduation.probability}% probability
                {result.graduation.estimatedHours !== null && ` · ~${result.graduation.estimatedHours < 1 ? "<1h" : result.graduation.estimatedHours < 24 ? `${result.graduation.estimatedHours}h` : `${Math.round(result.graduation.estimatedHours / 24)}d`} to graduation`}
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            {result.graduation.factors.slice(0, 4).map((f, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span>{f.impact === "positive" ? "✅" : f.impact === "negative" ? "❌" : "➖"}</span>
                <span className="text-muted-foreground">{f.detail}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {result.bundles.length > 0 && (
        <section className="mt-6 rounded-xl border border-border bg-muted/30 p-5">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Bundles detected
          </h2>
          <div className="space-y-3">
            {result.bundles.map((b, i) => (
              <div
                key={i}
                className="rounded-lg border border-border/60 bg-background/50 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {b.members.length} wallets · {b.pctSupply}% of supply
                  </span>
                  <span className="text-xs text-muted-foreground">
                    funded within {b.fundedWithinSec}s
                  </span>
                </div>
                <a
                  href={`https://solscan.io/account/${b.funder}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-foreground font-mono mt-1 inline-block"
                >
                  funder · {truncate(b.funder)}
                </a>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Findings
        </h2>
        <div className="space-y-3">
          {result.findings.length === 0 && (
            <p className="text-sm text-muted-foreground">No notable findings.</p>
          )}
          {result.findings.map((f) => (
            <FindingCard key={f.id} finding={f} />
          ))}
        </div>
      </section>

      <p className="mt-10 text-center text-xs text-muted-foreground">
        Informational only. Not financial advice. Patterns detected do not prove intent.
      </p>
    </main>
  );
}

function Vital({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-medium mt-1">{value}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-medium mt-1">{value}</div>
    </div>
  );
}

function FindingCard({ finding }: { finding: RiskFinding }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/30 transition"
      >
        <div className="flex items-center gap-3">
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium border uppercase tracking-wider ${SEVERITY_TW[finding.severity]}`}
          >
            {finding.severity}
          </span>
          <span className="font-medium">{finding.title}</span>
        </div>
        <span className="text-muted-foreground text-sm">
          {open ? "−" : "+"}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/50">
          <p className="text-sm text-muted-foreground mt-3">{finding.detail}</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {finding.evidence.map((e, i) => (
              <div key={i}>
                <div className="text-xs text-muted-foreground">{e.label}</div>
                {e.link ? (
                  <a
                    href={e.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sm hover:underline"
                  >
                    {e.value}
                  </a>
                ) : (
                  <div className="font-mono text-sm">{e.value}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function truncate(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}
