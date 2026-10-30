export type Step = {
  id: string;
  title: string;
  instruction: string;
  /** What the camera must see for this step to count as done. */
  visualCheck: string;
  /** Skipping this step can hurt someone or ruin the result. */
  safetyCritical: boolean;
  /** Common mistakes to watch for during this step. */
  watchFor: string[];
};

export type Source = { title: string; url: string };

export type Procedure = {
  id: string;
  task: string;
  summary: string;
  setupTip: string;
  steps: Step[];
  sources: Source[];
  compiledBy: string;
};

export type StepStatus = "pending" | "active" | "done" | "skipped" | "flagged";

/** One row in the model trace panel. Shows judges exactly which model did what. */
export type TraceEntry = {
  at: number;
  role: "planner" | "perception" | "controller" | "auditor" | "search";
  model: string;
  ms: number;
  tokens?: number;
  note: string;
};

export type Perception = {
  scene: string;
  currentStep: { status: "not_started" | "in_progress" | "done" | "not_visible"; confidence: number; evidence: string };
  /** Later steps that look already done, which means something was done out of order. */
  aheadDone: { stepId: string; confidence: number }[];
  hazards: string[];
  viewQuality: "good" | "poor";
};

export type Decision = {
  action: "stay" | "advance" | "warn" | "alarm" | "reframe";
  say: string;
  reason: string;
};

export type ObserveResult = {
  perception: Perception;
  decision: Decision;
  trace: TraceEntry[];
};

export type SessionEvent = {
  at: number;
  stepId: string | null;
  kind: "started" | "done" | "skipped" | "warning" | "alarm" | "ack" | "manual" | "finished";
  detail: string;
  frame?: string;
};

export type Audit = {
  verdict: "pass" | "pass_with_issues" | "fail";
  score: number;
  headline: string;
  findings: { severity: "info" | "warning" | "critical"; stepId: string | null; text: string }[];
  coaching: string[];
};
