"use client";

import { useState } from "react";
import { PRESETS } from "@/lib/presets";
import type { Procedure, TraceEntry } from "@/lib/types";

const EXAMPLES = ["Change a flat bicycle tyre tube", "Jump-start a car battery", "Replace a ceiling fan regulator", "Fit a baby car seat"];

export default function Setup({ onReady }: { onReady: (p: Procedure, trace: TraceEntry[]) => void }) {
  const [task, setTask] = useState("");
  const [phase, setPhase] = useState<"idle" | "search" | "compile">("idle");
  const [error, setError] = useState<string | null>(null);

  async function compile(e?: React.FormEvent) {
    e?.preventDefault();
    if (task.trim().length < 4 || phase !== "idle") return;
    setError(null);
    setPhase("search");
    // The search step is usually ~2 s. Flip the label so people see the planner working.
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
      <section className="hero">
        <div className="eyebrow">Physical AI · NVIDIA Nemotron on Nebius</div>
        <h1>A second pair of eyes for every hands-on task.</h1>
        <p>
          Most real-world accidents and botched jobs come from one skipped step. Point any camera at the work: Spotter turns
          the right procedure into a camera-verifiable checklist, watches each step happen, speaks up the moment something is
          missed, and hands you an evidence-backed audit.
        </p>
      </section>

      <form className="card task-form" onSubmit={compile}>
        <input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="What are you about to do? e.g. change a car tyre"
          aria-label="Task to supervise"
          maxLength={200}
          disabled={phase !== "idle"}
        />
        <button className="btn primary" disabled={task.trim().length < 4 || phase !== "idle"}>
          {phase === "idle" ? "Build checklist" : "Working…"}
        </button>
      </form>
      {phase === "idle" && !error && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          {EXAMPLES.map((ex) => (
            <button key={ex} className="btn small" onClick={() => setTask(ex)} type="button">
              {ex}
            </button>
          ))}
        </div>
      )}

      {phase !== "idle" && (
        <div className="card progress" style={{ marginTop: 12 }} aria-live="polite">
          <div className={`progress-row ${phase === "search" ? "active" : "done"}`}>
            {phase === "search" ? <span className="spinner" /> : <span>✓</span>}
            Tavily is finding authoritative procedures and safety guidance
          </div>
          <div className={`progress-row ${phase === "compile" ? "active" : ""}`}>
            {phase === "compile" ? <span className="spinner" /> : <span>○</span>}
            Nemotron 3 Ultra is compiling a camera-verifiable checklist
          </div>
        </div>
      )}
      {error && <div className="err">{error}</div>}

      <div className="section-title">Or try a ready-made procedure</div>
      <div className="presets">
        {PRESETS.map((p) => (
          <button key={p.id} className="card preset" onClick={() => onReady(p, [])}>
            <h3>{p.task}</h3>
            <p>{p.summary}</p>
            <span className="meta">
              {p.steps.length} steps · {p.steps.filter((s) => s.safetyCritical).length} safety-critical
            </span>
          </button>
        ))}
      </div>

      <div className="section-title">How it works</div>
      <div className="how">
        <div className="card">
          <b>1. Plan</b>
          <span>Search grounds the procedure in real sources; the planner writes what the camera must see for each step.</span>
          <div className="model-tag">Tavily → Nemotron 3 Ultra</div>
        </div>
        <div className="card">
          <b>2. See</b>
          <span>An on-device change detector sends frames only when the scene moves. The vision model judges each one.</span>
          <div className="model-tag">Nemotron 3.5 Super VL</div>
        </div>
        <div className="card">
          <b>3. Act</b>
          <span>A fast controller advances steps, speaks guidance, and raises a stop alarm (plus an optional IoT webhook) on a skipped safety step.</span>
          <div className="model-tag">Nemotron 3 Nano + safety rules</div>
        </div>
        <div className="card">
          <b>4. Audit</b>
          <span>Every step gets timestamped photo evidence. The auditor writes a fair, specific report for trainers and QA.</span>
          <div className="model-tag">Nemotron 3 Ultra</div>
        </div>
      </div>
    </main>
  );
}
