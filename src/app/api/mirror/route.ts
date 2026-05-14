import { NextResponse } from "next/server";
import { z } from "zod";
import { MirrorPilot, MirrorFeedAggregator } from "@/lib/mirror-pilot";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const AnalyzeBody = z.object({
  wallet: z.string().min(32).max(64),
});

const ThesisBody = z.object({
  wallet: z.string().min(32).max(64),
  signature: z.string().min(1),
  mint: z.string().min(32).max(64),
  type: z.enum(["buy", "sell"]),
  amountTokens: z.number().positive(),
  amountSol: z.number().positive(),
});

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = rateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429 }
    );
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "analyze";

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    switch (action) {
      case "analyze": {
        const parsed = AnalyzeBody.safeParse(body);
        if (!parsed.success) {
          return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
        }
        const mirror = new MirrorPilot(parsed.data.wallet);
        const profile = await mirror.initialize();
        return NextResponse.json({ profile, feed: mirror.getFeed(10) });
      }

      case "thesis": {
        const parsed = ThesisBody.safeParse(body);
        if (!parsed.success) {
          return NextResponse.json({ error: "Invalid trade data" }, { status: 400 });
        }
        const mirror = new MirrorPilot(parsed.data.wallet);
        await mirror.initialize();
        const thesis = await mirror.generateThesis({
          signature: parsed.data.signature,
          mint: parsed.data.mint,
          tokenName: "",
          tokenSymbol: "",
          type: parsed.data.type,
          amountTokens: parsed.data.amountTokens,
          amountSol: parsed.data.amountSol,
          priceUsd: 0,
          timestamp: Math.floor(Date.now() / 1000),
          slot: 0,
        });
        return NextResponse.json({ thesis });
      }

      case "feed": {
        const feed = new MirrorFeedAggregator();
        // In production, load mirrors from DB
        return NextResponse.json({ posts: feed.getFeed(50) });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Mirror Pilot failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
