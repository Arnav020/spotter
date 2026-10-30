import { NextResponse } from "next/server";
import { chat, MODELS, ModelError, parseJson } from "@/lib/nebius";
import { allow } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 30;

// Translates step titles and instructions once per session, so spoken announcements
// and captions match the chosen language (Hindi today).
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { lang: string; items: { id: string; title: string; instruction: string }[] } | null;
  if (!b || b.lang !== "hi" || !Array.isArray(b.items) || b.items.length > 12)
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (!allow("compile", req)) return NextResponse.json({ error: "Daily demo limit reached." }, { status: 429 });

  try {
    const r = await chat(
      MODELS.controller,
      [
        {
          role: "system",
          content:
            'Translate each step into simple, everyday spoken Hindi (Devanagari) that a caregiver or worker would use. Keep product names and numbers. Reply with JSON only: {"items": [{"id": "s1", "title": "...", "instruction": "..."}]}',
        },
        { role: "user", content: JSON.stringify(b.items.map(({ id, title, instruction }) => ({ id, title, instruction: instruction.slice(0, 300) }))) },
      ],
      { maxTokens: 2000, json: true, thinking: false, timeoutMs: 25_000 },
    );
    const out = parseJson<{ items: { id: string; title: string; instruction: string }[] }>(r.text);
    return NextResponse.json({
      items: (out.items ?? []).filter((i) => i && i.id && i.title),
      trace: [{ at: Date.now(), role: "controller", model: r.model, ms: r.ms, tokens: r.tokens, note: "Translated steps to Hindi" }],
    });
  } catch (e) {
    const err = e instanceof ModelError ? e : new ModelError("Unexpected error");
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
