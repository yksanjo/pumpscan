import { NextResponse } from "next/server";
import { z } from "zod";
import { findCollectors } from "@/lib/collector-finder";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const Body = z.object({
  mints: z.array(z.string().min(32).max(64)).min(1).max(25),
  holdersPerToken: z.number().int().min(5).max(100).optional(),
  recencyDays: z.number().int().min(7).max(180).optional(),
});

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = rateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  try {
    const scan = await findCollectors(parsed.data.mints, {
      holdersPerToken: parsed.data.holdersPerToken,
      recencyDays: parsed.data.recencyDays,
    });
    return NextResponse.json(scan);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Collector scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
