import { NextResponse } from "next/server";
import { z } from "zod";
import { JournalCopilot } from "@/lib/journal-copilot";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const CreateBody = z.object({
  wallet: z.string().min(32).max(64),
  signature: z.string().min(1),
  mint: z.string().min(32).max(64),
  type: z.enum(["buy", "sell"]),
  amountTokens: z.number().positive(),
  amountSol: z.number().positive(),
});

const CloseBody = z.object({
  wallet: z.string().min(32).max(64),
  buySignature: z.string().min(1),
  exitPrice: z.number(),
  pnlSol: z.number(),
  pnlPercent: z.number(),
});

const QueryBody = z.object({
  wallet: z.string().min(32).max(64),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  type: z.enum(["buy", "sell"]).optional(),
  tags: z.array(z.string()).optional(),
  sortBy: z.enum(["date", "pnl", "risk"]).optional(),
  limit: z.number().min(1).max(100).optional(),
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
  const action = url.searchParams.get("action") ?? "create";

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    switch (action) {
      case "create": {
        const parsed = CreateBody.safeParse(body);
        if (!parsed.success) {
          return NextResponse.json({ error: "Invalid entry data" }, { status: 400 });
        }
        const journal = new JournalCopilot(parsed.data.wallet);
        await journal.load();
        const entry = await journal.createEntry(
          parsed.data.signature,
          parsed.data.mint,
          parsed.data.type,
          parsed.data.amountTokens,
          parsed.data.amountSol
        );
        return NextResponse.json({ entry });
      }

      case "close": {
        const parsed = CloseBody.safeParse(body);
        if (!parsed.success) {
          return NextResponse.json({ error: "Invalid close data" }, { status: 400 });
        }
        const journal = new JournalCopilot(parsed.data.wallet);
        await journal.load();
        const entry = await journal.closeEntry(
          parsed.data.buySignature,
          parsed.data.exitPrice,
          parsed.data.pnlSol,
          parsed.data.pnlPercent
        );
        if (!entry) {
          return NextResponse.json({ error: "Entry not found" }, { status: 404 });
        }
        return NextResponse.json({ entry });
      }

      case "query": {
        const parsed = QueryBody.safeParse(body);
        if (!parsed.success) {
          return NextResponse.json({ error: "Invalid query" }, { status: 400 });
        }
        const journal = new JournalCopilot(parsed.data.wallet);
        await journal.load();
        const entries = journal.query(parsed.data);
        const stats = journal.getStats();
        return NextResponse.json({ entries, stats });
      }

      case "export": {
        const parsed = z.object({ wallet: z.string() }).safeParse(body);
        if (!parsed.success) {
          return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
        }
        const journal = new JournalCopilot(parsed.data.wallet);
        await journal.load();
        const markdown = journal.exportMarkdown();
        return new NextResponse(markdown, {
          headers: {
            "Content-Type": "text/markdown",
            "Content-Disposition": `attachment; filename="trading-journal-${parsed.data.wallet.slice(0, 8)}.md"`,
          },
        });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Journal Copilot failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
