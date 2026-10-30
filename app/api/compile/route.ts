import { NextResponse } from "next/server";
import { chat, MODELS, ModelError, parseJson } from "@/lib/nebius";
import { searchProcedure } from "@/lib/tavily";
import { allow } from "@/lib/ratelimit";
import type { Procedure, Step, TraceEntry } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are Spotter's procedure compiler. You turn a hands-on task into a checklist that a camera can verify.

Rules:
- 4 to 9 steps, in the order they must happen.
- Every step needs a "visualCheck": one concrete sentence describing what is VISIBLE in a camera frame when the step is done. Never use things a camera cannot see (smell, temperature, sound, intent).
- Mark "safetyCritical": true only when skipping or reordering the step can injure someone, damage equipment, or make the result unsafe.
- "watchFor": up to 2 common real-world mistakes for that step.
- Base the steps on the provided sources when they are relevant, and list the indexes of the sources you actually used. If the sources are irrelevant, rely on established best practice and return an empty list.
- If the task is not a physical, camera-observable activity, or is dangerous to coach (weapons, drugs, self-harm), set "refuse" to a short reason.

Reply with JSON only:
{"refuse": null, "task": "...", "summary": "one sentence on why checking this matters", "setupTip": "where to put the camera", "steps": [{"title": "...", "instruction": "...", "visualCheck": "...", "safetyCritical": false, "watchFor": ["..."]}], "usedSources": [0]}`;

type Compiled = {
  refuse: string | null;
  task: string;
  summary: string;
  setupTip: string;
  steps: Omit<Step, "id">[];
  usedSources: number[];
};

export async function POST(req: Request) {
  const { task } = (await req.json().catch(() => ({}))) as { task?: string };
  const clean = String(task ?? "").trim().slice(0, 200);
  if (clean.length < 4) return NextResponse.json({ error: "Describe the task in a few words." }, { status: 400 });
  if (!allow("compile", req)) return NextResponse.json({ error: "Daily demo limit reached. Try a preset." }, { status: 429 });

  const trace: TraceEntry[] = [];
  try {
    const { hits, ms } = await searchProcedure(clean);
    trace.push({ at: Date.now(), role: "search", model: "Tavily Search", ms, note: `${hits.length} sources found` });

    const sourcesText = hits.length
      ? hits.map((h, i) => `[${i}] ${h.title} (${h.url})\n${h.content}`).join("\n\n")
      : "(no sources found)";

    const r = await chat(
      MODELS.planner,
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Task: ${clean}\n\nSources:\n${sourcesText}` },
      ],
      { maxTokens: 6000, json: true, timeoutMs: 55_000 },
    );
    trace.push({ at: Date.now(), role: "planner", model: r.model, ms: r.ms, tokens: r.tokens, note: "Compiled the verifiable checklist" });

    const c = parseJson<Compiled>(r.text);
    if (c.refuse) return NextResponse.json({ error: `Spotter can't coach this: ${c.refuse}`, trace }, { status: 422 });
    if (!Array.isArray(c.steps) || c.steps.length < 2) throw new ModelError("Planner returned too few steps");

    const procedure: Procedure = {
      id: `custom-${Date.now()}`,
      task: c.task || clean,
      summary: c.summary ?? "",
      setupTip: c.setupTip ?? "Keep your hands and the work area in frame.",
      steps: c.steps.slice(0, 10).map((s, i) => ({
        id: `s${i + 1}`,
        title: String(s.title ?? `Step ${i + 1}`),
        instruction: String(s.instruction ?? ""),
        visualCheck: String(s.visualCheck ?? s.instruction ?? ""),
        safetyCritical: Boolean(s.safetyCritical),
        watchFor: Array.isArray(s.watchFor) ? s.watchFor.slice(0, 2).map(String) : [],
      })),
      sources: (c.usedSources ?? [])
        .filter((i) => Number.isInteger(i) && hits[i])
        .map((i) => ({ title: hits[i].title, url: hits[i].url })),
      compiledBy: `Nemotron 3 Ultra${hits.length ? " + Tavily" : ""}`,
    };
    return NextResponse.json({ procedure, trace });
  } catch (e) {
    const err = e instanceof ModelError ? e : new ModelError("Unexpected error");
    return NextResponse.json({ error: err.message, trace }, { status: err.status });
  }
}
