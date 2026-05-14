const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;

const hits = new Map<string, number[]>();

export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  return "unknown";
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
  remaining: number;
}

export function rateLimit(ip: string): RateLimitResult {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const history = (hits.get(ip) ?? []).filter((t) => t > cutoff);

  if (history.length >= MAX_REQUESTS) {
    const oldest = history[0];
    const retryAfterMs = Math.max(1000, oldest + WINDOW_MS - now);
    hits.set(ip, history);
    return {
      ok: false,
      retryAfterSec: Math.ceil(retryAfterMs / 1000),
      remaining: 0,
    };
  }

  history.push(now);
  hits.set(ip, history);

  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (v.length === 0 || v[v.length - 1] < cutoff) hits.delete(k);
    }
  }

  return {
    ok: true,
    retryAfterSec: 0,
    remaining: MAX_REQUESTS - history.length,
  };
}
