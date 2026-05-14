import { NextResponse } from "next/server";
import { z } from "zod";
import { batchScan } from "@/lib/batch-scanner";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const Body = z.object({
  mints: z.array(z.string().min(32).max(64)).min(1).max(50),
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
    return NextResponse.json({ error: "Invalid mints array" }, { status: 400 });
  }

  try {
    const result = await batchScan(parsed.data.mints);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Batch scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
