"use client";

import { useState } from "react";
import type { Procedure } from "@/lib/types";
import { Arrow, Back, Camera, EyeCheck, Link } from "./Icons";
import PhoneHandoff from "./PhoneHandoff";

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
  const critical = procedure.steps.filter((s) => s.safetyCritical).length;

  return (
    <main>
      <button className="btn small" onClick={onBack} style={{ marginTop: 10 }}>
        <Back size={16} /> Back
      </button>
      <div className="page-head">
        <div className="eyebrow">{procedure.compiledBy}</div>
        <h1>{procedure.task}</h1>
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
                  <div className="check"><EyeCheck size={16} /><span><b>Camera checks:</b> {s.visualCheck}</span></div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <aside className="card side">
          <div>
            <h3>Start supervising</h3>
            <p style={{ margin: "6px 0 0", color: "var(--ink-2)", fontSize: 14 }}>
              {procedure.steps.length} steps · {critical} safety-critical. Spotter speaks up if one is skipped.
            </p>
          </div>
          <div className="tip"><Camera size={18} /> <span>{procedure.setupTip}</span></div>

          <div className="field">
            Camera source
            <div className="seg" role="group" aria-label="Camera source">
              <button className={source === "camera" ? "on" : ""} aria-pressed={source === "camera"} onClick={() => setSource("camera")}>Live camera</button>
              <button className={source === "file" ? "on" : ""} aria-pressed={source === "file"} onClick={() => setSource("file")}>Upload a video</button>
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
            <div className="seg" role="group" aria-label="Spoken guidance">
              <button className={voice && lang === "en" ? "on" : ""} aria-pressed={voice && lang === "en"} onClick={() => { setLang("en"); setVoice(true); }}>English</button>
              <button className={voice && lang === "hi" ? "on" : ""} aria-pressed={voice && lang === "hi"} onClick={() => { setLang("hi"); setVoice(true); }}>हिन्दी</button>
              <button className={!voice ? "on" : ""} aria-pressed={!voice} onClick={() => setVoice(false)}>Off</button>
            </div>
          </div>

          <PhoneHandoff presetId={procedure.id.startsWith("custom-") ? undefined : procedure.id} />

          <details>
            <summary>IoT action on alarm</summary>
            <label className="field" style={{ marginTop: 12 }}>
              Webhook URL
              <input type="url" placeholder="https://… (Home Assistant, IFTTT, smart plug)" value={webhook} onChange={(e) => setWebhook(e.target.value.trim())} />
            </label>
            <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: "8px 0 0" }}>
              Spotter sends a POST with the task, step and reason on every safety alarm, so you can cut power to a tool or flash a light.
            </p>
            {!webhookOk && <div className="err">Use an https:// URL.</div>}
          </details>

          <button className="btn primary big" disabled={!ready} onClick={() => onStart({ source, file, lang, voice, webhook })}>
            Start watching <Arrow />
          </button>

          {procedure.sources.length > 0 && (
            <div className="field">
              Grounded in
              <ul className="sources">
                {procedure.sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noreferrer"><Link size={15} /> {s.title}</a>
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
