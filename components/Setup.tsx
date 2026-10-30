"use client";

import { useState } from "react";
import { PRESETS } from "@/lib/presets";
import type { Procedure, TraceEntry } from "@/lib/types";
import { Arrow, Chip, Droplet, Hands, Search, Shield } from "./Icons";

const EXAMPLES = ["Change a flat bicycle tube", "Jump-start a car battery", "Fit a child car seat", "Replace a wall socket"];
const FACTS = [
  {
    n: "443,832",
    text: "children under 5 die from diarrhoeal disease every year. ORS saves lives, but mixing it with too little water can cause salt toxicity.",
    src: "WHO fact sheet",
    url: "https://www.who.int/news-room/fact-sheets/detail/diarrhoeal-disease",
  },
  {
    n: "~40%",
    text: "estimated global hand-hygiene adherence among healthcare workers, and lower still in intensive care.",
    src: "BMC Public Health, 2024",
    url: "https://link.springer.com/article/10.1186/s12889-024-19461-2",
  },
  {
    n: "50,000",
    text: "injuries, and about 120 deaths, are prevented each year when workers follow lockout procedures before touching equipment.",
    src: "US OSHA",
    url: "https://www.osha.gov/control-hazardous-energy",
  },
];

const PRESET_ICON: Record<string, React.ReactNode> = {
  ors: <Droplet size={22} />,
  handwash: <Hands size={22} />,
  loto: <Shield size={22} />,
  ram: <Chip size={22} />,
};

export default function Setup({ onReady }: { onReady: (p: Procedure, trace: TraceEntry[]) => void }) {
  const [task, setTask] = useState("");
  const [phase, setPhase] = useState<"idle" | "search" | "compile">("idle");
  const [error, setError] = useState<string | null>(null);

  async function compile(e?: React.FormEvent) {
    e?.preventDefault();
    if (task.trim().length < 4 || phase !== "idle") return;
    setError(null);
    setPhase("search");
    // Search usually returns in ~2 s; flip the label so the planner's work is visible.
    const t = setTimeout(() => setPhase("compile"), 2500);
    try {
      const res = await fetch("/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not build a checklist");
      onReady(data.procedure, data.trace ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      clearTimeout(t);
      setPhase("idle");
    }
  }

  return (
    <main>
      <section className="hero-grid">
        <div className="hero">
          <div className="eyebrow"><span className="led live" /> Physical AI · NVIDIA Nemotron on Nebius</div>
          <h1>
            A second pair of eyes for <em>every hands-on task.</em>
          </h1>
          <p>
            Most accidents and botched jobs come down to one skipped step. Point any camera at the work: Spotter turns the
            right procedure into a checklist a camera can verify, watches every step happen, and stops you the moment a
            safety-critical one is missed.
          </p>
          <div className="hero-cta">
            <button className="btn primary big" onClick={() => onReady(PRESETS[0], [])}>
              Try the ORS demo <Arrow />
            </button>
            <a className="btn big" href="#build">Build your own checklist</a>
          </div>
        </div>
        <HeroVisual />
      </section>

      <div className="section-title" id="build">Build a checklist for any task</div>
      <form className="card composer" onSubmit={compile}>
        <div className="well">
          <Search />
          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="What are you about to do? For example, change a car tyre"
            aria-label="Task to supervise"
            maxLength={200}
            disabled={phase !== "idle"}
          />
        </div>
        <button className="btn primary big" disabled={task.trim().length < 4 || phase !== "idle"}>
          {phase === "idle" ? <>Build checklist <Arrow /></> : "Working…"}
        </button>
      </form>
      {phase === "idle" && (
        <div className="examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="btn small" onClick={() => setTask(ex)} type="button">{ex}</button>
          ))}
        </div>
      )}

      {phase !== "idle" && (
        <div className="card progress" aria-live="polite">
          <div className={`progress-row ${phase === "search" ? "active" : "done"}`}>
            {phase === "search" ? <span className="spinner" /> : <span>✓</span>}
            Tavily is finding authoritative procedures and safety guidance
          </div>
          <div className={`progress-row ${phase === "compile" ? "active" : ""}`}>
            {phase === "compile" ? <span className="spinner" /> : <span>○</span>}
            Nemotron 3 Ultra is writing what the camera must see at each step
          </div>
        </div>
      )}
      {error && <div className="err">{error}</div>}

      <div className="section-title">Or start with a ready-made procedure</div>
      <div className="presets">
        {PRESETS.map((p) => (
          <button key={p.id} className="preset" onClick={() => onReady(p, [])}>
            <span className="icon">{PRESET_ICON[p.id]}</span>
            <h3>{p.task}</h3>
            <p>{p.summary}</p>
            <span className="meta">
              <span className="tag">{p.steps.length} steps</span>
              <span className="tag crit">{p.steps.filter((s) => s.safetyCritical).length} safety-critical</span>
            </span>
          </button>
        ))}
      </div>

      <div className="section-title">Why a skipped step matters</div>
      <div className="facts">
        {FACTS.map((f) => (
          <div key={f.n} className="card fact">
            <b className="num-tab">{f.n}</b>
            <span>{f.text}</span>
            <a href={f.url} target="_blank" rel="noreferrer">{f.src}</a>
          </div>
        ))}
      </div>

      <div className="section-title">How it works</div>
      <div className="bento">
        <div className="card">
          <span className="step-n">01 · PLAN</span>
          <b>Grounded checklist</b>
          <span>Search finds real guidance; the planner writes what must be visible for each step and which steps are safety-critical.</span>
          <span className="model-tag">Tavily → Nemotron 3 Ultra</span>
        </div>
        <div className="card">
          <span className="step-n">02 · SEE</span>
          <b>Edge-gated vision</b>
          <span>An on-device change detector only sends frames when the scene moves. The vision model judges each one against the step.</span>
          <span className="model-tag">Nemotron 3.5 Super VL</span>
        </div>
        <div className="card">
          <span className="step-n">03 · ACT</span>
          <b>Reflexes with guardrails</b>
          <span>A fast controller advances steps and speaks guidance. Hard rules force a stop alarm, and an optional IoT webhook, on any skipped safety step.</span>
          <span className="model-tag">Nemotron 3 Nano + rules</span>
        </div>
        <div className="card">
          <span className="step-n">04 · AUDIT</span>
          <b>Proof, not ticked boxes</b>
          <span>Every step gets a timestamped photo. The auditor writes a fair, specific report for trainers and QA.</span>
          <span className="model-tag">Nemotron 3 Ultra</span>
        </div>
      </div>
    </main>
  );
}

