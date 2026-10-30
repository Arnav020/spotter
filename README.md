# Spotter: a second pair of eyes for hands-on work

**Point any camera at a hands-on task. Spotter turns the right procedure into a camera-verifiable checklist, watches every step happen, stops you the moment a safety-critical step is skipped, and hands you an audit with photo evidence.**

Built for the **Nebius × NVIDIA Global AI Hackathon, Physical AI track**. It runs entirely on **NVIDIA Nemotron models served by Nebius Token Factory**, with **Tavily** grounding every custom procedure in real sources.

- **Live demo:** https://spotter-nemotron.vercel.app *(camera or upload-a-video; works on phones)*
- **Demo video:** _link added on submission_
- **License:** MIT

---

## The problem

Most hands-on failures aren't caused by not knowing *what* to do. They come from **one skipped or out-of-order step**:

- A caregiver mixes ORS with half the water, and the solution becomes harmful to a dehydrated child.
- A food handler rushes hand-washing and skips the soap or thumbs.
- A repair trainee opens a laptop that's still on charge.
- A technician forgets lockout before touching a circuit.

Paper checklists get ticked without anyone looking, and supervisors can't watch everyone. Generic chatbots can *tell* you the steps, but they can't *see* whether you did them.

## What Spotter does

1. **Plan.** Type any task, or pick a preset. **Tavily** finds authoritative procedures and safety guidance. **Nemotron 3 Ultra** compiles them into a checklist where every step has a *visual success criterion* (what a camera must see), a safety-critical flag, and common mistakes to watch for. Sources are cited.
2. **See.** Any camera works: a laptop webcam, a phone (rear camera) or an uploaded video. An **on-device change detector** in the browser compares 32×24 thumbnails and only sends a frame when the scene actually moves, plus a heartbeat every 6 s. **Nemotron 3.5 Super VL** judges each frame against the current step *and* the next steps, so it can tell when you skip ahead.
3. **Act.** **Nemotron 3 Nano** is the real-time controller. It decides whether to advance, wait, warn, ask you to reframe the camera, or raise an alarm, and it writes one short spoken sentence in English or Hindi. **Deterministic safety rules have the final say**: a skipped safety-critical step always triggers a stop alarm, and safety-critical steps need stronger visual evidence before they count. On alarm, Spotter flashes the screen, beeps, speaks, and can call an **IoT webhook**, for example to cut a smart plug via Home Assistant or IFTTT.
4. **Audit.** Every completed step keeps a timestamped evidence frame. **Nemotron 3 Ultra** reviews the session log and writes a fair audit: a verdict, a score, findings (including steps that were only marked done by hand) and coaching. Export it as PDF or JSON.

## How NVIDIA Nemotron and Nebius Token Factory are used

All inference goes through Token Factory's OpenAI-compatible endpoint (`https://api.tokenfactory.nebius.com/v1`). Each model tier does the job it's best at:

| Role | Model on Token Factory | Why this tier | Where |
|---|---|---|---|
| Planner | `nvidia/Nemotron-3-Ultra-550b-a55b` | Deep reasoning to turn messy web sources into precise, camera-checkable steps | [`app/api/compile`](app/api/compile/route.ts) |
| Perception | `nvidia/Nemotron-3.5-Super-VL` | Vision-language judging of each frame against step criteria | [`app/api/observe`](app/api/observe/route.ts) |
| Controller | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | Very fast and cheap; runs on every frame with reasoning turned off | [`app/api/observe`](app/api/observe/route.ts) |
| Auditor | `nvidia/Nemotron-3-Ultra-550b-a55b` | Fair, specific judgement over the whole session | [`app/api/report`](app/api/report/route.ts) |

The UI shows a live **model trace** (role, model, latency) so you can always see which model did what.

**Where Token Factory helped**
- One API key and one endpoint for vision and three text tiers, so swapping tiers is a one-line change ([`lib/nebius.ts`](lib/nebius.ts)). That let us route the real-time loop to Nano and keep Ultra for planning and auditing, which makes each live-loop call more than 10× cheaper than using Ultra for everything.
- OpenAI-compatible JSON mode plus `chat_template_kwargs.enable_thinking=false` made the per-frame controller fast and structured.
- No GPU provisioning, so all the time went into the product.

