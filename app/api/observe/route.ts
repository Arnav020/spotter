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
  /** Consecutive frames with no change. After a few, the controller gets a turn to nudge the person. */
  quietStreak: number;
  /** The camera's verdicts on the current step from the last few frames, oldest first. */
  history?: Perception["currentStep"][];
};

const PERCEPTION_SYSTEM = `You are the eyes of Spotter, an assistant that watches a person do a hands-on task through a camera.
You get ONE camera frame, the CURRENT step, and the next steps. Judge only what is visible. Do not assume.

Reply with JSON only:
{"scene": "one short sentence describing what is happening",
 "currentStep": {"status": "not_started|in_progress|done|not_visible", "confidence": 0.0, "evidence": "what you see that supports this"},
 "aheadDone": [{"stepId": "s4", "confidence": 0.0}],
 "hazards": ["visible safety problems, if any"],
 "viewQuality": "good|poor"}

- "done" means the step's visual check is satisfied: its end result is visible now, OR earlier frames showed the action happening and this frame shows it has finished (e.g. the packet was being poured and is now set aside, crumpled or flat).
- Real kitchens and workshops: products can be any brand, any language, or unlabelled. Judge objects by what they are and how they're used (any small sachet or packet counts as "the packet"; any jug, bottle or bowl counts as "the container").
- A camera can't measure exactly. For amounts, judge roughly: a container that looks about full after pouring, or an emptied 1-litre bottle, counts as 1 litre.
- Be decisive. If you can see it, say so with honest confidence; don't hold back just because the image is from a webcam.
- "aheadDone" lists LATER steps whose result is already visible (meaning the person skipped ahead). Leave it empty when unsure.
- "hazards" lists only physical dangers you can actually see (e.g. a knife pointing at a hand, an opened device still plugged in). Never list things that are missing, not yet done, or not visible. Usually empty.
- "viewQuality" is "poor" ONLY if you genuinely can't see the work area at all (pointing away, black, or extremely blurry). An ordinary webcam view of a table is "good".`;

const CONTROLLER_SYSTEM = `You are Spotter's real-time coach. You get what the camera saw and decide the next action.
Actions:
- "advance": the current step is done.
- "stay": keep waiting, the step is not done yet.
- "warn": a mistake is happening or a later step was started early (not safety-critical).
- "alarm": ONLY when the input has a NOTE saying a safety-critical step was skipped, or "hazards" is not empty. Tell them to stop. A step that hasn't started yet or isn't visible is never an alarm.
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
      (b.history?.length
        ? `Earlier frames for this step (oldest first): ${b.history
            .slice(-3)
            .map((h) => `${h.status} ${Number(h.confidence).toFixed(2)}: ${String(h.evidence).slice(0, 140)}`)
            .join(" | ")}\n`
        : "") +
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
    // Log what the model saw (never the image) so real-camera behaviour can be tuned from the logs.
    console.log("observe", JSON.stringify({ step: current.id, ...perception.currentStep, view: perception.viewQuality, ahead: perception.aheadDone, scene: perception.scene }));

    const skippedCritical = criticalSkipped(perception, b.steps, idx);

    // Nothing new to react to: let the rules hold position and spare the controller call.
    const quiet =
      !skippedCritical &&
      perception.viewQuality === "good" &&
      perception.hazards.length === 0 &&
      perception.aheadDone.every((a) => a.confidence < 0.6) &&
      perception.currentStep.status !== "done" &&
      (Number(b.quietStreak) || 0) < 3;
    if (quiet) {
      trace.push({ at: Date.now(), role: "controller", model: "rules", ms: 0, note: "No change, so the controller wasn't called" });
      return NextResponse.json({ perception, decision: { action: "stay", say: "", reason: "No change" }, trace });
    }

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

    const decision = guard(parseJson<Decision>(c.text), perception, current, skippedCritical, b.lang === "hi", b.recent ?? [], agreed(perception, b.history));
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
    hazards: (Array.isArray(p.hazards) ? p.hazards : [])
      .map(String)
      .filter((h) => h && !/(not visible|no hands?|not shown|missing|cannot see|can't see|unclear|none)/i.test(h))
      .slice(0, 3),
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
/**
 * Webcam frames are noisy, so one frame rarely gives high confidence. Two frames in a row that both
 * say "done" are stronger evidence than either alone: count them as one confident verdict.
 */
function agreed(p: Perception, history: Body["history"]): number {
  const c = p.currentStep;
  const prev = history?.[history.length - 1];
  if (c.status === "done" && prev?.status === "done" && c.confidence >= 0.5 && Number(prev.confidence) >= 0.5) return Math.max(c.confidence, 0.8);
  return c.confidence;
}

function guard(d: Decision, p: Perception, current: Step, skipped: Step | null, hi: boolean, recent: string[], confidence: number): Decision {
  const out = decide(d, { ...p, currentStep: { ...p.currentStep, confidence } }, current, skipped, hi);
  // Never nag with the same line. Second time, point to the manual button; after that, stay quiet.
  // Alarms always repeat.
  const last = recent.slice(-3);
  if (out.action === "alarm" || !out.say || !last.includes(out.say)) return out;
  const hint = hi ? "अगर यह हो गया है, तो 'स्टेप पूरा' दबाइए।" : "If it's done, tap Mark step done.";
  return { ...out, say: last.includes(hint) ? "" : hint };
}

function decide(d: Decision, p: Perception, current: Step, skipped: Step | null, hi: boolean): Decision {
  const actions = ["stay", "advance", "warn", "alarm", "reframe"];
  let out: Decision = {
    action: actions.includes(d.action) ? d.action : "stay",
    say: String(d.say ?? "").slice(0, 160),
    reason: String(d.reason ?? ""),
  };
  if (skipped) {
    return {
      action: "alarm",
      say: out.action === "alarm" && out.say ? out.say : hi ? `रुकिए। आपने "${skipped.title}" छोड़ दिया। पहले वह कीजिए।` : `Stop. You skipped "${skipped.title}". Do that first.`,
      reason: `Safety-critical step "${skipped.title}" skipped`,
    };
  }
  // Only the rules or a visible hazard can stop someone. The model can't raise an alarm on its own.
  if (out.action === "alarm" && !p.hazards.length)
    out = {
      action: "stay",
      say: hi ? `अब यह कीजिए: ${current.title}।` : `Next: ${current.title}.`,
      reason: `${out.reason} (alarm held: nothing hazardous seen)`,
    };
  if (p.viewQuality === "poor" && out.action !== "alarm") {
    return { action: "reframe", say: out.say || (hi ? "मुझे आपका काम नहीं दिख रहा। कैमरा ठीक कीजिए।" : "I can't see your hands. Move the camera."), reason: "Poor view" };
  }
  const doneConfident = p.currentStep.status === "done" && p.currentStep.confidence >= 0.6;
  if (out.action === "advance" && !doneConfident) out = { ...out, action: "stay", reason: `${out.reason} (held: low confidence)` };
  if (doneConfident && (out.action === "stay" || out.action === "warn") && !p.hazards.length)
    out = { ...out, action: "advance", reason: `${out.reason} (step verified)` };
  if (out.action === "advance" && current.safetyCritical && p.currentStep.confidence < 0.7)
    out = { ...out, action: "stay", say: hi ? "यह स्टेप कैमरे को साफ़ दिखाइए।" : `Hold it up so I can see clearly: ${current.title}.`, reason: "Safety-critical step needs stronger evidence" };
  return out;
}

function clamp01(n: number) {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
