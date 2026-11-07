// Shared contract between the server and the app. The Errand is the core request
// schema: everything the user says in intake chat is distilled into one of these,
// and the agent runs against it.

import { z } from "zod";

export const ConstraintKind = z.enum(["time", "budget", "location", "preference", "must", "must_not", "other"]);

export const Constraint = z.object({
  kind: ConstraintKind,
  text: z.string(),
});

export const Contact = z.object({
  name: z.string(),
  phone: z.string().optional(), // E.164 when known, e.g. +14125550142
  url: z.string().optional(),
  role: z.string().optional(), // "dentist office", "pharmacy", ...
});

export const StepKind = z.enum(["web", "call", "ask_user", "note"]);
export const StepStatus = z.enum(["pending", "running", "done", "failed", "skipped"]);
export const PlanStep = z.object({
  id: z.string(),
  kind: StepKind,
  description: z.string(),
  status: StepStatus,
});

export const ErrandStatus = z.enum(["draft", "ready", "running", "needs_input", "done", "failed"]);

export const Errand = z.object({
  id: z.string(),
  createdAt: z.string(),
  objective: z.string(), // the rough goal, in the user's words
  summary: z.string().optional(), // agent's one-line restatement
  constraints: z.array(Constraint),
  onBehalfOf: z.string().optional(), // whose errand this is, e.g. "my mom, Ruth Alvarez"
  contacts: z.array(Contact),
  approvalRules: z.array(z.string()), // "check with me before paying anything"
  missingInfo: z.array(z.string()), // what intake still needs to ask
  status: ErrandStatus,
  plan: z.array(PlanStep),
  result: z.object({ outcome: z.string(), details: z.string().optional() }).optional(),
  pendingQuestion: z.object({ id: z.string(), text: z.string(), options: z.array(z.string()).optional() }).optional(),
});

export type Constraint = z.infer<typeof Constraint>;
export type Contact = z.infer<typeof Contact>;
export type PlanStep = z.infer<typeof PlanStep>;
export type ErrandStatus = z.infer<typeof ErrandStatus>;
export type Errand = z.infer<typeof Errand>;

// ---- Intake chat ----
export type ChatMessage = { role: "user" | "agent"; text: string; at: string };

// ---- Activity feed (what the app renders while the agent works) ----
export type ErrandEvent =
  | { seq: number; at: string; type: "log"; text: string }
  | { seq: number; at: string; type: "plan"; plan: PlanStep[] }
  | { seq: number; at: string; type: "web"; action: "search" | "fetch"; query: string; summary?: string }
  | { seq: number; at: string; type: "call_status"; callId: string; to: string; status: CallStatus }
  | { seq: number; at: string; type: "transcript"; callId: string; speaker: "agent" | "callee"; text: string }
  | { seq: number; at: string; type: "question"; question: { id: string; text: string; options?: string[] } }
  | { seq: number; at: string; type: "answer"; questionId: string; text: string }
  | { seq: number; at: string; type: "result"; outcome: string; details?: string }
  | { seq: number; at: string; type: "error"; text: string }
  // The call agent's private reasoning for its next utterance (shown as a trace in the console, never spoken).
  | { seq: number; at: string; type: "reasoning"; callId: string; text: string; cites?: string[] };

export type CallStatus = "dialing" | "ringing" | "in_progress" | "on_hold_for_user" | "completed" | "failed" | "no_answer";

// ---- HTTP API (server on PORT, default 8787) ----
// POST /errands/intake        { errandId?: string, message: string }
//   -> { errand: Errand, messages: ChatMessage[], reply: string }
//   Creates the errand on first message; each message refines the schema.
// GET  /errands               -> { errands: Errand[] }
// GET  /errands/:id           -> { errand: Errand, messages: ChatMessage[] }
// PATCH /errands/:id          Partial<Errand> (manual edits from the form) -> { errand }
// POST /errands/:id/run       -> { errand }   starts the agent (async)
// GET  /errands/:id/events?after=<seq>  -> { events: ErrandEvent[], errand: Errand }   (poll ~1s)
// POST /errands/:id/answer    { questionId: string, text: string } -> { ok: true }
// --- simulated calls (CALL_MODE=sim): the app plays the callee ---
// POST /calls/:callId/sim-reply { text: string } -> { ok: true }   ("[hangup]" ends the call)
export type IntakeResponse = { errand: Errand; messages: ChatMessage[]; reply: string };
export type EventsResponse = { events: ErrandEvent[]; errand: Errand };

// =====================================================================================
// HERO FLOW: patient-side denial/bill dispute (one patient, end to end)
// Patient connects MyChart -> adds EOB + bill -> analysis (EOB↔bill reconciliation +
// policy engine on the appealable denial) -> agent calls the payer with the evidence.
// =====================================================================================

export type ChartSummary = {
  name: string; age?: number; gender?: string; mrn: string;
  conditions: string[]; medications: string[]; observations: string[]; procedures: string[];
  allergies: string[]; immunizations: string[]; diagnostics: string[];
  noteExcerpts: { title: string; date: string; text: string }[];
};

