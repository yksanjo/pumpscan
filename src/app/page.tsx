"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { extractMint } from "@/lib/parse-input";
import { EXAMPLE_MINTS } from "@/lib/fixtures";

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
      <div className="w-full max-w-2xl">
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
