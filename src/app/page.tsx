"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellRing, Radar, Send } from "lucide-react";
import { extractMint } from "@/lib/parse-input";
import { EXAMPLE_MINTS } from "@/lib/fixtures";
import TelegramAlertsPanel from "@/components/TelegramAlertsPanel";
import SoagPnlCard from "@/components/SoagPnlCard";

export default function LandingPage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(raw: string) {
    setError(null);
    const mint = extractMint(raw);
    if (!mint) {
      setError("Couldn't find a Solana mint in that input. Paste a pump.fun URL or a mint address.");
      return;
    }
    startTransition(() => {
      router.push(`/analyze/${mint}`);
    });
  }

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted text-xs text-muted-foreground mb-6">
            <span className="size-1.5 rounded-full bg-emerald" />
            pump.fun holder forensics
          </div>
          <h1 className="text-5xl md:text-6xl font-semibold tracking-tight mb-4">
            Pumpscan
          </h1>
          <p className="text-lg text-muted-foreground max-w-md mx-auto">
            Paste any pump.fun token. Get a verdict in 15 seconds — bundles, concentration, dev wallet, holders.
          </p>
        </div>

        <div className="mb-6 rounded-lg border border-emerald/30 bg-emerald/10 p-4 text-left">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-emerald/30 bg-background text-emerald">
                <BellRing className="size-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Breakout Radar alerts are live
                </p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Open the Telegram bot, send <span className="font-mono text-foreground">/id</span>, then verify your SOAG wallet.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
              <Link
                href="/radar"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-emerald/30 px-4 py-2 text-sm font-medium text-emerald transition-colors duration-100 hover:bg-emerald/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <Radar className="size-4" aria-hidden="true" />
                Open radar
              </Link>
              <a
                href="#telegram-alerts"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-[opacity,transform] duration-100 ease-out hover:opacity-90 active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <Send className="size-4" aria-hidden="true" />
                Set up alerts
              </a>
            </div>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="space-y-3"
        >
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="pump.fun URL or mint address"
              className="flex-1 px-4 py-3 rounded-lg bg-muted border border-border focus:border-accent focus:outline-none text-base"
              autoFocus
            />
            <button
              type="submit"
              disabled={isPending}
              className="px-6 py-3 rounded-lg bg-accent text-white font-medium hover:opacity-90 disabled:opacity-50 transition"
            >
              {isPending ? "Loading…" : "Analyze"}
            </button>
          </div>
          {error && (
            <p className="text-sm text-red-400 px-1">{error}</p>
          )}
        </form>

        <TelegramAlertsPanel />

        <SoagPnlCard />

        <div className="mt-8 flex flex-col items-center gap-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            Or try an example
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {EXAMPLE_MINTS.map((ex) => (
              <button
                key={ex.mint}
                onClick={() => submit(ex.mint)}
                className="px-3 py-1.5 rounded-md border border-border text-sm hover:bg-muted transition"
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-16 text-center text-xs text-muted-foreground">
          Informational only. Not financial advice. Patterns detected do not prove intent.
        </p>
      </div>
    </main>
  );
}
