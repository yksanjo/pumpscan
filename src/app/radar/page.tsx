import type { Metadata } from "next";
import { Suspense } from "react";
import { readRadarSnapshot } from "@/lib/radar-events";
import RadarDashboard from "./radar-dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Radar — Pumpscan",
  description: "Live token scanner and Breakout Radar dashboard for Solana pump.fun signals.",
};

export default async function RadarPage() {
  const snapshot = await readRadarSnapshot({ allowDemo: true });

  return (
    <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
      <Suspense fallback={<RadarSkeleton />}>
        <RadarDashboard snapshot={snapshot} />
      </Suspense>
    </main>
  );
}

function RadarSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-4" aria-label="Loading radar dashboard">
      <div className="h-28 rounded-lg border border-border bg-muted/70" />
      <div className="grid gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 rounded-lg border border-border bg-muted/70" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-24 rounded-lg border border-border bg-muted/70" />
        ))}
      </div>
    </div>
  );
}
