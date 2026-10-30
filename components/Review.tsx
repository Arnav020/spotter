"use client";

import { useState } from "react";
import type { Procedure } from "@/lib/types";

export type SessionConfig = {
  source: "camera" | "file";
  file?: File;
  lang: "en" | "hi";
  voice: boolean;
  webhook: string;
};

export default function Review({
  procedure,
  onBack,
  onStart,
}: {
  procedure: Procedure;
  onBack: () => void;
  onStart: (c: SessionConfig) => void;
}) {
  const [source, setSource] = useState<"camera" | "file">("camera");
  const [file, setFile] = useState<File | undefined>();
  const [lang, setLang] = useState<"en" | "hi">("en");
  const [voice, setVoice] = useState(true);
  const [webhook, setWebhook] = useState("");

  const webhookOk = webhook === "" || /^https:\/\/\S+$/.test(webhook);
  const ready = (source === "camera" || file) && webhookOk;

  return (
    <main>
      <button className="btn small" onClick={onBack} style={{ marginTop: 8 }}>
        ← Back
      </button>
      <div className="hero" style={{ paddingTop: 18, paddingBottom: 16 }}>
        <div className="eyebrow">{procedure.compiledBy}</div>
        <h1 style={{ fontSize: "clamp(26px, 4vw, 36px)" }}>{procedure.task}</h1>
        {procedure.summary && <p>{procedure.summary}</p>}
      </div>

      <div className="review">
        <div className="card">
          <ol className="steps">
            {procedure.steps.map((s, i) => (
              <li key={s.id}>
                <span className="num">{i + 1}</span>
                <div>
                  <h4>
                    {s.title}
                    {s.safetyCritical && <span className="crit">Safety-critical</span>}
                  </h4>
                  <p>{s.instruction}</p>
                  <div className="check">{s.visualCheck}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <aside className="card side">
          <h3>Start supervising</h3>
          <div className="tip">📷 {procedure.setupTip}</div>

          <div className="field">
            Camera source
            <div className="seg" role="group">
              <button className={source === "camera" ? "on" : ""} onClick={() => setSource("camera")}>
                Live camera
              </button>
              <button className={source === "file" ? "on" : ""} onClick={() => setSource("file")}>
                Upload a video
              </button>
            </div>
          </div>
          {source === "file" && (
            <label className="field">
              Video file
              <input type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0])} />
            </label>
          )}

          <div className="field">
            Spoken guidance
            <div className="seg" role="group">
              <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>English</button>
              <button className={lang === "hi" ? "on" : ""} onClick={() => setLang("hi")}>हिन्दी</button>
              <button className={!voice ? "on" : ""} onClick={() => setVoice((v) => !v)}>
                {voice ? "Mute" : "Muted"}
              </button>
            </div>
          </div>

          <details>
            <summary>IoT action on alarm (optional)</summary>
            <label className="field" style={{ marginTop: 8 }}>
              Webhook URL, called on every safety alarm (e.g. a smart-plug cut-off via Home Assistant or IFTTT)
              <input type="url" placeholder="https://…" value={webhook} onChange={(e) => setWebhook(e.target.value.trim())} />
            </label>
            {!webhookOk && <div className="err">Use an https:// URL.</div>}
          </details>

          <button className="btn primary big" disabled={!ready} onClick={() => onStart({ source, file, lang, voice, webhook })}>
            Start watching
          </button>

          {procedure.sources.length > 0 && (
            <div>
              <div className="field" style={{ marginBottom: 6 }}>Grounded in</div>
              <ul className="sources">
                {procedure.sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
