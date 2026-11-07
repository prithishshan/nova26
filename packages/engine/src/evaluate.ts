// Policy evaluation (ported from azure_hackathon src/lib/evaluate.ts). The LLM returns per-leaf
// met/unmet + rationale; citations come from the tree; readiness % is computed in CODE.
// Azure client replaced by OpenRouter (openai SDK); non-streaming JSON for reliability.
import { engineClient, engineModel } from "./client.js";
import { uniqueLeaves, readiness, type CompiledPolicy, type FactNode, type PolicyNode, type Status } from "./policies.js";
import { scopeRoot, inferIndication } from "./questionnaire.js";

export type NoteExcerpt = { title: string; date: string; text: string };
export type PatientSummary = {
  demographics?: { name?: string; gender?: string; birthDate?: string; age?: number };
  conditions?: string[];
  medications?: string[];
  observations?: string[];
  procedures?: string[];
  allergies?: string[];
  immunizations?: string[];
  diagnostics?: string[];
  documents?: string[];
  noteExcerpts?: NoteExcerpt[];
  notes?: string;
  narrative?: string;
};

export type EvalOpts = { indication?: string | null };

export type EvalResult = {
  policy: { payer: string; policyId: string; title: string; version: string; indication: string; codes: string[]; sourceUrl: string | null };
  root: PolicyNode;
  leaves: FactNode[];
  statusById: Record<string, Status>;
  rationaleById: Record<string, string>;
  citation: { label: string; url: string | null };
  suggestions: { change: string; why: string }[];
  readiness: ReturnType<typeof readiness>;
  ms: number;
};

export function scopeForPatient(policy: CompiledPolicy, patient: PatientSummary, opts?: EvalOpts) {
  const indication = (opts?.indication ?? inferIndication(policy.root, patient.conditions ?? [])) || null;
  const root = indication ? scopeRoot(policy.root, indication) : policy.root;
  return { root, indication };
}

function extractJson(s: string): any {
  const t = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {}
  }
  // JSONL fallback: one object per line
  const assessments: any[] = [];
  let suggestions: any[] = [];
  for (const line of t.split("\n")) {
    try {
      const o = JSON.parse(line.trim());
      if (Array.isArray(o?.suggestions)) suggestions = o.suggestions;
      else if (o?.id) assessments.push(o);
    } catch {}
  }
  return { assessments, suggestions };
}

