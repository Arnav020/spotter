import { NextResponse } from "next/server";
import { chat, MODELS, ModelError, parseJson } from "@/lib/nebius";
import { allow } from "@/lib/ratelimit";
import type { Decision, Perception, Step, TraceEntry } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

type Body = {
  image: string;
  steps: Step[];
  currentIndex: number;
  task: string;
  recent: string[];
  lang: "en" | "hi";
};

const PERCEPTION_SYSTEM = `You are the eyes of Spotter, an assistant that watches a person do a hands-on task through a camera.
You get ONE camera frame, the CURRENT step, and the next steps. Judge only what is visible. Do not assume.

Reply with JSON only:
{"scene": "one short sentence describing what is happening",
 "currentStep": {"status": "not_started|in_progress|done|not_visible", "confidence": 0.0, "evidence": "what you see that supports this"},
 "aheadDone": [{"stepId": "s4", "confidence": 0.0}],
 "hazards": ["visible safety problems, if any"],
 "viewQuality": "good|poor"}

- "done" means the frame shows the step's visual check is satisfied, or its result is clearly visible.
- "aheadDone" lists LATER steps whose result is already visible (meaning the person skipped ahead). Leave it empty when unsure.
- "viewQuality" is "poor" if the work area is out of frame, too dark, or too blurry to judge.`;

const CONTROLLER_SYSTEM = `You are Spotter's real-time coach. You get what the camera saw and decide the next action.
Actions:
- "advance": the current step is done.
- "stay": keep waiting, the step is not done yet.
- "warn": a mistake is happening or a later step was started early (not safety-critical).
- "alarm": a safety-critical step was skipped or a visible hazard exists. Tell them to stop.
- "reframe": the camera can't see the work.
"say" is ONE short spoken sentence (max 14 words), calm and specific, addressed to the person. Don't repeat the same sentence you said recently. For "stay" with nothing new, "say" may be "".
Reply with JSON only: {"action": "...", "say": "...", "reason": "short reason for the log"}`;

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b || typeof b.image !== "string" || !b.image.startsWith("data:image/") || !Array.isArray(b.steps))
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (b.image.length > 1_500_000) return NextResponse.json({ error: "Frame too large" }, { status: 413 });
  const idx = Math.max(0, Math.min(b.steps.length - 1, Number(b.currentIndex) || 0));
  if (!allow("observe", req)) return NextResponse.json({ error: "Daily demo limit reached." }, { status: 429 });

  const current = b.steps[idx];
  const ahead = b.steps.slice(idx + 1, idx + 4);
  const trace: TraceEntry[] = [];

  try {
    const stepText =
      `Task: ${b.task}\n\nCURRENT step ${current.id}: ${current.title}\nVisual check: ${current.visualCheck}\n` +
      (current.watchFor.length ? `Watch for: ${current.watchFor.join("; ")}\n` : "") +
      `\nNext steps:\n${ahead.map((s) => `${s.id}: ${s.title}: ${s.visualCheck}`).join("\n") || "(none, this is the last step)"}`;

    const p = await chat(
      MODELS.perception,
      [
        { role: "system", content: PERCEPTION_SYSTEM },
        { role: "user", content: [{ type: "text", text: stepText }, { type: "image_url", image_url: { url: b.image } }] },
      ],
      { maxTokens: 400, json: true, thinking: false, timeoutMs: 20_000 },
    );
    trace.push({ at: Date.now(), role: "perception", model: p.model, ms: p.ms, tokens: p.tokens, note: "Judged the frame" });
    const perception = normalizePerception(parseJson<Perception>(p.text), ahead);

    const skippedCritical = criticalSkipped(perception, b.steps, idx);
    const c = await chat(
      MODELS.controller,
      [
        { role: "system", content: CONTROLLER_SYSTEM },
        {
          role: "user",
          content:
            `Current step: ${current.title} (${current.safetyCritical ? "SAFETY-CRITICAL" : "normal"})\n` +
            `Camera: ${JSON.stringify(perception)}\n` +
            (skippedCritical ? `NOTE: the person moved on without doing the safety-critical step "${skippedCritical.title}".\n` : "") +
            `Recently said: ${b.recent.slice(-3).join(" | ") || "(nothing)"}\n` +
            `Language for "say": ${b.lang === "hi" ? "Hindi (Devanagari script)" : "English"}`,
        },
      ],
      { maxTokens: 200, json: true, thinking: false, timeoutMs: 12_000 },
    );
    trace.push({ at: Date.now(), role: "controller", model: c.model, ms: c.ms, tokens: c.tokens, note: "Chose the action" });

    const decision = guard(parseJson<Decision>(c.text), perception, current, skippedCritical);
    return NextResponse.json({ perception, decision, trace });
  } catch (e) {
    const err = e instanceof ModelError ? e : new ModelError("Unexpected error");
    return NextResponse.json({ error: err.message, trace }, { status: err.status });
  }
}

