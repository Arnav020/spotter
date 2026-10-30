"use client";

import { useEffect, useState } from "react";
import type { SessionResult } from "./LiveSession";
import type { Audit, Procedure } from "@/lib/types";

export default function Report({ procedure, result, onRestart }: { procedure: Procedure; result: SessionResult; onRestart: () => void }) {
  const [audit, setAudit] = useState<Audit | null>(null);
  const [auditModel, setAuditModel] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const events = result.events.map(({ frame, ...e }) => e);
    fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ procedure, events, durationMs: result.endedAt - result.startedAt }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Audit failed");
        setAudit(d.audit);
        setAuditModel(d.trace?.[0]?.model ?? "");
      })
      .catch((e) => setError(e.message));
  }, [procedure, result]);

  const duration = Math.round((result.endedAt - result.startedAt) / 1000);
  const verified = procedure.steps.filter((s) => result.events.some((e) => e.kind === "done" && e.stepId === s.id)).length;
  const alarms = result.events.filter((e) => e.kind === "alarm").length;
  const gatedPct = result.stats.sent + result.stats.gated ? Math.round((result.stats.gated / (result.stats.sent + result.stats.gated)) * 100) : 0;

  function exportJson() {
    const blob = new Blob([JSON.stringify({ procedure, audit, events: result.events.map(({ frame, ...e }) => e), stats: result.stats }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `spotter-audit-${new Date(result.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
    a.click();
  }

  return (
    <main style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 18 }}>
      <section className="card report-head">
        <div style={{ flex: "1 1 360px" }}>
          <div className="eyebrow">Audit report · {new Date(result.startedAt).toLocaleString()}</div>
          <h2>{procedure.task}</h2>
          {audit ? (
            <>
              <span className={`verdict ${audit.verdict}`}>
                {audit.verdict === "pass" ? "✓ Pass" : audit.verdict === "fail" ? "✕ Fail" : "! Pass with issues"}
              </span>
              <p style={{ fontSize: 16, marginBottom: 0 }}>{audit.headline}</p>
            </>
          ) : error ? (
            <div className="err">The auditor couldn't run: {error}. The evidence below is still complete.</div>
          ) : (
            <div className="progress-row active"><span className="spinner" /> Nemotron 3 Ultra is writing the audit…</div>
          )}
        </div>
        <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <div className="gauge">
            <div className="gauge-inner">
              <div className="score">{audit ? audit.score : "–"}<small>SCORE</small></div>
            </div>
          </div>
          <div style={{ color: "var(--ink-2)", fontSize: 13, marginTop: 14 }}>
            {verified}/{procedure.steps.length} steps camera-verified · {alarms} alarm{alarms === 1 ? "" : "s"} · {duration}s
          </div>
          <div className="controls no-print" style={{ justifyContent: "flex-end" }}>
            <button className="btn small" onClick={() => window.print()}>Save as PDF</button>
            <button className="btn small" onClick={exportJson}>Export JSON</button>
            <button className="btn small primary" onClick={onRestart}>New task</button>
          </div>
        </div>
      </section>

      {audit && (
        <div className="two">
          <section className="card panel">
            <h3>Findings</h3>
            <ul className="findings">
              {audit.findings.length === 0 && <li className="info">No issues found.</li>}
              {audit.findings.map((f, i) => (
                <li key={i} className={f.severity}>
                  <b>{f.severity === "critical" ? "Critical" : f.severity === "warning" ? "Warning" : "Note"}</b>
                  {f.stepId && ` · ${procedure.steps.find((s) => s.id === f.stepId)?.title ?? f.stepId}`}: {f.text}
                </li>
              ))}
            </ul>
          </section>
          <section className="card panel">
            <h3>Coaching for next time</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {audit.coaching.map((c, i) => <li key={i} style={{ marginBottom: 6 }}>{c}</li>)}
            </ul>
            <div className="model-tag">Audit by {auditModel.replace(/^nvidia\//, "") || "Nemotron 3 Ultra"}</div>
          </section>
        </div>
      )}

      <section>
        <div className="section-title" style={{ marginTop: 6 }}>Step-by-step evidence</div>
        <div className="evidence">
          {procedure.steps.map((s, i) => {
            const done = result.events.find((e) => e.kind === "done" && e.stepId === s.id);
            const manual = result.events.find((e) => e.kind === "manual" && e.stepId === s.id);
            const skipped = result.statuses[i] === "skipped" || (!done && !manual);
            const ev = done ?? manual;
            const stepAlarms = result.events.filter((e) => e.kind === "alarm" && e.stepId === s.id);
            const img = done?.frame ?? manual?.frame ?? stepAlarms[0]?.frame;
            return (
              <article key={s.id} className="card ev">
                {img ? <img src={img} alt={`Camera frame for ${s.title}`} /> : <div className="noimg">No evidence captured</div>}
                <div className="body">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <b>{i + 1}. {s.title}</b>
                    <span className={`badge ${done ? "verified" : manual ? "manual" : "skipped"}`}>{done ? "Verified" : manual ? "Manual" : "Missing"}</span>
                  </div>
                  {s.safetyCritical && <span className="crit">Safety-critical</span>}
                  <div style={{ color: "var(--ink-2)", marginTop: 4 }}>
                    {ev ? `+${Math.round((ev.at - result.startedAt) / 1000)}s · ${ev.detail}` : skipped ? "Not completed during the session." : ""}
                  </div>
                  {stepAlarms.length > 0 && (
                    <div style={{ color: "var(--bad)", marginTop: 6, fontWeight: 600 }}>
                      {stepAlarms.length} safety alarm{stepAlarms.length > 1 ? "s" : ""} raised: {stepAlarms[0].detail}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="card panel">
        <h3>How this session ran</h3>
        <div className="stats">
          <div className="stat"><b>{result.stats.sent}</b><span>frames analysed by Nemotron VL</span></div>
          <div className="stat"><b>{gatedPct}%</b><span>frames filtered on-device</span></div>
          <div className="stat"><b>{result.stats.avgMs ? `${(result.stats.avgMs / 1000).toFixed(1)}s` : "–"}</b><span>avg. perceive + decide</span></div>
        </div>
      </section>
    </main>
  );
}
