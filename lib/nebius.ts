// Minimal client for Nebius Token Factory's OpenAI-compatible API.
// No SDK: one fetch per call keeps cold starts small on Vercel.
import { mockChat } from "./mock";

const BASE_URL = process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1";

export const MODELS = {
  // Heavy reasoning: compiles procedures, writes the audit.
  planner: process.env.SPOTTER_PLANNER_MODEL || "nvidia/Nemotron-3-Ultra-550b-a55b",
  // Vision: judges each camera frame against the current step.
  perception: process.env.SPOTTER_VISION_MODEL || "nvidia/Nemotron-3.5-Super-VL",
  // Fast, cheap real-time loop: decides what to do and what to say.
  controller: process.env.SPOTTER_CONTROLLER_MODEL || "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
  // Backup planner when Ultra is slow or unavailable.
  fallback: process.env.SPOTTER_FALLBACK_MODEL || "nvidia/nemotron-3-super-120b-a12b",
} as const;

export class ModelError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };

export type ChatResult = { text: string; ms: number; tokens?: number; model: string };

export const MOCK = process.env.SPOTTER_MOCK === "1" && process.env.NODE_ENV !== "production";

export function isConfigured() {
  return MOCK || Boolean(process.env.NEBIUS_API_KEY);
}

export async function chat(
  model: string,
  messages: ChatMessage[],
  opts: { maxTokens: number; temperature?: number; json?: boolean; thinking?: boolean; timeoutMs?: number; plain?: boolean },
): Promise<ChatResult> {
  if (MOCK) {
    await new Promise((r) => setTimeout(r, 300));
    return mockChat(model, messages);
  }
  const key = process.env.NEBIUS_API_KEY;
  if (!key) throw new ModelError("NEBIUS_API_KEY is not set on the server.", 503);

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature ?? 0.2,
  };
  if (opts.json && !opts.plain) body.response_format = { type: "json_object" };
  // Nemotron 3 models reason by default. The real-time loop can't afford that.
  if (opts.thinking === false && !opts.plain) body.chat_template_kwargs = { enable_thinking: false };

  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 45_000);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ModelError(ctrl.signal.aborted ? `${model} timed out` : `Network error calling ${model}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    // Some models reject optional params (JSON mode, thinking switch). Retry once without them.
    if (res.status === 400 && (opts.json || opts.thinking === false) && !opts.plain) {
      return chat(model, messages, { ...opts, plain: true });
    }
    throw new ModelError(`${model} returned ${res.status}: ${detail}`, res.status === 429 ? 429 : 502);
  }
  const data = await res.json();
  const raw: string = data?.choices?.[0]?.message?.content ?? "";
  return {
    text: stripThinking(raw),
    ms: Date.now() - started,
    tokens: data?.usage?.total_tokens,
    model,
  };
}

function stripThinking(text: string) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*<\/think>/, "").trim();
}

/** Models sometimes wrap JSON in prose or code fences. Pull out the first object. */
export function parseJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new ModelError("Model did not return JSON");
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    throw new ModelError("Model returned malformed JSON");
  }
}

/** Try the primary model; if it fails or times out, retry once on a fallback model. */
export async function chatWithFallback(
  primary: string,
  fallback: string,
  messages: ChatMessage[],
  opts: Parameters<typeof chat>[2] & { fallbackTimeoutMs?: number },
): Promise<ChatResult & { fellBack?: string }> {
  try {
    return await chat(primary, messages, opts);
  } catch (e) {
    if (primary === fallback || (e instanceof ModelError && e.status === 503)) throw e;
    const r = await chat(fallback, messages, { ...opts, thinking: false, timeoutMs: opts.fallbackTimeoutMs ?? 25_000 });
    return { ...r, fellBack: e instanceof Error ? e.message : "primary failed" };
  }
}
