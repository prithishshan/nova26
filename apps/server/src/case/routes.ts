// Hero-flow /case API (single in-memory case). See packages/shared HERO HTTP API.
import type { FastifyInstance } from "fastify";
import { ORG, type PatientCase } from "@nova26/shared";
import { emit, newErrand, newId, patchErrand } from "../store.js";
import { placeCall } from "../calls/index.js";
import { cfg } from "../env.js";
import { analyzeCase, toPatientSummary } from "./analyze.js";
import { stripStatus } from "./policies.js";
import { policyByCode, inferIndication, scopeRoot, toPolicyTree, extractCaseOutcome } from "@nova26/engine";
import { buildWorklist, resetWorklist } from "./worklist.js";
import { BILL, CHART, DENIAL_LETTER, DENIAL_STORY, DOS, EOB, GI_DOCTOR, GI_OFFICE, PATIENT, PROVIDER } from "./demo.js";

type CaseState = PatientCase;
const PAYER_LINE = "Aetna provider services / precertification";

// The payer's governing policy, scoped to the patient's indication — attached before the agent runs.
function policyPreview(): PatientCase["policyPreview"] {
  const policy = policyByCode(DENIAL_LETTER.code, PATIENT.payer);
  if (!policy) return undefined;
  const conditions = toPatientSummary(CHART, PATIENT.dob).conditions ?? [];
  const indication = inferIndication(policy.root, conditions) || null;
  const scoped = indication ? scopeRoot(policy.root, indication) : policy.root;
  return {
    policy: { payer: policy.payer, policyId: policy.policyId, title: policy.title, sourceUrl: policy.sourceUrl ?? null },
    indication,
    tree: stripStatus(toPolicyTree(policy.root, scoped, {}, {})),
  };
}

// The case opens with everything attached: Aetna's denial letter, the Epic chart, and the governing policy.
// Running the agent starts at analysis.
const fresh = (): CaseState => ({
  id: newId("case_"),
  patient: { ...PATIENT },
  payerPhone: process.env.DEMO_TO_NUMBER || "",
  chartConnected: true,
  chart: structuredClone(CHART),
  denialLetter: structuredClone(DENIAL_LETTER),
  policyPreview: policyPreview(),
  stage: "docs",
});
let theCase: CaseState = fresh();
let analyzing: Promise<unknown> | null = null;

function paCallBrief(c: CaseState) {
  const d = c.analysis?.denial;
  const dl = c.denialLetter!;
  // The call opens the case; the written appeal and the peer-to-peer decide it.
  const goal =
    `On ${c.patient.payer}'s provider services / precertification line, OPEN an expedited appeal (or reconsideration) of prior-authorization ` +
    `denial ${dl.referenceNumber} (dated ${dl.date}) for ${dl.service} (${dl.code}), ordered by ${ORG.orderingProvider.name}. ` +
    `Use the contradiction below (the chart documents what the denial says is missing) to justify expediting. The rep will not overturn the denial on the phone; ` +
    `your job is to secure: (1) the appeal opened, (2) its reference number, (3) the decision deadline, (4) where to fax the written appeal, ` +
    `(5) a peer-to-peer for ${ORG.orderingProvider.name} with ${c.patient.payer}'s medical director.`;
  const crit = (d?.criteria ?? [])
    .filter((x) => x.status === "met" && !x.notApplicable)
    .map((x) => `- ${x.label}
  chart evidence: ${x.evidence}
  ${d?.policy.payer} policy [${x.sectionPath}]: "${x.policyQuote}"`)
    .join("\n");
  const letterSummary = (d?.appealLetter ?? "").replace(/\s+/g, " ").slice(0, 900);
  const context = `CALLER: an AI assistant calling on behalf of ${ORG.name}'s ${ORG.team.toLowerCase()} team for ${ORG.orderingProvider.name} (${ORG.orderingProvider.specialty}).

PROVIDER IDENTITY (for verification):
- Ordering provider: ${ORG.orderingProvider.name}, ${ORG.orderingProvider.specialty}, NPI ${ORG.orderingProvider.npi}
- Organization: ${ORG.name} (${GI_OFFICE}), tax ID ${ORG.taxId}

MEMBER (patient):
- Name: ${c.patient.name}
- Date of birth: ${c.patient.dob}
- Member ID: ${c.patient.memberId}
- Plan: ${c.patient.plan} (${c.patient.payer})

PRIOR-AUTHORIZATION DENIAL BEING APPEALED:
- Reference number: ${dl.referenceNumber}; letter dated ${dl.date} from ${dl.from}
- Service: ${dl.service}; code ${dl.code}; requested by ${dl.requestedBy}
- Decision: ${dl.decision}
- Stated reason: "${dl.reason}"
- Appeal rights: ${dl.appealRights}

WHY EXPEDITED (urgency): The member is in an active moderate-to-severe Crohn's flare (HBI 12, CRP 24, calprotectin 610 on 2026-10-14; nurse triage 2026-11-04: 8-10 bloody stools/day, abdominal pain). The prescribed infliximab cannot start until this is approved; ${dl.daysSinceDenial} days have passed since the denial.

ANSWER TO THE DENIAL REASON: The chart documents an inadequate response to conventional therapy: prednisone 40 mg with taper (2026-01-05 to 2026-03-30, flared on taper) and ~9 months of azathioprine 2.5 mg/kg (2026-01-20 to 2026-10-14, TPMT normal), per the GI clinic note of 2026-10-14.

GOVERNING POLICY: ${d ? `${d.policy.payer} CPB ${d.policy.policyId} (${d.policy.title})${d.policy.sourceUrl ? ` ${d.policy.sourceUrl}` : ""}` : "unknown"}
Indication: ${d?.indication ?? "Crohn's disease"}. Readiness: ${d?.readinessPct ?? "?"}% of criteria documented (verdict: ${d?.verdict ?? "?"}).

APPLICABLE CRITERIA DOCUMENTED IN THE CHART (cite these if pushed back):
${crit || "(analysis not available)"}

WRITTEN APPEAL LETTER (ready to fax; summary):
${letterSummary}

INSTRUCTIONS:
- At the start, disclose that you are an AI assistant calling on behalf of ${ORG.name}'s prior authorization team for ${ORG.orderingProvider.name}.
- Verify identity with the provider NPI and tax ID plus the member's name, DOB and member ID.
- Ask specifically for an EXPEDITED review because a standard timeframe could seriously jeopardize the member's health.
- If anything needs a human decision (the rep requires a licensed clinician on the line, proposes a peer-to-peer time, asks to change the request), use ask_user - the PA supervisor will answer.
- Never invent facts. Only state what is above. If asked for something not listed, say the team will follow up, or use ask_user.
- Do not ask the rep to approve or overturn the denial on the phone; ask them to open the expedited appeal and route it to clinical review.
- If a peer-to-peer is offered or possible, use ask_user to confirm the time with the supervisor, then book it for ${ORG.orderingProvider.name}.
- Before hanging up, read back what you secured: appeal type and reference number, decision deadline, where to send the written appeal, and the peer-to-peer time.`;
  return { goal, context };
}

