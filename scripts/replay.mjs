// Offline evaluation: replay a recorded video through Spotter's real /api/observe loop
// and compare when each step was verified against hand-labelled ground truth.
//
// Usage:
//   node scripts/replay.mjs <video.mp4> <presetId> [labels.json] [--every 2] [--url http://localhost:3101]
// labels.json (optional): {"s1": 4.0, "s2": 9.5, ...}  = second at which each step is visibly complete
//
// Needs ffmpeg on PATH (or FFMPEG env var) and a running Spotter server with a real NEBIUS_API_KEY.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : def;
};
const every = Number(flag("every", "2"));
const base = flag("url", "http://localhost:3101");
const [video, presetId, labelsPath] = args;
if (!video || !presetId) {
  console.error("usage: node scripts/replay.mjs <video> <presetId> [labels.json] [--every 2] [--url ...]");
  process.exit(1);
}

// Load presets by transpiling-free trick: fetch them through the page bundle is overkill; read the TS file.
const presetsSrc = readFileSync(new URL("../lib/presets.ts", import.meta.url), "utf8");
const json = presetsSrc.slice(presetsSrc.indexOf("["), presetsSrc.lastIndexOf("]") + 1);
// eslint-disable-next-line no-new-func
const PRESETS = Function(`return ${json}`)();
const preset = PRESETS.find((p) => p.id === presetId);
if (!preset) throw new Error(`unknown preset ${presetId}`);
const labels = labelsPath ? JSON.parse(readFileSync(labelsPath, "utf8")) : null;

const dir = mkdtempSync(join(tmpdir(), "spotter-replay-"));
execFileSync(process.env.FFMPEG || "ffmpeg", ["-loglevel", "error", "-i", video, "-vf", `fps=1/${every},scale=640:-2`, "-q:v", "4", join(dir, "f%04d.jpg")]);
const frames = readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
console.log(`${frames.length} frames, one every ${every}s\n`);

let idx = 0;
let quiet = 0;
const recent = [];
const verifiedAt = {};
const alarms = [];
const latencies = [];

for (let k = 0; k < frames.length && idx < preset.steps.length; k++) {
  const t = k * every;
  const image = `data:image/jpeg;base64,${readFileSync(join(dir, frames[k])).toString("base64")}`;
  const started = Date.now();
  const res = await fetch(`${base}/api/observe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image, steps: preset.steps, currentIndex: idx, task: preset.task, recent, lang: "en", quietStreak: quiet }),
  });
  const data = await res.json();
  latencies.push(Date.now() - started);
  if (!res.ok) {
    console.log(`t=${t}s ERROR ${data.error}`);
    continue;
  }
  const { perception: p, decision: d } = data;
  quiet = d.reason === "No change" ? quiet + 1 : 0;
  if (d.say) recent.push(d.say);
  console.log(
    `t=${String(t).padStart(4)}s ${preset.steps[idx].id} ${p.currentStep.status.padEnd(11)} ${p.currentStep.confidence.toFixed(2)}  ${d.action.padEnd(7)} ${d.say || ""}`,
  );
  if (d.action === "alarm") alarms.push({ t, step: preset.steps[idx].id, reason: d.reason });
  if (d.action === "advance") {
    verifiedAt[preset.steps[idx].id] = t;
    idx++;
  }
}

const sorted = [...latencies].sort((a, b) => a - b);
console.log("\n=== summary ===");
console.log(`steps verified: ${Object.keys(verifiedAt).length}/${preset.steps.length}`);
console.log(`alarms: ${alarms.length}`, alarms);
console.log(`latency p50 ${sorted[Math.floor(sorted.length / 2)]}ms, p90 ${sorted[Math.floor(sorted.length * 0.9)]}ms`);
if (labels) {
  for (const s of preset.steps) {
    const truth = labels[s.id];
    const got = verifiedAt[s.id];
    const lag = truth != null && got != null ? (got - truth).toFixed(1) : "-";
    console.log(`${s.id} ${s.title.padEnd(34)} truth=${truth ?? "-"} verified=${got ?? "MISSED"} lag=${lag}s`);
  }
}
