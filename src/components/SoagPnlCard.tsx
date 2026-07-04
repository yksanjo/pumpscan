"use client";

import { Copy, Download, TrendingDown, TrendingUp } from "lucide-react";
import type { InputHTMLAttributes } from "react";
import { useMemo, useState } from "react";

const DEFAULT_CARD = {
  symbol: "SOAG",
  entryPrice: "0.00000100",
  exitPrice: "0.00000180",
  positionSizeSol: "2.5",
};

export default function SoagPnlCard() {
  const [symbol, setSymbol] = useState(DEFAULT_CARD.symbol);
  const [entryPrice, setEntryPrice] = useState(DEFAULT_CARD.entryPrice);
  const [exitPrice, setExitPrice] = useState(DEFAULT_CARD.exitPrice);
  const [positionSizeSol, setPositionSizeSol] = useState(DEFAULT_CARD.positionSizeSol);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const metrics = useMemo(() => {
    const entry = parsePositiveNumber(entryPrice);
    const exit = parsePositiveNumber(exitPrice);
    const position = parsePositiveNumber(positionSizeSol);
    const pnlPct = entry > 0 && exit > 0 ? ((exit - entry) / entry) * 100 : 0;
    const pnlSol = entry > 0 ? position * (exit / entry - 1) : 0;
    const multiple = entry > 0 && exit > 0 ? exit / entry : 0;

    return {
      symbol: normalizeSymbol(symbol),
      entry,
      exit,
      position,
      pnlPct,
      pnlSol,
      multiple,
      isWin: pnlPct >= 0,
    };
  }, [entryPrice, exitPrice, positionSizeSol, symbol]);

  async function copyCardText() {
    setCopyState("idle");
    try {
      await navigator.clipboard.writeText(buildShareText(metrics));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  function downloadCard() {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 675;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    drawPnlCard(ctx, metrics);

    const link = document.createElement("a");
    link.download = `${metrics.symbol.toLowerCase()}-pnl-card.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <section className="mt-8 rounded-lg border border-border bg-background/85 p-4 shadow-sm backdrop-blur sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">SOAG PnL card</h2>
            <span className="rounded-md border border-emerald/30 px-2 py-1 text-xs font-medium text-emerald">
              Powered by SOAG
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copyCardText}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-100 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            title="Copy share text"
          >
            <Copy className="size-4" aria-hidden="true" />
            <span>{copyState === "copied" ? "Copied" : copyState === "failed" ? "Failed" : "Copy"}</span>
          </button>
          <button
            type="button"
            onClick={downloadCard}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-[opacity,transform] duration-100 ease-out hover:opacity-90 active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            title="Download PNG"
          >
            <Download className="size-4" aria-hidden="true" />
            <span>PNG</span>
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <Field
            id="pnl-symbol"
            label="Token"
            value={symbol}
            onChange={(value) => setSymbol(value.toUpperCase())}
            maxLength={12}
          />
          <Field
            id="pnl-entry"
            label="Entry price"
            value={entryPrice}
            onChange={setEntryPrice}
            inputMode="decimal"
          />
          <Field
            id="pnl-exit"
            label="Exit price"
            value={exitPrice}
            onChange={setExitPrice}
            inputMode="decimal"
          />
          <Field
            id="pnl-size"
            label="Position size"
            value={positionSizeSol}
            onChange={setPositionSizeSol}
            inputMode="decimal"
            suffix="SOL"
          />
        </div>

        <PnlCardPreview metrics={metrics} />
      </div>
    </section>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  inputMode = "text",
  maxLength,
  suffix,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  maxLength?: number;
  suffix?: string;
}) {
  return (
    <label htmlFor={id} className="space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <span className="flex min-h-11 items-center rounded-md border border-border bg-muted focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-background">
        <input
          id={id}
          type="text"
          inputMode={inputMode}
          spellCheck={false}
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={maxLength}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {suffix && (
          <span className="shrink-0 border-l border-border px-3 text-xs font-medium text-muted-foreground">
            {suffix}
          </span>
        )}
      </span>
    </label>
  );
}

function PnlCardPreview({ metrics }: { metrics: PnlMetrics }) {
  const Icon = metrics.isWin ? TrendingUp : TrendingDown;
  const tone = metrics.isWin ? "text-emerald" : "text-red";
  const borderTone = metrics.isWin ? "border-emerald/30" : "border-red/30";
  const bgTone = metrics.isWin ? "bg-emerald/10" : "bg-red/10";

  return (
    <div
      className={[
        "flex min-h-[320px] flex-col justify-between overflow-hidden rounded-lg border bg-[#101014] p-5",
        borderTone,
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Powered by SOAG
          </p>
          <h3 className="mt-1 truncate text-2xl font-semibold text-foreground">
            ${metrics.symbol}
          </h3>
        </div>
        <div className={["flex size-11 shrink-0 items-center justify-center rounded-md border", borderTone, bgTone, tone].join(" ")}>
          <Icon className="size-5" aria-hidden="true" />
        </div>
      </div>

      <div>
        <p className={["text-5xl font-semibold tabular-nums", tone].join(" ")}>
          {formatSignedPercent(metrics.pnlPct)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {formatSignedNumber(metrics.pnlSol, 3)} SOL · {metrics.multiple.toFixed(2)}x
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Entry" value={formatPrice(metrics.entry)} />
        <Stat label="Exit" value={formatPrice(metrics.exit)} />
        <Stat label="Size" value={`${trimNumber(metrics.position, 3)} SOL`} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-h-16 rounded-md border border-border bg-background/70 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-medium tabular-nums text-foreground">{value}</p>
    </div>
  );
}

interface PnlMetrics {
  symbol: string;
  entry: number;
  exit: number;
  position: number;
  pnlPct: number;
  pnlSol: number;
  multiple: number;
  isWin: boolean;
}

function drawPnlCard(ctx: CanvasRenderingContext2D, metrics: PnlMetrics) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const winColor = metrics.isWin ? "#10b981" : "#ef4444";

  ctx.fillStyle = "#0a0a0b";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#101014";
  roundRect(ctx, 54, 54, width - 108, height - 108, 34);
  ctx.fill();
  ctx.strokeStyle = metrics.isWin ? "rgba(16,185,129,0.45)" : "rgba(239,68,68,0.45)";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = "#9a9a9d";
  ctx.font = "600 28px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("POWERED BY SOAG", 96, 125);

  ctx.fillStyle = "#f5f5f5";
  ctx.font = "700 64px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(`$${metrics.symbol}`, 96, 205);

  ctx.fillStyle = winColor;
  ctx.font = "800 118px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(formatSignedPercent(metrics.pnlPct), 96, 360);

  ctx.fillStyle = "#f5f5f5";
  ctx.font = "600 38px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(`${formatSignedNumber(metrics.pnlSol, 3)} SOL`, 96, 430);

  ctx.fillStyle = "#9a9a9d";
  ctx.font = "500 30px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(`ENTRY ${formatPrice(metrics.entry)}`, 96, 535);
  ctx.fillText(`EXIT ${formatPrice(metrics.exit)}`, 430, 535);
  ctx.fillText(`SIZE ${trimNumber(metrics.position, 3)} SOL`, 735, 535);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function buildShareText(metrics: PnlMetrics): string {
  return [
    `$${metrics.symbol} PnL`,
    `${formatSignedPercent(metrics.pnlPct)} (${formatSignedNumber(metrics.pnlSol, 3)} SOL)`,
    `Entry: ${formatPrice(metrics.entry)}`,
    `Exit: ${formatPrice(metrics.exit)}`,
    `Size: ${trimNumber(metrics.position, 3)} SOL`,
    "Powered by SOAG",
  ].join("\n");
}

function normalizeSymbol(value: string): string {
  const normalized = value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 12);
  return normalized || "SOAG";
}

function parsePositiveNumber(value: string): number {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatSignedPercent(value: number): string {
  const abs = Math.abs(value);
  const formatted = abs >= 10_000 ? value.toExponential(1) : value.toFixed(1);
  return `${value >= 0 ? "+" : ""}${formatted}%`;
}

function formatSignedNumber(value: number, digits: number): string {
  return `${value >= 0 ? "+" : ""}${trimNumber(value, digits)}`;
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1) return `$${trimNumber(value, 4)}`;
  if (value >= 0.01) return `$${trimNumber(value, 6)}`;
  if (value >= 0.000001) return `$${trimNumber(value, 8)}`;
  return `$${value.toExponential(3)}`;
}

function trimNumber(value: number, digits: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1_000_000) return value.toExponential(2);
  return value.toFixed(digits).replace(/\.?0+$/, "");
}
