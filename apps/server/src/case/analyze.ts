// Policy engine on the denial + grounded appeal letter.
// HERO path: pre-service prior-auth denial letter (denialLetter). Legacy path: EOB<->bill reconciliation.
import { ORG, type Analysis, type ChartSummary, type CriterionResult, type DenialAnalysis, type DenialDispute, type Finding, type PatientCase, type PolicyTreeNode } from "@nova26/shared";
import {
  buildNarrative,
  evaluatePatient,
  generateAppealLetter,
  generateExpeditedPaAppeal,
  inferIndication,
  isFact,
  mapDenialReason,
  policyByCode,
  resolveCitations,
  toPolicyTree,
  type EvidenceItem,
  type CompiledPolicy,
  type EvalResult,
  type PatientSummary,
  type PolicyNode,
} from "@nova26/engine";
import { reconcile } from "./reconcile.js";
import { DENIAL_STORY, DRUG_COST_PER_INFUSION, GI_DOCTOR, PROVIDER } from "./demo.js";

export function toPatientSummary(c: ChartSummary, dob?: string): PatientSummary {
  const p: PatientSummary = {
    demographics: { name: c.name, gender: c.gender, age: c.age, birthDate: dob },
    conditions: c.conditions,
    medications: c.medications,
    observations: c.observations,
    procedures: c.procedures,
    allergies: c.allergies,
    immunizations: c.immunizations,
    diagnostics: c.diagnostics,
    noteExcerpts: c.noteExcerpts,
  };
  p.narrative = buildNarrative(p);
  return p;
}

/** Leaves that are required by position: reachable through all_of gates (or single-child any_of/n_of). */
function requiredIds(node: PolicyNode, out = new Set<string>()): Set<string> {
  if (isFact(node)) {
    out.add(node.id);
    return out;
  }
  const forced = node.type === "all_of" || node.children.length === 1 || (node.type === "n_of" && (node.n ?? 1) >= node.children.length);
  if (forced) node.children.forEach((c) => requiredIds(c, out));
  return out;
}

const NATIONAL =
  "Nationally, about 34-44% of internal appeals to marketplace insurers and ~43-50% of independent external reviews are decided in the patient's favor (KFF; state insurance departments).";

async function runEngine(policy: CompiledPolicy, chart: ChartSummary, dob: string) {
  const summary = toPatientSummary(chart, dob);
  const indication = inferIndication(policy.root, summary.conditions ?? []) ?? "Crohn's disease";
  const res = await evaluatePatient(policy, summary, { indication });
  const req = requiredIds(res.root);
  const criteria: CriterionResult[] = res.leaves.map((l) => {
    const evidence = res.rationaleById[l.id] ?? "";
    const status = res.statusById[l.id] ?? "unknown";
    return {
      id: l.id,
      label: l.label,
      status,
      evidence,
      policyQuote: l.provenance?.quote ?? "",
      sectionPath: l.provenance?.sectionPath ?? "",
      ...(status === "met" && /^\s*not applicable/i.test(evidence) ? { notApplicable: true } : {}),
    };
  });
  const readinessPct = res.readiness.pct;
  const anyRequiredUnmet = criteria.some((x) => x.status === "unmet" && req.has(x.id));
  const verdict: DenialAnalysis["verdict"] = anyRequiredUnmet ? "weak" : readinessPct >= 80 ? "strong" : "unclear";
  return { res, criteria, readinessPct, verdict };
}

function policyMeta(policy: CompiledPolicy): DenialAnalysis["policy"] {
  const title = /^\w+ CPB \d+$/.test(policy.title) && policy.indication ? `${policy.title} (${policy.indication})` : policy.title;
  return { payer: policy.payer, policyId: policy.policyId, title, sourceUrl: policy.sourceUrl ?? null };
}

function winRate(verdict: DenialAnalysis["verdict"], payer: string) {
  return verdict === "strong"
    ? `${NATIONAL} Your chart documents the criteria ${payer} lists.`
    : verdict === "weak"
      ? `${NATIONAL} Your chart doesn't yet show every criterion ${payer} lists; asking your doctor to document the missing items would strengthen the appeal.`
      : `${NATIONAL} Some of the criteria ${payer} lists aren't clearly documented in your chart yet; an appeal is still possible, and added documentation from your doctor would help.`;
}

export async function analyzeCase(c: PatientCase): Promise<{ analysis: Analysis; timings: Record<string, number> }> {
  return c.denialLetter ? analyzePa(c) : analyzeClaims(c);
}

