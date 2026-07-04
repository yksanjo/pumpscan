import bs58 from "bs58";
import nacl from "tweetnacl";

import { MIN_SOAG_FOR_ALERTS } from "./soag-access";

export const ALERT_CHALLENGE_TTL_MS = 10 * 60 * 1000;

export interface AlertChallengeInput {
  wallet: string;
  telegramId: string;
  issuedAt: number;
}

export function normalizeTelegramId(raw: string): string {
  const value = raw.trim();
  const withoutProtocol = value
    .replace(/^https?:\/\/t\.me\//i, "@")
    .replace(/^t\.me\//i, "@");

  if (/^-?\d{5,20}$/.test(withoutProtocol)) {
    return withoutProtocol;
  }

  const username = withoutProtocol.startsWith("@")
    ? withoutProtocol
    : `@${withoutProtocol}`;

  if (/^@[A-Za-z0-9_]{5,32}$/.test(username)) {
    return username;
  }

  throw new Error("Enter a numeric Telegram chat ID or a public @channel.");
}

export function assertValidWallet(wallet: string): void {
  try {
    const decoded = bs58.decode(wallet);
    if (decoded.length !== 32) throw new Error("bad length");
  } catch {
    throw new Error("Enter a valid Solana wallet address.");
  }
}

export function buildAlertChallenge(input: AlertChallengeInput): string {
  return [
    "Pumpscan Telegram Alerts",
    "",
    `Wallet: ${input.wallet}`,
    `Telegram: ${input.telegramId}`,
    `SOAG required: ${MIN_SOAG_FOR_ALERTS}`,
    `Issued at: ${input.issuedAt}`,
    "",
    "Sign this message to prove wallet ownership. This does not move funds.",
  ].join("\n");
}

export function assertFreshChallenge(issuedAt: number, now = Date.now()): void {
  if (!Number.isFinite(issuedAt)) {
    throw new Error("Challenge timestamp is invalid.");
  }
  if (issuedAt > now + 60_000) {
    throw new Error("Challenge timestamp is in the future.");
  }
  if (now - issuedAt > ALERT_CHALLENGE_TTL_MS) {
    throw new Error("Challenge expired. Try again.");
  }
}

export function verifyAlertSignature(input: AlertChallengeInput & { signature: string }): boolean {
  assertValidWallet(input.wallet);
  assertFreshChallenge(input.issuedAt);

  const publicKey = bs58.decode(input.wallet);
  const signature = Buffer.from(input.signature, "base64");
  if (signature.length !== 64) return false;

  const message = buildAlertChallenge(input);
  return nacl.sign.detached.verify(
    new TextEncoder().encode(message),
    signature,
    publicKey
  );
}