function callBrief(c: CaseState) {
  if (c.denialLetter) return paCallBrief(c);
  const d = c.analysis?.denial;
  const line = c.eob?.find((e) => e.carc === "50") ?? c.eob?.find((e) => e.planPaid === 0 && e.patientResp > 0);
  const code = line?.code ?? "J1745";
  const goal =
    `Request reconsideration / a first-level appeal of the denied ${code} claim line (${line?.description ?? "infliximab"}) ` +
    `from date of service ${line?.date ?? DOS} at ${PROVIDER}, denied with CARC ${line?.carc ?? "50"} (not medically necessary). ` +
    `Get an appeal or reference number, how to submit the written appeal letter (fax/address/portal), and the expected timeline for a decision.`;

  const crit = (d?.criteria ?? [])
    .filter((x) => x.status === "met")
    .map((x) => `- ${x.label}\n  chart evidence: ${x.evidence}\n  ${d?.policy.payer} policy [${x.sectionPath}]: "${x.policyQuote}"`)
    .join("\n");
  const letterSummary = (d?.appealLetter ?? "").replace(/\s+/g, " ").slice(0, 900);

  const context = `MEMBER (you are calling on their behalf; they authorized this call):
- Name: ${c.patient.name}
- Date of birth: ${c.patient.dob}
- Member ID: ${c.patient.memberId}
- Plan: ${c.patient.plan} (${c.patient.payer})

CLAIM LINE BEING APPEALED:
- Date of service: ${line?.date ?? DOS}; provider: ${PROVIDER}
- Code: ${code} - ${line?.description ?? ""}
- Billed $${line?.billed ?? ""}, plan paid $${line?.planPaid ?? 0}, member responsibility $${line?.patientResp ?? ""}
- Denial: group ${line?.group ?? "PR"}, CARC ${line?.carc ?? "50"} - "${line?.reason ?? ""}"

WHY THIS IS BEING APPEALED (explain if the rep asks):
${DENIAL_STORY}

GOVERNING POLICY: ${d ? `${d.policy.payer} CPB ${d.policy.policyId} (${d.policy.title})${d.policy.sourceUrl ? ` ${d.policy.sourceUrl}` : ""}` : "unknown"}
Indication: ${d?.indication ?? "Crohn's disease"}. Readiness: ${d?.readinessPct ?? "?"}% of criteria documented (verdict: ${d?.verdict ?? "?"}).

CRITERIA DOCUMENTED IN THE CHART (cite these if the rep asks why it is medically necessary):
${crit || "(analysis not available)"}

APPEAL LETTER SUMMARY (a written letter is ready to send):
${letterSummary}

INSTRUCTIONS:
- At the start, disclose that you are an AI assistant calling on behalf of the member, ${c.patient.name}, who authorized this call.
- If the representative requires the member to be on the line or to give verbal authorization, use ask_user to involve the member.
- Never invent facts. Only state what is above. If asked for something not listed, say you will follow up or ask the member (ask_user).
- Before hanging up, make sure you have: reference/appeal number, where to send the written appeal, and the decision timeline.`;
  return { goal, context };
}