// ---- HERO: pre-service prior-auth denial ----
async function analyzePa(c: PatientCase) {
  const timings: Record<string, number> = {};
  const dl = c.denialLetter!;
  const finding: Finding = {
    lineId: "pa",
    kind: "appealable_denial",
    title: `${c.patient.payer} denied Remicade (J1745) precert - ${c.patient.name}`,
    amount: DRUG_COST_PER_INFUSION,
    plain:
      `${c.patient.payer} denied precert (${dl.referenceNumber}, ${dl.date}) for lack of documented conventional-therapy failure. ` +
      `Chart documents prednisone failure (2026-01-05 to 2026-03-30, flared on taper) and azathioprine failure (~9 months, 2026-01-20 to 2026-10-14), ` +
      `negative TB screen 2026-09-30, GI prescriber, labeled dosing. Member is in an active flare and therapy has not started ` +
      `(${dl.daysSinceDenial} days since denial) - strong expedited appeal / reconsideration candidate.`,
    action: `File an expedited appeal by phone on ${GI_DOCTOR}'s behalf, fax the written appeal, and offer a peer-to-peer.`,
  };
  const analysis: Analysis = { findings: [finding], analyzedAt: new Date().toISOString() };
  const policy = policyByCode(dl.code, c.patient.payer);
  if (!policy || !c.chart) return { analysis, timings };

  let t = Date.now();
  const { res, criteria, readinessPct, verdict } = await runEngine(policy, c.chart, c.patient.dob);
  timings.evaluateMs = Date.now() - t;

  // Aetna's stated reason -> which criteria it disputes -> what the chart actually shows.
  t = Date.now();
  const applicable = criteria.filter((x) => !x.notApplicable);
  const mapped = await mapDenialReason({
    payer: c.patient.payer,
    reasonText: dl.reason,
    criteria: applicable.map((x) => ({ id: x.id, label: x.label, quote: x.policyQuote, status: x.status, evidence: x.evidence })),
    chartNarrative: toPatientSummary(c.chart, c.patient.dob).narrative ?? "",
  }).catch((e) => {
    console.warn("[analyze] denial mapping failed", (e as Error).message);
    return [];
  });
  timings.disputeMs = Date.now() - t;
  const claims: DenialDispute["claims"] = [];
  mapped.forEach((mc, i) => {
    const existing = mc.criterionId ? criteria.find((x) => x.id === mc.criterionId) : undefined;
    if (existing) {
      existing.disputed = true;
      claims.push({
        criterionId: existing.id, aetnaClaim: mc.aetnaClaim, criterionLabel: existing.label, inCompiledPolicy: true,
        chartStatus: existing.status, chartEvidence: existing.evidence || mc.chartEvidence,
        policyQuote: existing.policyQuote, sectionPath: existing.sectionPath,
      });
    } else {
      // Not in the compiled policy: keep it as its own check, judged against the chart, and flag it.
      const id = `denial-${i + 1}`;
      criteria.push({
        id, label: mc.aetnaClaim, status: mc.chartStatus, evidence: mc.chartEvidence,
        policyQuote: dl.reason, sectionPath: `Denial letter ${dl.referenceNumber}`, disputed: true, fromDenial: true,
      });
      claims.push({
        criterionId: id, aetnaClaim: mc.aetnaClaim, criterionLabel: mc.aetnaClaim, inCompiledPolicy: false,
        chartStatus: mc.chartStatus, chartEvidence: mc.chartEvidence, policyQuote: dl.reason, sectionPath: `Denial letter ${dl.referenceNumber}`,
      });
    }
  });
  const contradicted = claims.length > 0 && claims.every((x) => x.chartStatus === "met");
  const dispute: DenialDispute | undefined = claims.length
    ? {
        reasonText: dl.reason,
        claims,
        contradicted,
        justification: contradicted
          ? `${c.patient.payer} says ${claims.map((x) => x.aetnaClaim.replace(/\.$/, "").toLowerCase()).join(" and ")} was not documented, but the chart documents it with dated evidence. The denial is contradicted by the record, so an expedited appeal and a call to ${c.patient.payer} are justified.`
          : `The chart does not fully answer ${c.patient.payer}'s stated reason; gather the missing documentation before appealing.`,
      }
    : undefined;

  const flare = c.chart.noteExcerpts.find((n) => /flare/i.test(n.text) && /telephone|triage/i.test(n.title));
  const urgency =
    `Active moderate-to-severe Crohn's flare (HBI 12, CRP 24 mg/L, fecal calprotectin 610 ug/g, hemoglobin 10.4 g/dL on 2026-10-14).` +
    (flare ? ` ${flare.date} ${flare.title}: ${flare.text}` : "") +
    ` Prescribed infliximab has not been started because of this denial; ${dl.daysSinceDenial} days have elapsed since the denial.`;

  // Deterministically numbered evidence: key chart facts first (denial rebuttal + urgency), then each applicable criterion.
  const ch = c.chart;
  const pid = `CPB ${policy.policyId}`;
  const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
  const facts: Omit<EvidenceItem, "marker">[] = [
    { chart: `${policy.payer} PA determination ${dl.date} (${dl.referenceNumber}): ${dl.decision}; reason: "${short(dl.reason, 200)}"` },
    ...claims.filter((x) => x.chartStatus === "met").map((x) => ({ chart: `Answers the denial reason ("${short(x.aetnaClaim, 120)}"): ${short(x.chartEvidence, 360)}` })),
    { chart: `Disease activity 2026-10-14: ${ch.observations.filter((o) => /Harvey|C-reactive|calprotectin|Hemoglobin/i.test(o)).join("; ")}` },
    ...ch.noteExcerpts.filter((n) => /triage|telephone/i.test(n.title)).map((n) => ({ chart: `${n.title} (${n.date}): ${short(n.text, 300)}` })),
    ...ch.medications.filter((m) => /infliximab/i.test(m)).map((m) => ({ chart: `Order: ${m}` })),
  ];
  const critEv: Omit<EvidenceItem, "marker">[] = criteria
    .filter((x) => x.status === "met" && !x.notApplicable)
    .map((x) => ({ criterionId: x.id, chart: short(x.evidence, 260), policy: x.fromDenial ? `${policy.payer} denial ${dl.referenceNumber}: “${short(dl.reason, 160)}”` : `${pid} §${x.sectionPath}: “${short(x.policyQuote, 160)}”` }));
  const evidence: EvidenceItem[] = [...facts, ...critEv].map((e, i) => ({ ...e, marker: String(i + 1) }));

  const naIds = new Set(criteria.filter((x) => x.notApplicable).map((x) => x.id));
  const disputedIds = new Set(criteria.filter((x) => x.disputed).map((x) => x.id));
  const markDisputed = (n: PolicyTreeNode): PolicyTreeNode => ({
    ...n, ...(disputedIds.has(n.id) ? { disputed: true } : {}), ...(n.children ? { children: n.children.map(markDisputed) } : {}),
  });
  const policyTree = markDisputed(toPolicyTree(policy.root, res.root, res.statusById, res.rationaleById, naIds));

  t = Date.now();
  const rawLetter = await generateExpeditedPaAppeal({
    evidence,
    member: { name: c.patient.name, dob: c.patient.dob, memberId: c.patient.memberId, plan: c.patient.plan },
    payer: policy.payer,
    policy: { policyId: policy.policyId, title: policyMeta(policy).title, sourceUrl: policy.sourceUrl },
    indication: res.policy.indication,
    denial: { date: dl.date, referenceNumber: dl.referenceNumber, service: dl.service, code: dl.code, decision: dl.decision, reason: dl.reason, requestedBy: dl.requestedBy },
    urgency,
    rebuttalEvidence: claims.map((x) => `${c.patient.payer} claims: ${x.aetnaClaim} -> chart (${x.chartStatus}): ${x.chartEvidence}`).join("\n"),
    from: { name: ORG.orderingProvider.name, specialty: ORG.orderingProvider.specialty, npi: ORG.orderingProvider.npi, org: ORG.name, team: ORG.team, taxId: ORG.taxId },
    criteria: criteria.filter((x) => !x.notApplicable),
  });
  const { letter: appealLetter, citations: letterCitations } = resolveCitations(rawLetter, evidence);
  timings.letterMs = Date.now() - t;

  analysis.denial = {
    lineId: "pa",
    policy: policyMeta(policy),
    indication: res.policy.indication ?? null,
    criteria,
    readinessPct,
    verdict,
    appealLetter,
    letterCitations,
    policyTree,
    ...(dispute ? { dispute } : {}),
    winRateNote: winRate(verdict, policy.payer),
  };
  return { analysis, timings };
}

