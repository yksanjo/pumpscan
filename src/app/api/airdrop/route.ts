import { NextResponse } from "next/server";
import { z } from "zod";
import { planAirdrop } from "@/lib/airdrop-planner";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const Body = z.object({
  mint: z.string().min(32).max(64),
  recipients: z
    .array(
      z.object({
        wallet: z.string().min(32).max(64),
        amount: z.number().positive().optional(),
      })
    )
    .min(1)
    .max(500),
  defaultAmount: z.number().positive(),
  dryRun: z.boolean().optional(),
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
    const plan = planAirdrop(parsed.data);
    return NextResponse.json(plan);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Airdrop plan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
