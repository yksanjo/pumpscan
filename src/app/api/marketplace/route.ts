import { NextResponse } from "next/server";
import { z } from "zod";
import { MirrorMarketplace } from "@/lib/marketplace";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const marketplace = new MirrorMarketplace();

const ListBody = z.object({
  wallet: z.string().min(32).max(64),
  username: z.string().min(1).max(30),
  bio: z.string().max(200).default(""),
  tiers: z.array(z.object({
    tier: z.enum(["free", "basic", "premium", "whale"]),
    priceSol: z.number().min(0),
    benefits: z.array(z.string()),
  })).min(1).max(4),
});

const SubscribeBody = z.object({
  subscriberWallet: z.string().min(32).max(64),
  creatorWallet: z.string().min(32).max(64),
  tier: z.enum(["free", "basic", "premium", "whale"]),
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
  const action = url.searchParams.get("action") ?? "list";

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    switch (action) {
      case "list": {
        const parsed = ListBody.safeParse(body);
        if (!parsed.success) {
          return NextResponse.json({ error: "Invalid listing data" }, { status: 400 });
        }
        const listing = await marketplace.listMirror(
          parsed.data.wallet,
          parsed.data.username,
          parsed.data.bio,
          parsed.data.tiers
        );
        return NextResponse.json({ listing });
      }

      case "subscribe": {
        const parsed = SubscribeBody.safeParse(body);
        if (!parsed.success) {
          return NextResponse.json({ error: "Invalid subscription data" }, { status: 400 });
        }
        const subscription = await marketplace.subscribe(
          parsed.data.subscriberWallet,
          parsed.data.creatorWallet,
          parsed.data.tier
        );
        return NextResponse.json({ subscription });
      }

      case "listings": {
        const listings = marketplace.getListings({
          verified: url.searchParams.get("verified") === "true",
          sortBy: (url.searchParams.get("sort") as any) ?? "popular",
        });
        return NextResponse.json({ listings });
      }

      case "stats": {
        const stats = marketplace.getStats();
        const revenue = marketplace.getPlatformRevenue();
        return NextResponse.json({ stats, revenue });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Marketplace failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