// ---- Legacy: EOB <-> bill ----
async function analyzeClaims(c: PatientCase) {
  const timings: Record<string, number> = {};
  const findings = reconcile(c.eob ?? [], c.bill ?? []);
  const analysis: Analysis = { findings, analyzedAt: new Date().toISOString() };
  const denialFinding = findings.find((f) => f.kind === "appealable_denial");
  const billLine = denialFinding && c.bill?.find((b) => b.id === denialFinding.lineId);
  const eobLine = billLine && c.eob?.find((e) => e.code === billLine.code && e.date === billLine.date);
  if (!denialFinding || !eobLine || !c.chart) return { analysis, timings };
  const policy = policyByCode(eobLine.code, c.patient.payer);
  if (!policy) return { analysis, timings };

  let t = Date.now();
  const { res, criteria, readinessPct, verdict } = await runEngine(policy, c.chart, c.patient.dob);
  timings.evaluateMs = Date.now() - t;
  t = Date.now();
  const appealLetter = await generateAppealLetter({
    member: { name: c.patient.name, dob: c.patient.dob, memberId: c.patient.memberId, plan: c.patient.plan },
    payer: policy.payer,
    policy: { policyId: policy.policyId, title: policy.title, sourceUrl: policy.sourceUrl },
    indication: res.policy.indication,
    claim: { dateOfService: eobLine.date, provider: PROVIDER, code: eobLine.code, description: eobLine.description, billed: eobLine.billed, denialCode: eobLine.carc, denialReason: eobLine.reason },
    denialContext: DENIAL_STORY,
    criteria,
  });
  timings.letterMs = Date.now() - t;
  analysis.denial = {
    lineId: denialFinding.lineId,
    policy: policyMeta(policy),
    indication: res.policy.indication ?? null,
    criteria,
    readinessPct,
    verdict,
    appealLetter,
    winRateNote: winRate(verdict, policy.payer),
  };
  return { analysis, timings };
}

export type { EvalResult };