function HeroVisual() {
  return (
    <div className="device" aria-hidden>
      <div className="device-screen">
        <div className="scan" />
        <svg className="hands" viewBox="0 0 400 275" width="100%" height="100%">
          <defs>
            <linearGradient id="jug" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#9fc6ff" stopOpacity=".35" />
              <stop offset="1" stopColor="#5a8de0" stopOpacity=".55" />
            </linearGradient>
          </defs>
          <rect x="150" y="110" width="100" height="120" rx="14" fill="url(#jug)" stroke="#cfe0ff" strokeOpacity=".6" />
          <rect x="150" y="150" width="100" height="80" rx="10" fill="#7fb0ff" fillOpacity=".35" />
          <path d="M250 135c22 0 26 34 0 40" fill="none" stroke="#cfe0ff" strokeOpacity=".6" strokeWidth="6" />
          <path d="M120 70l50 30-8 14-50-28z" fill="#f2c9a4" />
          <rect x="168" y="78" width="44" height="30" rx="4" fill="#fff" transform="rotate(28 190 93)" />
          <path d="M200 120c0 14-2 22-4 30" stroke="#f5f0e6" strokeWidth="3" strokeDasharray="2 5" />
        </svg>
        <div className="bbox" style={{ left: "36%", top: "38%", width: "29%", height: "47%" }}>
          <span>1 L reached · 0.91</span>
        </div>
        <div className="hud">
          <span className="glass"><span className="led live" style={{ display: "inline-block", marginRight: 6 }} />Nemotron VL · 1.4 s</span>
          <span className="glass">Step 4 of 6</span>
        </div>
      </div>
      <div className="device-list">
        <div className="device-row ok"><span className="tick">✓</span>Pour exactly 1 litre of water<span className="tag">verified</span></div>
        <div className="device-row now"><span className="tick">4</span>Empty the whole ORS packet<span className="tag">watching</span></div>
        <div className="device-row"><span className="tick">5</span>Stir until fully dissolved<span className="tag">next</span></div>
      </div>
    </div>
  );
}
