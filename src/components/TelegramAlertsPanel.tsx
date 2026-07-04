"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MessageCircle,
  Send,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import type { TelegramBotInfo } from "@/lib/telegram-alerts";

interface SolanaProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string };
  connect: () => Promise<{ publicKey: { toString(): string } }>;
  signMessage: (
    message: Uint8Array,
    display?: "utf8" | "hex"
  ) => Promise<{ signature: Uint8Array; publicKey?: { toString(): string } }>;
}

declare global {
  interface Window {
    solana?: SolanaProvider;
    phantom?: { solana?: SolanaProvider };
  }
}

interface ChallengeResponse {
  wallet: string;
  telegramId: string;
  issuedAt: number;
  message: string;
}

interface SubscribeResponse {
  status: "active";
  wallet: string;
  telegramId: string;
  soagBalance: number;
  requiredSoag: number;
  lastVerifiedAt: string;
}

type Stage = "idle" | "connecting" | "signing" | "checking" | "success";

const publicBotUsername = normalizeBotUsername(process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME);
const publicBotUrl =
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL?.trim() ||
  (publicBotUsername ? `https://t.me/${publicBotUsername}` : "");
const publicBotInfo: TelegramBotInfo | null = publicBotUrl
  ? {
      configured: true,
      username: publicBotUsername,
      url: publicBotUrl,
      source: "public-env",
    }
  : null;