// One service line on the payer's EOB. group/carc are the remittance adjustment codes.
export type EobLine = {
  id: string; date: string; code: string; description: string;
  billed: number; allowed: number; planPaid: number; patientResp: number;
  group: "CO" | "PR" | "OA" | null; carc?: string; rarc?: string; reason?: string;
};
export type BillLine = { id: string; date: string; code: string; description: string; amount: number };

export type FindingKind = "owe_ok" | "billing_error" | "appealable_denial" | "mismatch";
export type Finding = {
  lineId: string; kind: FindingKind; title: string;
  plain: string; // plain-language explanation for the patient
  amount: number; action?: string; // what we'll do about it
};

export type CriterionResult = {
  id: string; label: string; status: "met" | "unmet" | "unknown";
  evidence: string; // chart evidence (from the evaluator rationale)
  policyQuote: string; sectionPath: string; // grounded policy span
  notApplicable?: boolean; // e.g. pediatric/other-product rules — hide in the UI, don't cite on calls
  disputed?: boolean; // Aetna's denial says this criterion isn't met
  fromDenial?: boolean; // synthesized from the denial reason (not found in the compiled policy)
};

// Aetna's stated denial reason, mapped onto the policy and tested against the chart.
export type DisputedClaim = {
  criterionId: string; // CriterionResult.id (existing criterion, or a synthesized "denial-N" one)
  aetnaClaim: string; // what the denial says is missing, in plain words
  criterionLabel: string;
  inCompiledPolicy: boolean; // false → reason has no matching criterion in the compiled policy (flag for review)
  chartStatus: "met" | "unmet" | "unknown"; // what the chart actually shows
  chartEvidence: string; // dated chart facts that answer the claim
  policyQuote?: string; sectionPath?: string;
};
export type DenialDispute = {
  reasonText: string; // the denial letter's reason, verbatim
  claims: DisputedClaim[];
  contradicted: boolean; // every disputed claim is met by chart evidence
  justification: string; // one plain sentence: why appealing + calling is justified (or not)
};

// The payer's compiled criteria tree, annotated for the supervisor view.
export type PolicyTreeNode = {
  id: string; kind: "all_of" | "any_of" | "n_of" | "leaf" | "judgment"; label: string; n?: number;
  inScope: boolean; // part of the branch adjudicated for this patient (General + matched indication)
  status?: "met" | "unmet" | "unknown"; notApplicable?: boolean; // leaves only
  quote?: string; sectionPath?: string; evidence?: string; // leaves only
  disputed?: boolean; // Aetna's denial cites this rule
  children?: PolicyTreeNode[];
};
// A numbered citation used in the appeal letter ("[1]") — points at chart evidence and/or a policy section.
export type LetterCitation = {
  marker: string; // "1", "2", ...
  criterionId?: string; // CriterionResult.id it supports
  chart?: string; // chart source, e.g. "GI clinic note 2026-10-14: prednisone 40 mg Jan–Mar, flared on taper"
  policy?: string; // e.g. "CPB 0341 §Crohn's disease ¶1: “…quote…”"
};

export type DenialAnalysis = {
  lineId: string;
  policy: { payer: string; policyId: string; title: string; sourceUrl: string | null };
  indication: string | null;
  criteria: CriterionResult[];
  readinessPct: number; // code-computed
  verdict: "strong" | "weak" | "unclear";
  appealLetter: string; // grounded, cites policy + chart; contains inline markers like [1], [2] → letterCitations
  letterCitations?: LetterCitation[];
  dispute?: DenialDispute; // Aetna says these criteria aren't met; here's what the chart shows
  policyTree?: PolicyTreeNode; // full compiled tree for the policy, statuses on in-scope leaves
  winRateNote: string; // national context, labeled as such
};

export type Analysis = { findings: Finding[]; denial?: DenialAnalysis; analyzedAt: string };

export type PatientCase = {
  id: string;
  patient: { name: string; memberId: string; payer: string; plan: string; dob: string };
  payerPhone: string; // who the agent calls (DEMO_TO_NUMBER in the demo)
  chartConnected: boolean; chart?: ChartSummary;
  eob?: EobLine[]; bill?: BillLine[]; // (legacy EOB/bill path — not used by the PA hero)
  // HERO (prior-auth denial): the member's denial letter from Aetna
  denialLetter?: {
    date: string; from: string; requestedBy: string; // prescribing office
    service: string; code: string; // e.g. "Remicade (infliximab) IV infusion", "J1745"
    decision: string; reason: string; // verbatim-ish denial rationale
    referenceNumber: string; appealRights: string; // incl. expedited appeal by phone
    daysSinceDenial: number; officeAppealed: boolean;
  };
  callOutcome?: string;
  outcome?: CaseOutcome; // structured result of the payer call (what the call secured + who does what next)
  // The payer policy that governs the denied service, attached up front (before the agent runs) — no verdicts yet.
  policyPreview?: { policy: { payer: string; policyId: string; title: string; sourceUrl: string | null }; indication: string | null; tree: PolicyTreeNode };
  analysis?: Analysis;
  errandId?: string; // the call runs as an errand → poll GET /errands/:id/events
  stage: "start" | "chart" | "docs" | "analyzed" | "calling" | "done";
};

