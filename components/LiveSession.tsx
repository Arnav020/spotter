"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionConfig } from "./Review";
import type { ObserveResult, Procedure, SessionEvent, StepStatus, TraceEntry } from "@/lib/types";

export type SessionResult = {
  statuses: StepStatus[];
  events: SessionEvent[];
  trace: TraceEntry[];
  evidence: Record<string, string>;
  startedAt: number;
  endedAt: number;
  stats: { sent: number; gated: number; avgMs: number };
};

const TICK_MS = 500;
const DIFF_THRESHOLD = 6; // mean grey-level change (0–255) that counts as "the scene moved"
const HEARTBEAT_MS = 6000; // still send a frame this often, even when nothing moves

export default function LiveSession({
  procedure,
  config,
  initialTrace,
  onFinish,
  onAbort,
}: {
  procedure: Procedure;
  config: SessionConfig;
  initialTrace: TraceEntry[];
  onFinish: (r: SessionResult) => void;
  onAbort: () => void;
}) {
  const steps = procedure.steps;
  const videoRef = useRef<HTMLVideoElement>(null);
  const thumbCanvas = useRef<HTMLCanvasElement | null>(null);
  const prevThumb = useRef<Uint8ClampedArray | null>(null);
  const inFlight = useRef(false);
  const lastSentAt = useRef(0);
  const idxRef = useRef(0);
  const pausedRef = useRef(false);
  const finishedRef = useRef(false);
  const recentSaid = useRef<string[]>([]);
  const lastSpoken = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const startedAt = useRef(Date.now());
  const eventsRef = useRef<SessionEvent[]>([]);
  const evidenceRef = useRef<Record<string, string>>({});
  const statusesRef = useRef<StepStatus[]>(steps.map((_, i) => (i === 0 ? "active" : "pending")));
  const statsRef = useRef({ sent: 0, gated: 0, totalMs: 0 });
  const traceRef = useRef<TraceEntry[]>(initialTrace);
  const quietStreak = useRef(0);
  const backoffUntil = useRef(0);
  const localized = useRef<Record<string, { title: string; instruction: string }>>({});
  const loc = (i: number) => localized.current[steps[i].id] ?? steps[i];

  const [idx, setIdx] = useState(0);
  const [statuses, setStatuses] = useState<StepStatus[]>(statusesRef.current);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [trace, setTrace] = useState<TraceEntry[]>(initialTrace);
  const [caption, setCaption] = useState<{ label: string; text: string } | null>(null);
  const [alarm, setAlarm] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [videoEnded, setVideoEnded] = useState(false);
  const [stats, setStats] = useState({ sent: 0, gated: 0, avgMs: 0 });
  const [thinking, setThinking] = useState(false);

  // ---------- output: voice, beep, webhook ----------
  const speak = useCallback(
    (text: string, urgent = false) => {
      if (!text) return;
      const now = Date.now();
      if (text === lastSpoken.current.text && now - lastSpoken.current.at < 10_000) return;
      lastSpoken.current = { text, at: now };
      recentSaid.current = [...recentSaid.current, text].slice(-5);
      if (!config.voice || typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      const wanted = config.lang === "hi" ? "hi" : "en";
      const v = window.speechSynthesis.getVoices().find((x) => x.lang.toLowerCase().startsWith(wanted));
      if (v) u.voice = v;
      u.lang = config.lang === "hi" ? "hi-IN" : "en-US";
      u.rate = urgent ? 1.05 : 1;
      if (urgent) window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    },
    [config.voice, config.lang],
  );

  const beep = useCallback(() => {
    try {
      const ctx = new AudioContext();
      [0, 0.25, 0.5].forEach((t) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.25, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t);
        o.stop(ctx.currentTime + t + 0.2);
      });
      setTimeout(() => ctx.close(), 1200);
    } catch {}
  }, []);

  const fireWebhook = useCallback(
    (payload: object) => {
      if (!config.webhook) return;
      // no-cors: fire-and-forget to home-automation hooks that don't send CORS headers.
      fetch(config.webhook, { method: "POST", mode: "no-cors", body: JSON.stringify(payload) }).catch(() => {});
    },
    [config.webhook],
  );

  // ---------- state helpers ----------
  const log = useCallback((e: Omit<SessionEvent, "at">) => {
    const ev = { ...e, at: Date.now() };
    eventsRef.current = [...eventsRef.current, ev];
    setEvents(eventsRef.current);
  }, []);

  const addTrace = useCallback((t: TraceEntry[]) => {
    traceRef.current = [...traceRef.current, ...t].slice(-200);
    setTrace(traceRef.current);
  }, []);

  const setStatus = useCallback((i: number, s: StepStatus) => {
    statusesRef.current = statusesRef.current.map((x, j) => (j === i ? s : x));
    setStatuses(statusesRef.current);
  }, []);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    log({ stepId: null, kind: "finished", detail: "Session ended" });
    const s = statsRef.current;
    onFinish({
      statuses: statusesRef.current,
      events: eventsRef.current,
      trace: traceRef.current,
      evidence: evidenceRef.current,
      startedAt: startedAt.current,
      endedAt: Date.now(),
      stats: { sent: s.sent, gated: s.gated, avgMs: s.sent ? Math.round(s.totalMs / s.sent) : 0 },
    });
  }, [log, onFinish]);

  const goTo = useCallback(
    (next: number) => {
      if (next >= steps.length) {
        speak(config.lang === "hi" ? "सारे स्टेप पूरे हो गए। बहुत बढ़िया।" : "All steps complete. Well done.");
        setTimeout(finish, 1200);
        return;
      }
      idxRef.current = next;
      setIdx(next);
      setStatus(next, "active");
      setAlarm(null);
      const s = loc(next);
      setCaption({ label: `Step ${next + 1} of ${steps.length}`, text: s.instruction });
      speak(config.lang === "hi" ? `स्टेप ${next + 1}. ${s.title}.` : `Step ${next + 1}. ${s.title}.`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [steps, speak, setStatus, finish, config.lang],
  );

  // ---------- frame capture ----------
  const capture = useCallback((maxW: number, quality: number) => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const scale = Math.min(1, maxW / v.videoWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
  }, []);

  /** Edge gate: cheap on-device change detection decides whether a frame is worth a model call. */
  const sceneChanged = useCallback(() => {
    const v = videoRef.current!;
    if (!thumbCanvas.current) {
      thumbCanvas.current = document.createElement("canvas");
      thumbCanvas.current.width = 32;
      thumbCanvas.current.height = 24;
    }
    const ctx = thumbCanvas.current.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(v, 0, 0, 32, 24);
    const px = ctx.getImageData(0, 0, 32, 24).data;
    const grey = new Uint8ClampedArray(32 * 24);
    for (let i = 0; i < grey.length; i++) grey[i] = (px[i * 4] * 3 + px[i * 4 + 1] * 6 + px[i * 4 + 2]) / 10;
    const prev = prevThumb.current;
    let diff = 255;
    if (prev) {
      let sum = 0;
      for (let i = 0; i < grey.length; i++) sum += Math.abs(grey[i] - prev[i]);
      diff = sum / grey.length;
    }
    return { changed: diff > DIFF_THRESHOLD, commit: () => (prevThumb.current = grey) };
  }, []);

  const handleResult = useCallback(
    (r: ObserveResult, frame: string) => {
      const i = idxRef.current;
      const step = steps[i];
      const d = r.decision;
      switch (d.action) {
        case "advance": {
          setStatus(i, "done");
          evidenceRef.current[step.id] = frame;
          log({ stepId: step.id, kind: "done", detail: r.perception.currentStep.evidence || d.reason, frame });
          if (d.say) speak(d.say);
          goTo(i + 1);
          break;
        }
        case "alarm": {
          setStatus(i, "flagged");
          setAlarm(d.say);
          setCaption({ label: "STOP", text: d.say });
          log({ stepId: step.id, kind: "alarm", detail: d.reason, frame });
          beep();
          speak(d.say, true);
          fireWebhook({ source: "spotter", event: "safety_alarm", task: procedure.task, step: step.title, reason: d.reason, at: new Date().toISOString() });
          break;
        }
        case "warn": {
          setCaption({ label: "Heads up", text: d.say });
          log({ stepId: step.id, kind: "warning", detail: d.say || d.reason });
          speak(d.say);
          break;
        }
        case "reframe": {
          setCaption({ label: "Camera", text: d.say });
          speak(d.say);
          break;
        }
        default: {
          if (statusesRef.current[i] === "flagged" && !r.perception.hazards.length) setStatus(i, "active");
          if (d.say) {
            setCaption({ label: `Step ${i + 1} of ${steps.length}`, text: d.say });
            speak(d.say);
          }
        }
      }
    },
    [steps, setStatus, log, speak, goTo, beep, fireWebhook, procedure.task],
  );

  const tick = useCallback(async () => {
    const v = videoRef.current;
    if (!v || pausedRef.current || finishedRef.current || inFlight.current || v.readyState < 2 || v.videoWidth === 0) return;
    const now = Date.now();
    if (now < backoffUntil.current) return;
    const { changed, commit } = sceneChanged();
    if (!changed && now - lastSentAt.current < HEARTBEAT_MS) {
      statsRef.current.gated++;
      setStats((s) => ({ ...s, gated: statsRef.current.gated }));
      return;
    }
    const frame = capture(640, 0.72);
    if (!frame) return;
    commit();
    inFlight.current = true;
    lastSentAt.current = now;
    setThinking(true);
    const i = idxRef.current;
    try {
      const res = await fetch("/api/observe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: frame,
          steps,
          currentIndex: i,
          task: procedure.task,
          recent: recentSaid.current,
          lang: config.lang,
          quietStreak: quietStreak.current,
        }),
      });
      const data = await res.json();
      if (data.trace) addTrace(data.trace);
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setApiError(null);
      quietStreak.current = data.decision?.reason === "No change" ? quietStreak.current + 1 : 0;
      statsRef.current.sent++;
      statsRef.current.totalMs += Date.now() - now;
      const s = statsRef.current;
      setStats({ sent: s.sent, gated: s.gated, avgMs: Math.round(s.totalMs / s.sent) });
      // Ignore answers about a step the user already moved past by hand.
      if (idxRef.current === i && !finishedRef.current) handleResult(data as ObserveResult, capture(360, 0.7) ?? frame);
    } catch (e) {
      setApiError(e instanceof Error ? e.message : "Model call failed");
      backoffUntil.current = Date.now() + 4000;
    } finally {
      inFlight.current = false;
      setThinking(false);
    }
  }, [sceneChanged, capture, steps, procedure.task, config.lang, addTrace, handleResult]);

  // ---------- camera / file setup ----------
  useEffect(() => {
    let stream: MediaStream | null = null;
    let url: string | null = null;
    let cancelled = false;
    const v = videoRef.current!;
    (async () => {
      try {
        if (config.source === "camera") {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          v.srcObject = stream;
        } else if (config.file) {
          url = URL.createObjectURL(config.file);
          v.src = url;
          v.onended = () => setVideoEnded(true);
        }
        if (config.lang === "hi") {
          // Translate once up front; fall back to English if it takes too long.
          const tr = fetch("/api/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lang: "hi", items: steps.map(({ id, title, instruction }) => ({ id, title, instruction })) }),
          })
            .then((r) => r.json())
            .then((d) => {
              for (const it of d.items ?? []) localized.current[it.id] = { title: it.title, instruction: it.instruction };
              if (d.trace) addTrace(d.trace);
            })
            .catch(() => {});
          await Promise.race([tr, new Promise((r) => setTimeout(r, 8000))]);
        }
        await v.play();
        if (cancelled) return;
        log({ stepId: steps[0].id, kind: "started", detail: `Watching via ${config.source === "camera" ? "live camera" : "uploaded video"}` });
        const first = loc(0);
        setCaption({ label: `Step 1 of ${steps.length}`, text: first.instruction });
        speak(config.lang === "hi" ? `चलिए शुरू करते हैं। स्टेप 1. ${first.title}.` : `Let's start. Step 1. ${first.title}.`);
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === "AbortError")) return;
        setCamError(
          config.source === "camera"
            ? "Camera access was blocked or no camera was found. Allow camera access, or go back and upload a video instead."
            : "This video could not be played. Try an MP4 or WebM file.",
        );
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (url) URL.revokeObjectURL(url);
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep the interval calling the latest tick without restarting the camera
  const tickRef = useRef(tick);
  tickRef.current = tick;
  useEffect(() => {
    const id = setInterval(() => tickRef.current(), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // ---------- manual controls ----------
  function togglePause() {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    const v = videoRef.current;
    if (v && config.source === "file") pausedRef.current ? v.pause() : v.play();
  }

  function markDone() {
    const i = idxRef.current;
    setStatus(i, "done");
    log({ stepId: steps[i].id, kind: "manual", detail: "Marked done by hand (not verified by camera)", frame: capture(360, 0.7) ?? undefined });
    evidenceRef.current[steps[i].id] = capture(360, 0.7) ?? "";
    goTo(i + 1);
  }

  function skip() {
    const i = idxRef.current;
    const s = steps[i];
    if (s.safetyCritical && !window.confirm(`"${s.title}" is safety-critical. Skip it anyway? This will be recorded in the audit.`)) return;
    setStatus(i, "skipped");
    log({ stepId: s.id, kind: "skipped", detail: s.safetyCritical ? "Safety-critical step skipped by user" : "Skipped by user" });
    goTo(i + 1);
  }

  const current = steps[idx];
  const gatedPct = stats.sent + stats.gated ? Math.round((stats.gated / (stats.sent + stats.gated)) * 100) : 0;

  return (
    <main className="live" style={{ marginTop: 8 }}>
      <div>
        <div className="bezel">
        <div className="stage">
          <video ref={videoRef} playsInline muted />
          {camError && <div className="placeholder">{camError}</div>}
          <div className="overlay-top">
            <span className="chip glass">
              <span className={`led ${paused ? "" : "live"}`} /> {paused ? "Paused" : "Watching"} · Step {Math.min(idx + 1, steps.length)}/{steps.length}
            </span>
            {thinking && <span className="chip glass"><span className="spinner" style={{ width: 12, height: 12 }} /> Nemotron VL is looking</span>}
          </div>
          {caption && !alarm && (
            <div className="caption glass" aria-live="polite">
              <small>{caption.label}</small>
              {caption.text}
            </div>
          )}
          {alarm && (
            <>
              <div className="alarm-frame" />
              <div className="alarm-banner" role="alert">
                <small>Safety stop</small>
                {alarm}
                <div>
                  <button onClick={() => { setAlarm(null); setStatus(idxRef.current, "active"); }}>I've fixed it</button>
                </div>
              </div>
            </>
          )}
        </div>
        </div>

        <div className="controls">
          <button className="btn" onClick={togglePause}>{paused ? "Resume" : "Pause"}</button>
          <button className="btn" onClick={markDone} title="Advance without camera verification (recorded in the audit)">Mark step done</button>
          <button className="btn" onClick={skip}>Skip step</button>
          <button className="btn primary" onClick={finish} style={{ marginLeft: "auto" }}>Finish & get report</button>
          <button className="btn danger" onClick={onAbort}>Cancel</button>
        </div>
        {videoEnded && <div className="banner" style={{ marginTop: 12 }}>The video has ended. Press "Finish & get report" to see the audit.</div>}
        {apiError && <div className="err">Model call failed: {apiError}. Spotter keeps retrying.</div>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <section className="card panel">
          <h3>Checklist</h3>
          <ul className="tracker">
            {steps.map((s, i) => (
              <li key={s.id} className={statuses[i]}>
                <span className="dot">{statuses[i] === "done" ? "✓" : statuses[i] === "skipped" || statuses[i] === "flagged" ? "!" : i + 1}</span>
                <div>
                  {s.title} {s.safetyCritical && <span className="crit">Critical</span>}
                  {i === idx && <div className="current-check">Looking for: {current.visualCheck}</div>}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card panel">
          <h3>Edge + model stats</h3>
          <div className="stats">
            <div className="stat"><b>{stats.sent}</b><span>frames sent</span></div>
            <div className="stat"><b>{gatedPct}%</b><span>skipped on-device</span></div>
            <div className="stat"><b>{stats.avgMs ? `${(stats.avgMs / 1000).toFixed(1)}s` : "–"}</b><span>avg. round trip</span></div>
          </div>
        </section>

        <section className="card panel">
          <h3>Model trace: who did what</h3>
          <ul className="trace">
            {trace.length === 0 && <li><span className="m">Waiting for the first frame…</span></li>}
            {[...trace].reverse().slice(0, 40).map((t, k) => (
              <li key={k}>
                <span className={`role ${t.role}`}>{t.role}</span>
                <span className="m" title={t.model}>{t.model.replace(/^nvidia\//, "")} · {t.note}</span>
                <span className="m">{(t.ms / 1000).toFixed(1)}s</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card panel">
          <h3>Event log</h3>
          <ul className="feed">
            {[...events].reverse().map((e, k) => (
              <li key={k}>
                <span className="t">+{Math.round((e.at - startedAt.current) / 1000)}s</span>
                <span className={e.kind === "alarm" ? "alarm" : e.kind === "warning" ? "warning" : e.kind === "done" ? "done" : ""}>
                  {label(e.kind)} {e.detail}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

function label(kind: SessionEvent["kind"]) {
  return { started: "▶", done: "✓", skipped: "⤼", warning: "⚠", alarm: "⛔", manual: "✋", finished: "■" }[kind];
}
