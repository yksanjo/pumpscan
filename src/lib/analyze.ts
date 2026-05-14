import { FIXTURES, type TokenFixture } from "./fixtures";
import { buildFixtureFromHelius } from "./helius";
import { computeConcentration, concentrationFinding } from "./detection/concentration";
import { detectBundles, bundlerFindings } from "./detection/bundler";
import { detectSnipers, sniperFindings } from "./detection/sniper";
import { predictGraduation } from "./detection/graduation-predictor";
import { scoreVerdict } from "./detection/verdict";
import { narrateVerdict } from "./llm";
import { cacheGet, cacheSet } from "./cache";
import type { AnalysisResult } from "./types";

export async function analyze(mint: string): Promise<AnalysisResult> {
  const cached = cacheGet<AnalysisResult>(`analyze:${mint}`);
  if (cached) return cached;

  const result = await analyzeUncached(mint);
  cacheSet(`analyze:${mint}`, result);
  return result;
}

async function analyzeUncached(mint: string): Promise<AnalysisResult> {
  const fixture: TokenFixture = await loadFixture(mint);
  const { vitals, holders, launchTxs, funderEdges } = fixture;

  const concentration = computeConcentration(holders);
  const bundles = detectBundles(holders, launchTxs, funderEdges);
  const snipers = detectSnipers(launchTxs, funderEdges, holders);

  const findings = [];
  const concFinding = concentrationFinding(concentration);
  if (concFinding) findings.push(concFinding);
  findings.push(...bundlerFindings(bundles));
  findings.push(...sniperFindings(snipers));

  const { verdict, confidence, riskScore, extraFindings } = scoreVerdict(
    findings,
    vitals
  );
  const allFindings = [...findings, ...extraFindings].sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity)
  );

  const graduation = predictGraduation(vitals, concentration, bundles, allFindings);

  const narration = await narrateVerdict({
    vitals,
    verdict,
    riskScore,
    findings: allFindings,
    concentration,
    bundles,
  });

  return {
    mint,
    generatedAt: Date.now(),
    verdict,
    confidence,
    riskScore,
    vitals,
    concentration,
    bundles,
    findings: allFindings,
    narration,
    graduation,
  };
}

function severityRank(s: string): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[s as "critical"] ?? 0;
}

async function loadFixture(mint: string): Promise<TokenFixture> {
  const local = FIXTURES[mint];
  if (local) return local;
  if (!process.env.HELIUS_API_KEY) {
    throw new Error(
      `Mint ${mint} not in fixtures and HELIUS_API_KEY is not set. Add it to .env.local to analyze real tokens.`
    );
  }
  return buildFixtureFromHelius(mint);
}