// ---- HERO HTTP API ----
// GET  /case                    -> { case: PatientCase }
// POST /case/reset              -> { case }
// POST /case/mychart/connect    -> { case }   loads the patient's chart (demo: preset Epic-shaped chart)
// POST /case/documents { denialLetter: true } -> { case }  attaches Aetna's PA denial letter (demo: canned)
//   (legacy: { eob?: boolean, bill?: boolean })
// POST /case/analyze            -> { case }   reconciliation + policy engine + appeal (10-30s)
// POST /case/call-payer         -> { case, errandId }  starts the payer call; then poll /errands/:id/events
// ---- in-call patient controls (existing + new) ----
// POST /errands/:id/answer { questionId, text }  answers the agent's mid-call question card
// POST /calls/:callId/relay { text }  agent speaks the patient's words (verbatim, attributed) at its next turn
export type CaseResponse = { case: PatientCase; errandId?: string };

// =====================================================================================
// PROVIDER-SIDE PIVOT: hospital Prior Auth & Denials team supervises many agents.
// Web dashboard. One HERO case (Prithish Shan, Aetna Remicade PA denial) runs for real;
// the rest of the worklist is simulated agent activity.
// =====================================================================================
export const ORG = {
  name: "Riverside Health",
  team: "Prior Authorization & Denials",
  orderingProvider: { name: "Dr. Elena Park, MD", specialty: "Gastroenterology", npi: "1093817465" }, // demo NPI
  taxId: "25-1234567", // demo
} as const;

export type WorklistStatus =
  | "queued" | "gathering_chart" | "analyzing" | "appeal_drafted" | "calling_payer"
  | "needs_human" | "awaiting_payer" | "overturned" | "upheld";
// What triggered the case: a prior-auth denial letter, or a denied line on an EOB/835 remittance.
export type CaseTrigger = "pa_denial" | "eob_denial";
export type WorklistItem = {
  id: string; isHero?: boolean; trigger: CaseTrigger;
  carc?: string; // for eob_denial, e.g. "50", "197", "16"
  patientName: string; mrn: string; payer: string;
  service: string; code: string; amount: number;
  denialReason: string; deniedOn: string;
  status: WorklistStatus;
  agentActivity: string; // one-line "what the agent is doing now"
  readinessPct?: number; updatedAt: string;
};
export type WorklistResponse = {
  items: WorklistItem[];
  stats: { activeAgents: number; inQueue: number; needsHuman: number; overturnedThisWeek: number; dollarsRecovered: number; dollarsAtStake: number };
};
// GET /worklist -> WorklistResponse   (hero item mirrors the real /case state; others tick forward on their own)
// Hero case keeps using the /case/* endpoints above. In the provider framing:
//   POST /case/mychart/connect == "pull chart from Epic" (same data), POST /case/documents {denialLetter:true} == "ingest Aetna PA denial".

// ---- Payer policy library (supervisor "Policies" panel) ----
export type PolicyLibraryItem = {
  payer: string; policyId: string; title: string; indication: string;
  version: string; status: string; effectiveStart: string | null; effectiveEnd: string | null;
  codes: string[]; referencedCodes: string[]; sourceUrl: string | null; sourceHash: string | null;
  extractionModel: string | null; criteriaCount: number; nodeCount: number;
  usedByCases: number; // open cases routed to this policy
};
// GET /policies -> { policies: PolicyLibraryItem[] }
// GET /policies/:payer/:policyId -> { policy: PolicyLibraryItem, tree: PolicyTreeNode }

// ---- Agent outcomes (what the call secured; the decision itself happens on the written record / peer-to-peer) ----
export type OutcomeItem = { label: string; value: string; status: "secured" | "pending" | "not_obtained" };
export type NextAction = { owner: string; action: string; due?: string; done?: boolean };
export type CaseOutcome = {
  summary: string; // one sentence, e.g. "Aetna opened an expedited appeal and booked a peer-to-peer; decision due within 72 hours."
  appealType: string | null; // e.g. "Expedited appeal" / "Reconsideration"
  referenceNumber: string | null;
  decisionDue: string | null; // e.g. "within 72 hours (by Nov 10, 2026)"
  submitTo: string | null; // fax number / portal where the written appeal goes
  peerToPeer: string | null; // e.g. "Tomorrow 2:00 PM ET with an Aetna medical director"
  repName: string | null;
  items: OutcomeItem[]; // checklist of what the call was meant to secure
  nextActions: NextAction[];
  extractedAt: string;
};