export default function TelegramAlertsPanel() {
  const [telegramId, setTelegramId] = useState("");
  const [wallet, setWallet] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubscribeResponse | null>(null);
  const [botInfo, setBotInfo] = useState<TelegramBotInfo | null>(publicBotInfo);
  const telegramInputRef = useRef<HTMLInputElement>(null);

  const isBusy = stage === "connecting" || stage === "signing" || stage === "checking";
  const isBotLookupPending = botInfo === null;
  const botUrl = botInfo?.url ?? "";
  const botUsername = normalizeBotUsername(botInfo?.username);
  const botLabel = botUsername ? `@${botUsername}` : "the alert bot";
  const statusLabel = useMemo(() => {
    switch (stage) {
      case "connecting":
        return "Connecting wallet";
      case "signing":
        return "Waiting for signature";
      case "checking":
        return "Checking SOAG balance";
      case "success":
        return "Alerts active";
      default:
        return "Ready";
    }
  }, [stage]);

  useEffect(() => {
    if (publicBotInfo?.url) return;

    let cancelled = false;

    async function loadBotInfo() {
      try {
        const res = await fetch("/api/alerts/bot");
        const payload = (await res.json()) as TelegramBotInfo;
        if (!cancelled) setBotInfo(payload);
      } catch {
        if (!cancelled) {
          setBotInfo({
            configured: false,
            source: "missing",
            error: "Could not load the Telegram bot link.",
          });
        }
      }
    }

    void loadBotInfo();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (!telegramId.trim()) {
      setError("Paste the Telegram chat ID from the alert bot first.");
      telegramInputRef.current?.focus();
      return;
    }

    const provider = window.solana ?? window.phantom?.solana;
    if (!provider) {
      setError("Install or unlock a Solana wallet that supports message signing.");
      return;
    }

    try {
      setStage("connecting");
      const connected = await provider.connect();
      const connectedWallet = connected.publicKey.toString();
      setWallet(connectedWallet);

      const challenge = await postJson<ChallengeResponse>("/api/alerts/challenge", {
        wallet: connectedWallet,
        telegramId,
      });

      setStage("signing");
      const signed = await provider.signMessage(
        new TextEncoder().encode(challenge.message),
        "utf8"
      );

      setStage("checking");
      const subscription = await postJson<SubscribeResponse>("/api/alerts/subscribe", {
        wallet: challenge.wallet,
        telegramId: challenge.telegramId,
        issuedAt: challenge.issuedAt,
        signature: toBase64(signed.signature),
      });

      setResult(subscription);
      setTelegramId(subscription.telegramId);
      setStage("success");
    } catch (err) {
      setStage("idle");
      setError(err instanceof Error ? err.message : "Could not enable alerts. Try again.");
    }
  }

  return (
    <section
      id="telegram-alerts"
      className="mt-8 scroll-mt-6 rounded-lg border border-border bg-background/85 p-4 shadow-sm backdrop-blur sm:p-5"
      aria-labelledby="telegram-alerts-title"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-emerald">
            <BellRing className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="telegram-alerts-title" className="text-base font-semibold">
                Breakout Radar Telegram alerts
              </h2>
              <span className="rounded-md border border-emerald/30 px-2 py-1 text-xs font-medium text-emerald">
                5M SOAG required
              </span>
            </div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Open the bot, send <span className="font-mono text-foreground">/id</span>, then verify your SOAG wallet here.
            </p>
          </div>
        </div>

        <div className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          {isBusy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : stage === "success" ? (
            <CheckCircle2 className="size-4 text-emerald" aria-hidden="true" />
          ) : (
            <ShieldCheck className="size-4" aria-hidden="true" />
          )}
          <span>{statusLabel}</span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <SetupStep
          icon={Send}
          eyebrow="Step 1"
          title="Open the alert bot"
          description={
            isBotLookupPending
              ? "Finding the bot link from the server."
              : botUrl
              ? `Tap ${botLabel}, then press Start in Telegram.`
              : "Ask a SOAG admin for the alert bot link, then press Start in Telegram."
          }
          action={
            isBotLookupPending ? (
              <div className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Finding bot
              </div>
            ) : botUrl ? (
              <a
                href={botUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-100 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                Open bot
              </a>
            ) : null
          }
        />
        <SetupStep
          icon={MessageCircle}
          eyebrow="Step 2"
          title="Send /id"
          description="The bot replies with your numeric chat ID. Use that number for personal alerts."
        />
        <SetupStep
          icon={WalletCards}
          eyebrow="Step 3"
          title="Paste, connect, sign"
          description="The signature only proves wallet ownership. It cannot move funds."
        />
      </div>

      {!isBotLookupPending && !botUrl && (
        <div className="mt-3 rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-xs leading-5 text-foreground">
          Alert bot link is not available yet. Deployers can set{" "}
          <span className="font-mono">NEXT_PUBLIC_TELEGRAM_BOT_USERNAME</span>,{" "}
          <span className="font-mono">NEXT_PUBLIC_TELEGRAM_BOT_URL</span>, or{" "}
          <span className="font-mono">TELEGRAM_BOT_TOKEN</span> so users can open the bot here.
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-5 space-y-4" aria-busy={isBusy}>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <label htmlFor="telegram-chat-id" className="text-sm font-medium">
              Paste your Telegram chat ID from /id
            </label>
            <input
              ref={telegramInputRef}
              id="telegram-chat-id"
              name="telegram-chat-id"
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              value={telegramId}
              onChange={(event) => setTelegramId(event.target.value)}
              placeholder="123456789 or -1001234567890"
              disabled={isBusy}
              aria-invalid={error ? "true" : undefined}
              aria-describedby="telegram-chat-id-help telegram-alerts-error"
              className="min-h-11 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
            />
            <p id="telegram-chat-id-help" className="text-xs leading-5 text-muted-foreground">
              For personal alerts, paste the numeric ID the bot returns. Use{" "}
              <span className="font-mono">@channel</span> only for public channels where the bot is an admin.
            </p>
          </div>

          <button
            type="submit"
            disabled={isBusy}
            className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-[opacity,transform] duration-100 ease-out hover:opacity-90 active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <WalletCards className="size-4" aria-hidden="true" />
            )}
            <span>{isBusy ? "Verifying" : "Verify SOAG & enable"}</span>
          </button>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <StepItem icon={WalletCards} label="Sign wallet" active={stage === "connecting" || stage === "signing"} done={Boolean(wallet)} />
          <StepItem icon={ShieldCheck} label="Check SOAG" active={stage === "checking"} done={stage === "success"} />
          <StepItem icon={Send} label="Confirm Telegram" active={stage === "checking"} done={stage === "success"} />
        </div>

        {wallet && (
          <div className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
            Wallet: <span className="font-mono tabular-nums text-foreground">{truncate(wallet)}</span>
          </div>
        )}

        {error && (
          <div
            id="telegram-alerts-error"
            role="alert"
            className="flex items-start gap-2 rounded-md border border-red/30 bg-red/10 px-3 py-2 text-sm text-foreground"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-red" aria-hidden="true" />
            <p>{error}</p>
          </div>
        )}

        {result && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-md border border-emerald/30 bg-emerald/10 px-3 py-2 text-sm text-foreground"
          >
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald" aria-hidden="true" />
            <p>
              Breakout Radar alerts are active for <span className="font-mono">{result.telegramId}</span>. Verified{" "}
              <span className="font-mono tabular-nums">{Math.floor(result.soagBalance).toLocaleString()} SOAG</span>.
            </p>
          </div>
        )}
      </form>
    </section>
  );
}

function SetupStep({
  icon: Icon,
  eyebrow,
  title,
  description,
  action,
}: {
  icon: typeof WalletCards;
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-28 flex-col gap-3 rounded-md border border-border bg-muted/70 p-3">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-emerald">
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{eyebrow}</p>
          <h3 className="mt-0.5 text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      {action && <div className="mt-auto">{action}</div>}
    </div>
  );
}

function StepItem({
  icon: Icon,
  label,
  active,
  done,
}: {
  icon: typeof WalletCards;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div
      className={[
        "flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors duration-100",
        done
          ? "border-emerald/30 bg-emerald/10 text-emerald"
          : active
            ? "border-accent/40 bg-accent/10 text-foreground"
            : "border-border bg-muted text-muted-foreground",
      ].join(" ")}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(payload.error ?? "Request failed. Try again.");
  }
  return payload as T;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function truncate(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function normalizeBotUsername(value?: string): string {
  if (!value) return "";
  return value
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^t\.me\//i, "")
    .replace(/[/?#].*$/, "");
}
