import type {
  CaseResponse, EventsResponse, PatientCase, WorklistItem, WorklistResponse,
} from "@nova26/shared";

export const API_BASE: string =
  ((import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:8787").replace(/\/$/, "");

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function req<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); if (j?.error) msg = String(j.error); } catch { /* ignore */ }
    throw new HttpError(res.status, msg);
  }
  return (await res.json()) as T;
}

export type Health = { ok: boolean; callMode: "sim" | "twilio"; hasOpenRouterKey?: boolean; hasTwilio?: boolean; publicUrl?: string | null };

export const api = {
  health: () => req<Health>("/health"),
  getCase: () => req<CaseResponse>("/case"),
  reset: () => req<CaseResponse>("/case/reset", { method: "POST", body: {} }),
  pullChart: () => req<CaseResponse>("/case/mychart/connect", { method: "POST", body: {} }),
  ingestDenial: () => req<CaseResponse>("/case/documents", { method: "POST", body: { denialLetter: true } }),
  analyze: () => req<CaseResponse>("/case/analyze", { method: "POST", body: {} }),
  callPayer: () => req<CaseResponse>("/case/call-payer", { method: "POST", body: {} }),
  events: (id: string, after: number) => req<EventsResponse>(`/errands/${id}/events?after=${after}`),
  answer: (id: string, questionId: string, text: string) =>
    req<{ ok: true }>(`/errands/${id}/answer`, { method: "POST", body: { questionId, text } }),
  relay: (callId: string, text: string) => req<{ ok: true }>(`/calls/${callId}/relay`, { method: "POST", body: { text } }),
  simReply: (callId: string, text: string) => req<{ ok: true }>(`/calls/${callId}/sim-reply`, { method: "POST", body: { text } }),
  worklist: async (): Promise<WorklistResponse & { mock?: boolean }> => {
    try {
      return await req<WorklistResponse>("/worklist");
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return { ...(await mockWorklist()), mock: true };
      throw e;
    }
  },
};

// ---- Fallback mock (only used if the server has no GET /worklist yet) ----
const ACTIVITY: Record<string, string[]> = {
  gathering_chart: ["Pulling chart from Epic (FHIR R4)...", "Reading last 3 progress notes...", "Collecting relevant labs and imaging..."],
  analyzing: ["Matching chart to payer policy criteria...", "Checking step-therapy history...", "Scoring appeal readiness..."],
  calling_payer: ["On the line with payer: verifying NPI", "Holding for appeals department...", "Reading criteria evidence to rep"],
};

function heroFromCase(c: PatientCase | undefined): WorklistItem {
  const stage = c?.stage ?? "start";
  const status: WorklistItem["status"] =
    stage === "start" ? "queued" : stage === "chart" || stage === "docs" ? "gathering_chart"
      : stage === "analyzed" ? "appeal_drafted" : stage === "calling" ? "calling_payer" : "awaiting_payer";
  const act: Record<string, string> = {
    start: "Queued: Aetna PA denial received", chart: "Chart pulled from Epic", docs: "Denial ingested; ready to analyze",
    analyzed: "Appeal drafted: awaiting human approval to call Aetna", calling: "Live call with Aetna", done: c?.callOutcome ?? "Call complete",
  };
  return {
    id: "hero", isHero: true, trigger: "pa_denial", patientName: c?.patient.name ?? "Prithish Shan", mrn: c?.chart?.mrn ?? "RH-0042817",
    payer: "Aetna", service: "Remicade (infliximab) IV infusion", code: "J1745", amount: 18400,
    denialReason: "Not medically necessary: no documented failure of conventional therapy",
    deniedOn: c?.denialLetter?.date ?? new Date().toISOString().slice(0, 10), status,
    agentActivity: act[stage] ?? "", readinessPct: c?.analysis?.denial?.readinessPct, updatedAt: new Date().toISOString(),
  };
}

