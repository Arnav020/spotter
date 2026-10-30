// Spending guard for the public demo. It's in-memory, so each serverless instance
// keeps its own counters. That's good enough to stop a runaway loop or a casual
// abuser from draining the Token Factory credits.

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

const DAY = 24 * 60 * 60 * 1000;

const LIMITS = {
  compile: { perIp: Number(process.env.LIMIT_COMPILE_PER_IP ?? 15), global: Number(process.env.LIMIT_COMPILE_GLOBAL ?? 150) },
  observe: { perIp: Number(process.env.LIMIT_OBSERVE_PER_IP ?? 400), global: Number(process.env.LIMIT_OBSERVE_GLOBAL ?? 3000) },
  report: { perIp: Number(process.env.LIMIT_REPORT_PER_IP ?? 15), global: Number(process.env.LIMIT_REPORT_GLOBAL ?? 150) },
};

function hit(key: string, limit: number) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt < now) {
    b = { count: 0, resetAt: now + DAY };
    buckets.set(key, b);
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

export function allow(kind: keyof typeof LIMITS, req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const l = LIMITS[kind];
  return hit(`${kind}:global`, l.global) && hit(`${kind}:${ip}`, l.perIp);
}