export async function evaluatePatient(policy: CompiledPolicy, patient: PatientSummary, opts?: EvalOpts): Promise<EvalResult> {
  const t0 = Date.now();
  const { root, indication } = scopeForPatient(policy, patient, opts);
  const leaves = uniqueLeaves(root);
  const validIds = new Set(leaves.map((l) => l.id));
  const statusById: Record<string, Status> = {};
  const rationaleById: Record<string, string> = {};
  for (const l of leaves) statusById[l.id] = "unknown";

  const { system, user } = judgeMessages(policy, leaves, patient, indication);
  const res = await engineClient().chat.completions.create({
    model: engineModel(),
    max_tokens: 4000,
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const parsed = extractJson(res.choices[0]?.message?.content ?? "") ?? {};
  for (const a of Array.isArray(parsed.assessments) ? parsed.assessments : []) {
    const id = String(a?.id ?? "");
    if (validIds.has(id) && (a.status === "met" || a.status === "unmet")) {
      // Guard: a "Not applicable:" rationale means the conditional criterion is satisfied (model sometimes mislabels).
      statusById[id] = /^\s*not applicable/i.test(String(a.rationale ?? "")) ? "met" : a.status;
      rationaleById[id] = String(a.rationale ?? "");
    }
  }
  const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
    .slice(0, 5)
    .map((s: any) => ({ change: String(s?.change ?? ""), why: String(s?.why ?? "") }));

  return {
    policy: {
      payer: policy.payer,
      policyId: policy.policyId,
      title: policy.title,
      version: policy.version,
      indication: indication || policy.indication,
      codes: policy.codes,
      sourceUrl: policy.sourceUrl ?? null,
    },
    root,
    leaves,
    statusById,
    rationaleById,
    citation: { label: `${policy.payer} CPB ${policy.policyId}`, url: policy.sourceUrl ?? null },
    suggestions,
    readiness: readiness(root, statusById),
    ms: Date.now() - t0,
  };
}

function judgeMessages(policy: CompiledPolicy, leaves: FactNode[], patient: PatientSummary, scopedIndication?: string | null) {
  const criteriaList = leaves
    .map((l) => {
      const hints = l.requirement.fhirHints?.length ? ` | look in: ${l.requirement.fhirHints.join(", ")}` : "";
      return `- id=${l.id} | ${l.label} | requires: ${l.requirement.description}${hints}`;
    })
    .join("\n");

  const system = [
    "You are a prior-authorization / claims-appeal evaluator. For EACH criterion, search the ENTIRE patient dossier (problems,",
    "medications, labs, vitals, procedures, diagnostic reports, AND the free-text clinical note excerpts) for evidence",
    "that satisfies or contradicts it. Judge a criterion 'met' or 'unmet' ONLY with evidence; OMIT criteria with none.",
    "Do not guess beyond what the dossier states. Each rationale MUST pin the specific evidence found: quote the",
    "value/finding and its source and date (e.g. 'QuantiFERON negative 2026-03-14').",
    "CONDITIONAL CRITERIA: some criteria only apply in a situation (e.g. 'if TB screening is positive...', pediatric-only age",
    "rules, rules for a different product formulation the member is not receiving). If the dossier clearly documents that the",
    "triggering situation does NOT apply (e.g. TB screening was negative; the member is an adult; the member receives IV",
    "infliximab, not the subcutaneous product), judge it 'met' and begin the rationale with 'Not applicable:' followed by the",
    "evidence. Administrative statements (e.g. precertification required, approvals subject to dosing limits) are 'met' only",
    "if the dossier documents compliance (e.g. precertification submitted, dose within label).",
    "SUGGESTIONS: documentation and wording only; never change or add a diagnosis or assert a clinical fact not in the chart.",
    'OUTPUT: ONE JSON object and nothing else: {"assessments":[{"id":"<id>","status":"met"|"unmet","rationale":"<evidence>"}],',
    '"suggestions":[{"change":"...","why":"..."}]} (at most 5 suggestions).',
  ].join(" ");

  const user = `POLICY: ${policy.title} (${policy.payer} CPB ${policy.policyId})
COVERS: ${scopedIndication || policy.indication}

PATIENT DOSSIER:
${composeChart(patient)}

CRITERIA (judge each id against the full dossier; omit those with no evidence):
${criteriaList}

Return the JSON object now.`;
  return { system, user };
}

export function buildNarrative(p: PatientSummary): string {
  const sec = (title: string, items?: string[]) =>
    items?.length ? `${title}:\n` + items.map((i) => `  - ${i}`).join("\n") : `${title}: none recorded`;
  const dem = p.demographics;
  const notes = p.noteExcerpts?.length
    ? "CLINICAL NOTE EXCERPTS:\n" + p.noteExcerpts.map((n) => `  [${n.title}${n.date ? `, ${n.date}` : ""}]\n  ${n.text}`).join("\n\n")
    : "CLINICAL NOTE EXCERPTS: none accessible";
  return [
    `PATIENT: ${dem?.name ?? "unknown"} (${dem?.gender ? dem.gender + ", " : ""}age ${dem?.age ?? "?"}${dem?.birthDate ? `, DOB ${dem.birthDate}` : ""})`,
    sec("ACTIVE PROBLEMS", p.conditions),
    sec("MEDICATIONS", p.medications),
    sec("LABS, VITALS & SOCIAL HISTORY", p.observations),
    sec("PROCEDURES", p.procedures),
    sec("DIAGNOSTIC REPORTS", p.diagnostics),
    sec("ALLERGIES", p.allergies),
    sec("IMMUNIZATIONS", p.immunizations),
    notes,
  ].join("\n\n");
}

function composeChart(p: PatientSummary): string {
  const base = p.narrative?.trim() || buildNarrative(p);
  return p.notes?.trim() ? `${base}\n\nADDITIONAL NOTES:\n${p.notes.trim()}` : base;
}