export function registerCaseRoutes(app: FastifyInstance) {
  app.get("/case", async () => ({ case: theCase }));

  app.get("/worklist", async () => buildWorklist(theCase));

  app.post("/case/reset", async () => {
    theCase = fresh();
    resetWorklist();
    return { case: theCase };
  });

  app.post("/case/mychart/connect", async () => {
    theCase = { ...theCase, chartConnected: true, chart: structuredClone(CHART), stage: theCase.stage === "start" ? "chart" : theCase.stage };
    return { case: theCase };
  });

  app.post("/case/documents", async (req) => {
    const b = (req.body ?? {}) as { eob?: boolean; bill?: boolean; denialLetter?: boolean };
    const next: CaseState = { ...theCase };
    if (b.denialLetter) next.denialLetter = structuredClone(DENIAL_LETTER);
    if (next.denialLetter && (next.stage === "start" || next.stage === "chart")) next.stage = "docs";
    if (b.eob) next.eob = structuredClone(EOB);
    if (b.bill) next.bill = structuredClone(BILL);
    if (next.eob && next.bill && (next.stage === "start" || next.stage === "chart")) next.stage = "docs";
    theCase = next;
    return { case: theCase };
  });

  app.post("/case/analyze", async (req, reply) => {
    if (!theCase.denialLetter && (!theCase.eob || !theCase.bill)) return reply.code(400).send({ error: "attach the denial letter (or EOB + bill) first" });
    if (!cfg().openrouterKey) return reply.code(400).send({ error: "OPENROUTER_API_KEY is not set" });
    if (analyzing) await analyzing.catch(() => {});
    const t0 = Date.now();
    const p = analyzeCase(theCase);
    analyzing = p;
    try {
      const { analysis, timings } = await p;
      theCase = { ...theCase, analysis, stage: "analyzed" };
      console.log(`[case] analyzed in ${Date.now() - t0}ms ${JSON.stringify(timings)}`);
      return { case: theCase };
    } catch (err) {
      console.error("[case] analyze failed", err);
      return reply.code(500).send({ error: (err as Error).message });
    } finally {
      analyzing = null;
    }
  });

  app.post("/case/call-payer", async (_req, reply) => {
    if (!theCase.analysis) return reply.code(400).send({ error: "run /case/analyze first" });
    if (!theCase.payerPhone) return reply.code(400).send({ error: "DEMO_TO_NUMBER is not set (payer phone)" });
    const { goal, context } = callBrief(theCase);
    const errand = newErrand(goal);
    patchErrand(errand.id, {
      summary: theCase.denialLetter
        ? `Expedited appeal of ${theCase.patient.payer} PA denial ${theCase.denialLetter.referenceNumber} (Remicade)`
        : `Appeal the denied infliximab claim with ${theCase.patient.payer}`,
      onBehalfOf: `${ORG.name} ${ORG.team} for ${ORG.orderingProvider.name} (member: ${theCase.patient.name})`,
      contacts: [{ name: PAYER_LINE, phone: theCase.payerPhone, role: "insurer provider services / precertification" }],
      status: "running",
    });
    theCase = { ...theCase, errandId: errand.id, stage: "calling" };
    const caseId = theCase.id;

    void placeCall(errand.id, { to: theCase.payerPhone, name: PAYER_LINE, goal, context })
      .then((r) => {
        patchErrand(errand.id, { status: r.status === "completed" ? "done" : "failed", result: { outcome: r.outcome, details: r.transcript } });
        emit(errand.id, { type: "result", outcome: r.outcome, details: r.transcript });
        if (theCase.id === caseId) theCase = { ...theCase, callOutcome: r.outcome, stage: "done" };
        // Structured outcome for the Outcomes tab (what the call secured + next actions).
        return extractCaseOutcome({
          transcript: r.transcript,
          payer: theCase.patient.payer,
          physician: ORG.orderingProvider.name,
          denialRef: theCase.denialLetter?.referenceNumber ?? "",
          today: new Date().toDateString(),
        }).then((outcome) => {
          if (theCase.id === caseId) theCase = { ...theCase, outcome, callOutcome: outcome.summary };
          emit(errand.id, { type: "log", text: `Outcome recorded: ${outcome.summary}` });
        });
      })
      .catch((err) => {
        const msg = `Call failed: ${(err as Error).message}`;
        patchErrand(errand.id, { status: "failed", result: { outcome: msg } });
        emit(errand.id, { type: "result", outcome: msg });
        if (theCase.id === caseId) theCase = { ...theCase, callOutcome: msg, stage: "done" };
      });

    return { case: theCase, errandId: errand.id };
  });
}
