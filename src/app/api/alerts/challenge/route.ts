import { NextResponse } from "next/server";
import { z } from "zod";

import {
  assertValidWallet,
  buildAlertChallenge,
  normalizeTelegramId,
} from "@/lib/alert-signature";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Body = z.object({
  wallet: z.string().min(32).max(64),
  telegramId: z.string().min(4).max(120),
});

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = rateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests. Slow down a bit." },
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
    return NextResponse.json({ error: "Enter a wallet and Telegram ID." }, { status: 400 });
  }

  try {
    assertValidWallet(parsed.data.wallet);
    const telegramId = normalizeTelegramId(parsed.data.telegramId);
    const issuedAt = Date.now();
    const message = buildAlertChallenge({
      wallet: parsed.data.wallet,
      telegramId,
      issuedAt,
    });

    return NextResponse.json({
      wallet: parsed.data.wallet,
      telegramId,
      issuedAt,
      expiresAt: issuedAt + 10 * 60 * 1000,
      message,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create challenge.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
