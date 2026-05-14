import Anthropic from "@anthropic-ai/sdk";
import type {
  TokenVitals,
  Verdict,
  RiskFinding,
  ConcentrationStats,
  BundleCluster,
} from "./types";

const SYSTEM_PROMPT = `You are a Solana memecoin risk analyst writing for retail crypto traders.

Given a token's deterministic risk findings, write a 3–5 sentence verdict narration in plain English. Be direct. Use the user's voice ("you", "this token") — no corporate copy.

Rules:
- Never say "this is a rug" or "buy/sell" — use "patterns detected", "the evidence shows"
- Lead with the single most important finding
- Cite numbers ("3 wallets control 38% of supply") — they ground the verdict
- End with one practical sentence on what the user should watch for next
- Output JSON only: { "narration": "..." }
- No emojis, no markdown`;

interface NarrationInput {
  vitals: TokenVitals;
  verdict: Verdict;
  riskScore: number;
  findings: RiskFinding[];
  concentration: ConcentrationStats;
  bundles: BundleCluster[];
}

export async function narrateVerdict(input: NarrationInput): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return fallbackNarration(input);
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            token: `${input.vitals.name} (${input.vitals.symbol})`,
            verdict: input.verdict,
            risk_score: input.riskScore,
            mcap_usd: input.vitals.mcapUsd,
            holders: input.vitals.holders,
            age_hours: input.vitals.ageHours,
            concentration: input.concentration,
            bundles: input.bundles.map((b) => ({
              members: b.members.length,
              pct: b.pctSupply,
            })),
            findings: input.findings.map((f) => ({
              title: f.title,
              detail: f.detail,
              severity: f.severity,
            })),
          }),
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const match = text.match(/\{[\s\S]*"narration"[\s\S]*\}/);
    if (!match) return fallbackNarration(input);
    const parsed = JSON.parse(match[0]) as { narration?: string };
    return parsed.narration ?? fallbackNarration(input);
  } catch (err) {
    console.error("LLM narration failed:", err);
    return fallbackNarration(input);
  }
}

function fallbackNarration(input: NarrationInput): string {
  const lead = input.findings[0];
  const verdictPhrase = {
    clean: "The evidence so far looks clean.",
    caution: "There are patterns worth watching here.",
    avoid: "The evidence shows multiple high-risk patterns.",
  }[input.verdict];

  const parts = [
    `${input.vitals.name} (${input.vitals.symbol}) scored ${input.riskScore}/100 on the risk dial.`,
    verdictPhrase,
  ];
  if (lead) parts.push(lead.detail);
  parts.push(
    `Watch the top wallets and any sudden funder activity over the next 24h.`
  );
  return parts.join(" ");
}
