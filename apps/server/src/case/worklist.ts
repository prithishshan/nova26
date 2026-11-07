// GET /worklist: the PA & Denials team's agent dashboard. The hero item mirrors the real /case
// state; the other items are a deterministic simulation that advances with wall-clock time
// (each item steps every 15-25s through its script). resetWorklist() restarts the simulation.
import type { PatientCase, WorklistItem, WorklistResponse, WorklistStatus } from "@nova26/shared";
import { errands } from "../store.js";
import { DRUG_COST_PER_INFUSION } from "./demo.js";

type Step = { status: WorklistStatus; activity: string };
type Synth = Omit<WorklistItem, "status" | "agentActivity" | "updatedAt" | "readinessPct"> & {
  steps: Step[];
  startAt: number; // step index at t=0
  periodS: number; // seconds per step
  criteria: number;
};

let simStart = Date.now();
export function resetWorklist() {
  simStart = Date.now();
}

const S = (status: WorklistStatus, activity: string): Step => ({ status, activity });

function script(payer: string, criteria: number, missing: string, end: "overturned" | "upheld" | "awaiting_payer", hold = 6): Step[] {
  const steps: Step[] = [
    S("queued", `Denial letter ingested from ${payer} portal; queued for agent`),
    S("gathering_chart", "Pulling chart from Epic (problems, meds, notes, imaging)"),
    S("calling_payer", `Calling ${payer} precert: confirming which documentation was missing`),
    S("gathering_chart", `Got denial detail: ${missing} -> requesting from Epic`),
    S("analyzing", `Checking ${criteria} criteria against chart`),
    S("appeal_drafted", `Drafting appeal (${criteria}/${criteria} criteria cited)`),
    S("calling_payer", `On hold with ${payer} provider services - ${hold} min`),
    S("awaiting_payer", "Faxed appeal; awaiting decision"),
  ];
  if (end === "overturned") steps.push(S("overturned", `${payer} overturned denial - authorization approved`));
  if (end === "upheld") steps.push(S("upheld", `${payer} upheld denial - escalating to external review`));
  return steps;
}

const SYNTH: Synth[] = [
  { id: "wl_01", trigger: "pa_denial", patientName: "Maria Gonzalez", mrn: "E2048811", payer: "Cigna", service: "Laparoscopic sleeve gastrectomy", code: "43775", amount: 23800, denialReason: "Documentation does not show completion of a 6-month physician-supervised weight management program.", deniedOn: "2026-10-30", criteria: 11, steps: script("Cigna", 11, "missing dietitian visit notes", "overturned", 9), startAt: 4, periodS: 18 },
  { id: "wl_02", trigger: "pa_denial", patientName: "James Whitfield", mrn: "E1177302", payer: "UnitedHealthcare", service: "Upper eyelid blepharoplasty, bilateral", code: "15823", amount: 4200, denialReason: "Visual field testing does not demonstrate superior field loss meeting policy threshold.", deniedOn: "2026-11-02", criteria: 7, steps: script("UHC", 7, "missing taped/untaped visual fields", "awaiting_payer", 4), startAt: 1, periodS: 22 },
  { id: "wl_03", trigger: "pa_denial", patientName: "Aisha Rahman", mrn: "E3390145", payer: "Aetna", service: "Reduction mammaplasty", code: "19318", amount: 14600, denialReason: "Estimated tissue removal does not meet the minimum for body surface area.", deniedOn: "2026-10-25", criteria: 9, steps: script("Aetna", 9, "missing surgeon's resection estimate", "overturned", 12), startAt: 6, periodS: 20 },
  { id: "wl_04", trigger: "pa_denial", patientName: "Robert Kim", mrn: "E2201987", payer: "Cigna", service: "Entyvio (vedolizumab) IV infusion", code: "J3380", amount: 7900, denialReason: "No documentation of inadequate response to a conventional agent for ulcerative colitis.", deniedOn: "2026-11-03", criteria: 8, steps: script("Cigna", 8, "missing mesalamine trial dates", "awaiting_payer", 7), startAt: 0, periodS: 16 },
  { id: "wl_05", trigger: "pa_denial", patientName: "Linda Okafor", mrn: "E1458820", payer: "Cigna", service: "Humira (adalimumab) subcutaneous", code: "J0135", amount: 6800, denialReason: "Prescriber specialty not documented as rheumatology or in consultation.", deniedOn: "2026-10-29", criteria: 6, steps: script("Cigna", 6, "missing rheumatology consult note", "overturned", 5), startAt: 5, periodS: 24 },
  { id: "wl_06", trigger: "pa_denial", patientName: "Thomas Brennan", mrn: "E3012276", payer: "UnitedHealthcare", service: "Gastric bypass (Roux-en-Y), laparoscopic", code: "43644", amount: 38200, denialReason: "Psychological evaluation not submitted with the request.", deniedOn: "2026-10-21", criteria: 12, steps: script("UHC", 12, "missing psych evaluation", "upheld", 14), startAt: 7, periodS: 21 },
  { id: "wl_07", trigger: "pa_denial", patientName: "Grace Liu", mrn: "E2786634", payer: "Aetna", service: "MRI lumbar spine without contrast", code: "72148", amount: 1200, denialReason: "Less than 6 weeks of conservative therapy documented before advanced imaging.", deniedOn: "2026-11-05", criteria: 5, steps: script("Aetna", 5, "missing PT notes (8 weeks)", "overturned", 3), startAt: 2, periodS: 15 },
  { id: "wl_08", trigger: "pa_denial", patientName: "Marcus Hill", mrn: "E1934458", payer: "UnitedHealthcare", service: "Inflectra (infliximab-dyyb) IV infusion", code: "Q5103", amount: 5400, denialReason: "TB screening within 12 months not documented.", deniedOn: "2026-11-01", criteria: 10, steps: script("UHC", 10, "missing QuantiFERON result", "awaiting_payer", 8), startAt: 3, periodS: 19 },
  { id: "wl_09", trigger: "pa_denial", patientName: "Sofia Petrov", mrn: "E2650019", payer: "Cigna", service: "Upper eyelid blepharoplasty, bilateral", code: "15823", amount: 3900, denialReason: "Photographs do not demonstrate eyelid skin resting on the lashes.", deniedOn: "2026-11-04", criteria: 7, steps: script("Cigna", 7, "missing external photos", "overturned", 6), startAt: 0, periodS: 25 },
];