## How Tavily is used

Custom tasks call Tavily Search (advanced depth) at runtime. The top sources are passed to Nemotron 3 Ultra, which must say which sources it actually used. Those are shown as citations on the checklist, so a procedure is grounded in real guidance (WHO, CDC, manufacturers) instead of model memory.

## Why this is Physical AI

Spotter is an **edge agent that senses and acts in the physical world**:
- **Senses:** a live camera feed of real hands doing real work, with on-device change detection deciding what is worth sending to the cloud.
- **Reasons:** a model-tiered agent runtime (perception → controller → guard rules → auditor).
- **Acts:** spoken guidance, visual and audible alarms, and an IoT webhook that can physically cut power to a device.

## Architecture

```
 camera / phone / video
        │  every 500 ms
        ▼
 on-device gate (32×24 frame diff + 6 s heartbeat)  ──skip──▶ (no model call)
        │ changed
        ▼
 /api/observe ──▶ Nemotron 3.5 Super VL  (perception JSON: current step status, steps done ahead, hazards, view quality)
        │
        ├──▶ Nemotron 3 Nano  (action + spoken sentence)
        │
        └──▶ safety guard rules  (skipped critical step ⇒ ALARM; weak evidence ⇒ hold)
        ▼
 browser: advance / warn / alarm (+ beep, voice, IoT webhook) / reframe
        │ finish
        ▼
 /api/report ──▶ Nemotron 3 Ultra audit  +  per-step evidence frames

 custom task ──▶ /api/compile ──▶ Tavily Search ──▶ Nemotron 3 Ultra ──▶ verifiable checklist + citations
```

## Run it locally

Requirements: Node.js 20+.

```bash
git clone https://github.com/Arnav020/spotter.git
cd spotter
npm install
cp .env.example .env      # add NEBIUS_API_KEY and TAVILY_API_KEY
npm run dev               # http://localhost:3000
```

- Camera access needs `localhost` or HTTPS.
- To try it without a camera, choose **Upload a video** on the checklist screen.
- `SPOTTER_MOCK=1 npm run dev` runs the UI with simulated model responses (development only; it's disabled in production builds and a banner shows when it's on).

### Deploy

```bash
vercel --prod
vercel env add NEBIUS_API_KEY production
vercel env add TAVILY_API_KEY production
```

## Cost and abuse protection

The public demo has per-IP and global daily caps on every model route ([`lib/ratelimit.ts`](lib/ratelimit.ts)), small `max_tokens` budgets, 640 px JPEG frames, and the on-device gate. Keys never reach the browser.

## Limitations (honest list)

- **Latency:** a frame takes about 1–4 s to perceive and decide, so Spotter suits procedures measured in seconds to minutes. It is not for sub-second hazards.
- **Camera angle matters:** if hands or the work area are out of frame, Spotter asks you to reframe instead of guessing.
- **Not a safety device:** Spotter is advisory and is not a certified interlock. The IoT webhook is a convenience, not a safety-rated cut-off.
- **Single view:** occluded actions (behind the body, inside a container) can be missed. Manual "mark done" exists for this and is flagged in the audit as *not camera-verified*.
- **Rate limits are in-memory per serverless instance:** good enough for a demo, not for production billing.
- **Privacy:** frames are sent to Token Factory for inference and are not stored by Spotter's server. Evidence frames live only in your browser session.

## Project structure

```
app/
  page.tsx                 stage machine: setup → review → live → report
  api/compile/route.ts     Tavily + Nemotron 3 Ultra → verifiable checklist
  api/observe/route.ts     Nemotron VL perception → Nano controller → safety guard
  api/report/route.ts      Nemotron 3 Ultra audit
components/                Setup, Review, LiveSession (camera loop, edge gate, voice, alarms), Report
lib/                       Token Factory client, Tavily client, presets, rate limits, types
```

## License

[MIT](LICENSE) © 2026 Arnav Joshi
