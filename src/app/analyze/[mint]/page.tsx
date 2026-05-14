import { analyze } from "@/lib/analyze";
import { ResultView } from "./result-view";
import Link from "next/link";
import { headers } from "next/headers";
import { rateLimit } from "@/lib/rate-limit";

export default async function AnalyzePage(props: PageProps<"/analyze/[mint]">) {
  const { mint } = await props.params;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip") ?? "unknown";
  const rl = rateLimit(ip);
  if (!rl.ok) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="max-w-md text-center space-y-4">
          <div className="text-5xl">⏳</div>
          <h1 className="text-2xl font-semibold">Slow down a moment</h1>
          <p className="text-muted-foreground text-sm">Too many requests. Try again in {rl.retryAfterSec}s.</p>
        </div>
      </main>
    );
  }

  try {
    const result = await analyze(mint);
    return <ResultView result={result} />;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    return (
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="max-w-md text-center space-y-4">
          <div className="text-5xl">⚠️</div>
          <h1 className="text-2xl font-semibold">Can't analyze this token yet</h1>
          <p className="text-muted-foreground text-sm">{message}</p>
          <Link
            href="/"
            className="inline-block px-4 py-2 rounded-md bg-accent text-white text-sm hover:opacity-90"
          >
            Try another
          </Link>
        </div>
      </main>
    );
  }
}
