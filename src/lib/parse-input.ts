const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function extractMint(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (BASE58_RE.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split("/").filter(Boolean);
    for (const seg of segments) {
      if (BASE58_RE.test(seg)) return seg;
    }
    const coinParam = url.searchParams.get("coin") ?? url.searchParams.get("mint");
    if (coinParam && BASE58_RE.test(coinParam)) return coinParam;
  } catch {
    return null;
  }

  return null;
}
