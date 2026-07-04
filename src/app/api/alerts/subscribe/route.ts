import { NextResponse } from "next/server";
import { z } from "zod";

import {
  normalizeTelegramId,
  verifyAlertSignature,
} from "@/lib/alert-signature";
import { upsertAlertSubscriber } from "@/lib/alert-subscribers";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { checkSoagAlertAccess, formatSoagAmount } from "@/lib/soag-access";
import {
  formatWelcomeTelegramAlert,
  isTelegramConfigured,
  sendTelegramMessage,
  TelegramDeliveryError,
} from "@/lib/telegram-alerts";

export const runtime = "nodejs";

const Body = z.object({
  wallet: z.string().min(32).max(64),
  telegramId: z.string().min(4).max(120),
  issuedAt: z.number().int().positive(),
  signature: z.string().min(80).max(120),
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
    return NextResponse.json({ error: "Subscription request is incomplete." }, { status: 400 });
  }

  let telegramId: string;
  try {
    telegramId = normalizeTelegramId(parsed.data.telegramId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Telegram ID is invalid.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  let verified = false;
  try {
    verified = verifyAlertSignature({
      wallet: parsed.data.wallet,
      telegramId,
      issuedAt: parsed.data.issuedAt,
      signature: parsed.data.signature,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Wallet signature could not be verified.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!verified) {
    return NextResponse.json(
      { error: "Wallet signature did not match this alert request." },
      { status: 401 }
    );
  }

  if (!isTelegramConfigured()) {
    return NextResponse.json(
      { error: "Telegram bot token is not configured on the server." },
      { status: 503 }
    );
  }

  let access;
  try {
    access = await checkSoagAlertAccess(parsed.data.wallet);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Balance check failed.";
    return NextResponse.json(
      { error: `Could not verify SOAG balance. ${detail}` },
      { status: 502 }
    );
  }

  if (!access.eligible) {
    return NextResponse.json(
      {
        error: `This wallet needs ${formatSoagAmount(access.required)} to enable alerts.`,
        balance: access.balance,
        required: access.required,
      },
      { status: 403 }
    );
  }

  try {
    await sendTelegramMessage(
      telegramId,
      formatWelcomeTelegramAlert({
        wallet: parsed.data.wallet,
        balance: access.balance,
      })
    );
  } catch (err) {
    const message =
      err instanceof TelegramDeliveryError
        ? err.message
        : "Telegram could not deliver the confirmation message.";
    return NextResponse.json(
      {
        error: `${message} Start the bot first, then try again.`,
      },
      { status: 400 }
    );
  }

  const subscriber = await upsertAlertSubscriber({
    wallet: parsed.data.wallet,
    telegramId,
    soagBalance: access.balance,
  });

  return NextResponse.json({
    status: "active",
    wallet: subscriber.wallet,
    telegramId: subscriber.telegramId,
    soagBalance: subscriber.soagBalance,
    requiredSoag: access.required,
    lastVerifiedAt: subscriber.lastVerifiedAt,
  });
}
