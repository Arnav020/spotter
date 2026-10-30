// Quick live check of every Token Factory model Spotter uses.
// Usage: node --env-file=.env scripts/smoke.mjs
const BASE = process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1";
const KEY = process.env.NEBIUS_API_KEY;
if (!KEY) throw new Error("NEBIUS_API_KEY missing");

const models = {
  planner: process.env.SPOTTER_PLANNER_MODEL || "nvidia/Nemotron-3-Ultra-550b-a55b",
  perception: process.env.SPOTTER_VISION_MODEL || "nvidia/Nemotron-3.5-Super-VL",
  controller: process.env.SPOTTER_CONTROLLER_MODEL || "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
};

const list = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${KEY}` } });
console.log("GET /models", list.status);
if (list.ok) {
  const ids = (await list.json()).data.map((m) => m.id);
  console.log("NVIDIA models available:", ids.filter((i) => /nvidia|nemotron/i.test(i)));
  for (const [role, id] of Object.entries(models)) console.log(`${role}: ${id} ${ids.includes(id) ? "OK" : "NOT IN LIST"}`);
}

// 1x1 white JPEG-ish PNG for a vision sanity check
const img = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

async function call(role, extra = {}, content = 'Reply with JSON only: {"ok": true}') {
  const t = Date.now();
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: models[role], messages: [{ role: "user", content }], max_tokens: 300, ...extra }),
  });
  const body = await r.text();
  let text = body;
  try { text = JSON.parse(body).choices[0].message.content; } catch {}
  console.log(`\n[${role}] ${JSON.stringify(extra)} -> ${r.status} in ${Date.now() - t}ms\n${String(text).slice(0, 300)}`);
}

await call("controller", { response_format: { type: "json_object" }, chat_template_kwargs: { enable_thinking: false } });
await call("controller", { response_format: { type: "json_object" } });
await call("planner", { response_format: { type: "json_object" } });
await call("perception", { response_format: { type: "json_object" }, chat_template_kwargs: { enable_thinking: false } }, [
  { type: "text", text: 'What colour is this image? Reply with JSON only: {"colour": "..."}' },
  { type: "image_url", image_url: { url: img } },
]);
