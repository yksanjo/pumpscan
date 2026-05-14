import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeDevWallet } from "@/lib/dev-wallet-tracker";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const Body = z.object({
  wallet: z.string().min(32).max(64),
  maxTokens: z.number().min(1).max(50).default(20),
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
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  try {
    const result = await analyzeDevWallet(parsed.data.wallet, parsed.data.maxTokens);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Dev wallet analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
