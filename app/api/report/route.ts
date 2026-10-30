import { NextResponse } from "next/server";
import { chat, MODELS, ModelError, parseJson } from "@/lib/nebius";
import { allow } from "@/lib/ratelimit";
import type { Audit, Procedure, SessionEvent, TraceEntry } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are Spotter's auditor. You review the log of a hands-on procedure that a camera agent supervised and write a short, fair audit for a supervisor or trainer.
- Judge against the checklist. Skipped or manually overridden safety-critical steps are critical findings.
- Steps the person marked done by hand were NOT verified by the camera: say so.
- Be specific and kind. No filler.
Reply with JSON only:
{"verdict": "pass|pass_with_issues|fail", "score": 0-100, "headline": "one sentence", "findings": [{"severity": "info|warning|critical", "stepId": "s1 or null", "text": "..."}], "coaching": ["max 3 concrete tips for next time"]}`;

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { procedure: Procedure; events: SessionEvent[]; durationMs: number } | null;
  if (!b?.procedure?.steps || !Array.isArray(b.events)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (!allow("report", req)) return NextResponse.json({ error: "Daily demo limit reached." }, { status: 429 });

  const checklist = b.procedure.steps
    .map((s) => `${s.id} ${s.safetyCritical ? "[SAFETY-CRITICAL] " : ""}${s.title}: ${s.visualCheck}`)
    .join("\n");
  const t0 = b.events[0]?.at ?? 0;
  const log = b.events
    .slice(0, 200)
    .map((e) => `+${Math.round((e.at - t0) / 1000)}s ${e.kind}${e.stepId ? ` ${e.stepId}` : ""}: ${String(e.detail).slice(0, 200)}`)
    .join("\n");

  try {
    const r = await chat(
      MODELS.planner,
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Task: ${b.procedure.task}\nDuration: ${Math.round(b.durationMs / 1000)}s\n\nChecklist:\n${checklist}\n\nSession log:\n${log}` },
      ],
      { maxTokens: 4000, json: true, timeoutMs: 55_000 },
    );
    const trace: TraceEntry[] = [{ at: Date.now(), role: "auditor", model: r.model, ms: r.ms, tokens: r.tokens, note: "Wrote the audit" }];
    const a = parseJson<Audit>(r.text);
    const audit: Audit = {
      verdict: ["pass", "pass_with_issues", "fail"].includes(a.verdict) ? a.verdict : "pass_with_issues",
      score: Math.max(0, Math.min(100, Math.round(Number(a.score) || 0))),
      headline: String(a.headline ?? ""),
      findings: (a.findings ?? []).slice(0, 12).map((f) => ({
        severity: ["info", "warning", "critical"].includes(f.severity) ? f.severity : "info",
        stepId: f.stepId ?? null,
        text: String(f.text ?? ""),
      })),
      coaching: (a.coaching ?? []).slice(0, 3).map(String),
    };
    return NextResponse.json({ audit, trace });
  } catch (e) {
    const err = e instanceof ModelError ? e : new ModelError("Unexpected error");
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
