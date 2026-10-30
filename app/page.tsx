"use client";

import { useEffect, useState } from "react";
import Setup from "@/components/Setup";
import Review, { type SessionConfig } from "@/components/Review";
import LiveSession, { type SessionResult } from "@/components/LiveSession";
import Report from "@/components/Report";
import type { Procedure, TraceEntry } from "@/lib/types";

type Health = { tokenFactory: boolean; tavily: boolean; mock: boolean; models: Record<string, string> };

type Stage =
  | { name: "setup" }
  | { name: "review"; procedure: Procedure; trace: TraceEntry[] }
  | { name: "live"; procedure: Procedure; config: SessionConfig; trace: TraceEntry[] }
  | { name: "report"; procedure: Procedure; result: SessionResult };

export default function Home() {
  const [stage, setStage] = useState<Stage>({ name: "setup" });
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [stage.name]);

  return (
    <div className="wrap">
      <header className="top">
        <button className="brand" onClick={() => setStage({ name: "setup" })} aria-label="Spotter home">
          <span className="brand-mark" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 32 32"><path d="M3 16s5-8 13-8 13 8 13 8-5 8-13 8S3 16 3 16Z" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round"/><path d="m11.5 16 3 3 5.5-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
          Spotter
        </button>
        <div className="status-pills">
          <span className={`pill ${health?.tokenFactory ? "on" : "off"}`}>Nebius Token Factory</span>
          <span className={`pill hide-sm ${health?.tavily ? "on" : "off"}`}>Tavily</span>
        </div>
      </header>

      {health?.mock && <div className="banner">Mock mode (local development): model responses are simulated, not from Token Factory.</div>}
      {health && !health.tokenFactory && (
        <div className="banner">The server has no Token Factory key configured, so live checks are unavailable.</div>
      )}

      {stage.name === "setup" && <Setup onReady={(procedure, trace) => setStage({ name: "review", procedure, trace })} />}
      {stage.name === "review" && (
        <Review
          procedure={stage.procedure}
          onBack={() => setStage({ name: "setup" })}
          onStart={(config) => setStage({ name: "live", procedure: stage.procedure, config, trace: stage.trace })}
        />
      )}
      {stage.name === "live" && (
        <LiveSession
          procedure={stage.procedure}
          config={stage.config}
          initialTrace={stage.trace}
          onFinish={(result) => setStage({ name: "report", procedure: stage.procedure, result })}
          onAbort={() => setStage({ name: "review", procedure: stage.procedure, trace: stage.trace })}
        />
      )}
      {stage.name === "report" && (
        <Report procedure={stage.procedure} result={stage.result} onRestart={() => setStage({ name: "setup" })} />
      )}

      <footer className="footer">
        <span>Spotter is advisory. It is not a certified safety interlock.</span>
        <span>
          Built on NVIDIA Nemotron via Nebius Token Factory ·{" "}
          <a href="https://github.com/Arnav020/spotter" target="_blank" rel="noreferrer">Source</a>
        </span>
      </footer>
    </div>
  );
}