function normalizePerception(p: Perception, ahead: Step[]): Perception {
  const ids = new Set(ahead.map((s) => s.id));
  const cs = p.currentStep ?? ({} as Perception["currentStep"]);
  return {
    scene: String(p.scene ?? ""),
    currentStep: {
      status: ["not_started", "in_progress", "done", "not_visible"].includes(cs.status) ? cs.status : "not_visible",
      confidence: clamp01(Number(cs.confidence)),
      evidence: String(cs.evidence ?? ""),
    },
    aheadDone: (Array.isArray(p.aheadDone) ? p.aheadDone : [])
      .filter((a) => ids.has(a.stepId))
      .map((a) => ({ stepId: a.stepId, confidence: clamp01(Number(a.confidence)) })),
    hazards: (Array.isArray(p.hazards) ? p.hazards : []).map(String).filter(Boolean).slice(0, 3),
    viewQuality: p.viewQuality === "poor" ? "poor" : "good",
  };
}

/** The person jumped ahead while a safety-critical step (current or in between) is still undone. */
function criticalSkipped(p: Perception, steps: Step[], idx: number): Step | null {
  const jumped = p.aheadDone.filter((a) => a.confidence >= 0.6);
  if (!jumped.length || p.currentStep.status === "done") return null;
  const furthest = Math.max(...jumped.map((a) => steps.findIndex((s) => s.id === a.stepId)));
  return steps.slice(idx, furthest).find((s) => s.safetyCritical) ?? null;
}

// The language model proposes; these rules have the final say on safety and on advancing.
function guard(d: Decision, p: Perception, current: Step, skipped: Step | null): Decision {
  const actions = ["stay", "advance", "warn", "alarm", "reframe"];
  let out: Decision = {
    action: actions.includes(d.action) ? d.action : "stay",
    say: String(d.say ?? "").slice(0, 160),
    reason: String(d.reason ?? ""),
  };
  if (skipped) {
    return {
      action: "alarm",
      say: out.action === "alarm" && out.say ? out.say : `Stop. You skipped "${skipped.title}". Do that first.`,
      reason: `Safety-critical step "${skipped.title}" skipped`,
    };
  }
  if (p.viewQuality === "poor" && out.action !== "alarm") {
    return { action: "reframe", say: out.say || "I can't see your hands. Move the camera.", reason: "Poor view" };
  }
  const doneConfident = p.currentStep.status === "done" && p.currentStep.confidence >= 0.6;
  if (out.action === "advance" && !doneConfident) out = { ...out, action: "stay", reason: `${out.reason} (held: low confidence)` };
  if (doneConfident && (out.action === "stay" || out.action === "warn") && !p.hazards.length)
    out = { ...out, action: "advance", reason: `${out.reason} (step verified)` };
  if (out.action === "advance" && current.safetyCritical && p.currentStep.confidence < 0.75)
    out = { ...out, action: "stay", say: `Show me clearly: ${current.visualCheck}`, reason: "Safety-critical step needs stronger evidence" };
  return out;
}

function clamp01(n: number) {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