function synthAt(it: Synth, now: number): WorklistItem {
  const elapsedS = Math.max(0, (now - simStart) / 1000);
  const ticks = Math.floor(elapsedS / it.periodS);
  const idx = Math.min(it.startAt + ticks, it.steps.length - 1);
  const step = it.steps[idx];
  const readinessPct = idx >= 4 ? 100 : idx >= 3 ? Math.round(((idx - 1) / 4) * 100) : undefined;
  const stepAt = idx > it.startAt ? simStart + (idx - it.startAt) * it.periodS * 1000 : simStart - (it.startAt + 1) * 37_000;
  const { steps: _s, startAt: _a, periodS: _p, criteria: _c, ...base } = it;
  return { ...base, status: step.status, agentActivity: step.activity, ...(readinessPct !== undefined ? { readinessPct } : {}), updatedAt: new Date(stepAt).toISOString() };
}

function heroItem(c: PatientCase): WorklistItem {
  const dl = c.denialLetter;
  const pending = c.errandId ? errands.get(c.errandId)?.pendingQuestion : undefined;
  let status: WorklistStatus;
  let agentActivity: string;
  switch (c.stage) {
    case "start":
      status = "queued";
      agentActivity = "Queued: Aetna PA denial for Remicade awaiting agent";
      break;
    case "chart":
      status = "gathering_chart";
      agentActivity = "Pulled chart from Epic; waiting for the denial letter";
      break;
    case "docs":
      status = "analyzing";
      agentActivity = "Denial letter ingested; checking Aetna CPB 0341 criteria against chart";
      break;
    case "analyzed": {
      const d = c.analysis?.denial;
      const applicable = d?.criteria.filter((x) => !x.notApplicable) ?? [];
      const met = applicable.filter((x) => x.status === "met").length;
      status = "appeal_drafted";
      agentActivity = d ? `Drafted expedited appeal (${met}/${applicable.length} criteria cited) - ready to call Aetna` : "Analysis complete";
      break;
    }
    case "calling":
      status = pending ? "needs_human" : "calling_payer";
      agentActivity = pending ? `Needs you: ${pending.text}` : "On the line with Aetna provider services / precertification";
      break;
    case "done":
    default:
      status = "awaiting_payer";
      agentActivity = c.callOutcome ? `Call done: ${c.callOutcome}` : "Expedited appeal filed; awaiting Aetna decision";
  }
  return {
    id: c.id,
    isHero: true,
    trigger: "pa_denial",
    patientName: c.patient.name,
    mrn: c.chart?.mrn ?? "E1009934",
    payer: c.patient.payer,
    service: dl?.service ?? "Remicade (infliximab) IV infusion",
    code: dl?.code ?? "J1745",
    amount: DRUG_COST_PER_INFUSION,
    denialReason: dl?.reason ?? "Not medically necessary: inadequate response to conventional therapy not documented.",
    deniedOn: dl?.date ?? "2026-10-28",
    status,
    agentActivity,
    ...(c.analysis?.denial ? { readinessPct: c.analysis.denial.readinessPct } : {}),
    updatedAt: c.analysis?.analyzedAt ?? new Date(simStart).toISOString(),
  };
}

const ACTIVE: WorklistStatus[] = ["gathering_chart", "analyzing", "appeal_drafted", "calling_payer", "needs_human"];
const OPEN: WorklistStatus[] = ["queued", ...ACTIVE, "awaiting_payer"];

export function buildWorklist(c: PatientCase): WorklistResponse {
  const now = Date.now();
  const items = [heroItem(c), ...SYNTH.map((s) => synthAt(s, now))];
  const sum = (xs: WorklistItem[]) => xs.reduce((a, x) => a + x.amount, 0);
  return {
    items,
    stats: {
      activeAgents: items.filter((x) => ACTIVE.includes(x.status)).length,
      inQueue: items.filter((x) => x.status === "queued").length,
      needsHuman: items.filter((x) => x.status === "needs_human").length,
      overturnedThisWeek: items.filter((x) => x.status === "overturned").length,
      dollarsRecovered: sum(items.filter((x) => x.status === "overturned")),
      dollarsAtStake: sum(items.filter((x) => OPEN.includes(x.status))),
    },
  };
}
