// Local-development stand-in for Token Factory (SPOTTER_MOCK=1), used to exercise the UI
// without spending credits. The deployed demo never sets this, and the UI shows a banner when it's on.
import type { ChatMessage, ChatResult } from "./nebius";

let frame = 0;

export function mockChat(model: string, messages: ChatMessage[]): ChatResult {
  const system = String(messages[0]?.content ?? "");
  const user = messages[1]?.content;
  const userText = typeof user === "string" ? user : user?.map((p) => ("text" in p ? p.text : "")).join("\n") ?? "";
  let text = "{}";

  if (system.includes("procedure compiler")) {
    const task = userText.match(/Task: (.*)/)?.[1] ?? "task";
    text = JSON.stringify({
      refuse: null,
      task,
      summary: "Mock checklist for UI testing.",
      setupTip: "Point the camera at your hands.",
      steps: ["Prepare the area", "Do the main action", "Check the result", "Clean up"].map((t, i) => ({
        title: t,
        instruction: `${t}.`,
        visualCheck: `The camera shows: ${t.toLowerCase()}.`,
        safetyCritical: i === 1,
        watchFor: ["Rushing"],
      })),
      usedSources: [0, 1],
    });
  } else if (system.includes("eyes of Spotter")) {
    frame++;
    const done = frame % 3 === 0;
    text = JSON.stringify({
      scene: done ? "Hands finishing the step." : "Hands working on the task.",
      currentStep: { status: done ? "done" : "in_progress", confidence: done ? 0.9 : 0.5, evidence: "mock" },
      aheadDone: frame % 11 === 0 ? [{ stepId: userText.match(/\n(s\d+):/)?.[1] ?? "s2", confidence: 0.8 }] : [],
      hazards: [],
      viewQuality: frame % 13 === 0 ? "poor" : "good",
    });
  } else if (system.includes("real-time coach")) {
    const done = userText.includes('"status":"done"');
    text = JSON.stringify({ action: done ? "advance" : "stay", say: done ? "Nice, that step is done." : "", reason: "mock" });
  } else if (system.includes("auditor")) {
    text = JSON.stringify({
      verdict: "pass_with_issues",
      score: 78,
      headline: "Mock audit: most steps verified on camera.",
      findings: [{ severity: "warning", stepId: "s2", text: "Mock finding." }],
      coaching: ["Keep your hands in frame."],
    });
  }
  return { text, ms: 300, tokens: 0, model: `${model} (mock)` };
}