async function mockWorklist(): Promise<WorklistResponse> {
  let c: PatientCase | undefined;
  try { c = (await api.getCase()).case; } catch { /* ignore */ }
  const tick = Math.floor(Date.now() / 4000);
  const pick = (s: string, i: number) => (ACTIVITY[s] ? ACTIVITY[s][(tick + i) % ACTIVITY[s].length] : "");
  const rows: Omit<WorklistItem, "agentActivity" | "updatedAt">[] = [
    { id: "w1", trigger: "pa_denial", patientName: "Maria Gonzalez", mrn: "RH-0039112", payer: "UnitedHealthcare", service: "MRI lumbar spine w/o contrast", code: "72148", amount: 2150, denialReason: "Conservative therapy < 6 weeks", deniedOn: "2026-11-03", status: "calling_payer", readinessPct: 86 },
    { id: "w2", trigger: "eob_denial", carc: "197", patientName: "James Whitfield", mrn: "RH-0027745", payer: "Cigna", service: "Total knee arthroplasty", code: "27447", amount: 38200, denialReason: "CARC 197: precertification absent", deniedOn: "2026-11-01", status: "needs_human", readinessPct: 64 },
    { id: "w3", trigger: "pa_denial", patientName: "Aisha Rahman", mrn: "RH-0051208", payer: "Anthem BCBS", service: "Humira (adalimumab)", code: "J0135", amount: 7400, denialReason: "Step therapy not met", deniedOn: "2026-11-04", status: "analyzing" },
    { id: "w4", trigger: "eob_denial", carc: "50", patientName: "Robert Chen", mrn: "RH-0018893", payer: "Aetna", service: "Upper blepharoplasty", code: "15823", amount: 4900, denialReason: "CARC 50: not medically necessary", deniedOn: "2026-10-29", status: "awaiting_payer", readinessPct: 91 },
    { id: "w5", trigger: "pa_denial", patientName: "Linda Okafor", mrn: "RH-0044410", payer: "Humana", service: "CT abdomen/pelvis w/ contrast", code: "74177", amount: 1850, denialReason: "Insufficient clinical information", deniedOn: "2026-11-05", status: "gathering_chart" },
    { id: "w6", trigger: "eob_denial", carc: "16", patientName: "Daniel Novak", mrn: "RH-0032067", payer: "UnitedHealthcare", service: "Sleep study (PSG)", code: "95810", amount: 3200, denialReason: "CARC 16: missing information", deniedOn: "2026-10-27", status: "overturned", readinessPct: 100 },
    { id: "w7", trigger: "pa_denial", patientName: "Grace Liu", mrn: "RH-0060321", payer: "Cigna", service: "Bariatric surgery", code: "43644", amount: 24600, denialReason: "BMI documentation insufficient", deniedOn: "2026-11-06", status: "queued" },
    { id: "w8", trigger: "pa_denial", patientName: "Thomas Reyes", mrn: "RH-0012984", payer: "Anthem BCBS", service: "Spinal cord stimulator trial", code: "63650", amount: 15800, denialReason: "Psych evaluation not documented", deniedOn: "2026-10-22", status: "upheld", readinessPct: 38 },
  ];
  const fixed: Record<string, string> = {
    needs_human: "Needs human: payer asks for signed LMN from ordering provider", awaiting_payer: "Expedited appeal filed; decision due in 48h",
    queued: "Waiting for agent", overturned: "Overturned on appeal; claim reprocessing", upheld: "Upheld; recommend external review", appeal_drafted: "Appeal drafted",
  };
  const items: WorklistItem[] = [heroFromCase(c), ...rows.map((r, i) => ({
    ...r, agentActivity: pick(r.status, i) || fixed[r.status] || "", updatedAt: new Date().toISOString(),
  }))];
  const active = items.filter(i => ["gathering_chart", "analyzing", "calling_payer"].includes(i.status)).length;
  return {
    items,
    stats: {
      activeAgents: active, inQueue: items.filter(i => i.status === "queued").length,
      needsHuman: items.filter(i => i.status === "needs_human").length, overturnedThisWeek: 7,
      dollarsRecovered: 126400, dollarsAtStake: items.filter(i => !["overturned", "upheld"].includes(i.status)).reduce((s, i) => s + i.amount, 0),
    },
  };
}
