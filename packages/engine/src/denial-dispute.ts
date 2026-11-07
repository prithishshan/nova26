// Map a payer's stated denial reason onto the compiled policy's criteria, then test each claim
// against the chart. Claims with no matching criterion are kept (and flagged) rather than dropped,
// so the supervisor can see when the payer's reason isn't in its own compiled policy.
import { engineClient, engineModel } from "./client.js";

export type DisputeCriterion = { id: string; label: string; quote: string; status: string; evidence: string };
export type MappedClaim = {
  aetnaClaim: string;
  criterionId: string | null; // null → no criterion in the compiled policy covers this claim
  chartStatus: "met" | "unmet" | "unknown";
  chartEvidence: string;
};

export async function mapDenialReason(input: {
  payer: string;
  reasonText: string;
  criteria: DisputeCriterion[];
  chartNarrative: string;
}): Promise<MappedClaim[]> {
  const list = input.criteria.map((c) => `- id=${c.id} | ${c.label} | policy: "${c.quote.slice(0, 220)}"`).join("\n");
  const system =
    "You analyze a health insurer's prior-authorization denial for a hospital's denials team. " +
    "1) Split the denial reason into the specific requirement(s) the payer says were NOT met (usually one or two). " +
    "State each as the REQUIREMENT itself, positively and briefly (max ~14 words), e.g. 'Inadequate response or intolerance to conventional therapy (corticosteroids, immunomodulators)' - not as the payer's negative sentence. " +
    "2) For each, pick the criterion id from the list that genuinely covers the same requirement; use null if none does (do not force a match). " +
    "3) Judge the requirement against the PATIENT CHART only: 'met' if the chart documents it, 'unmet' if the chart contradicts it, 'unknown' if the chart is silent. " +
    "chartEvidence must quote or closely paraphrase the specific dated chart facts (drug, dose, dates, outcome, note title/date). Never invent facts. " +
    'Respond ONLY with JSON: {"claims":[{"aetnaClaim":"<the requirement, stated positively>","criterionId":"<id>"|null,"chartStatus":"met"|"unmet"|"unknown","chartEvidence":"<dated facts>"}]}';
  const user = `PAYER: ${input.payer}
DENIAL REASON (verbatim): "${input.reasonText}"

COMPILED POLICY CRITERIA IN SCOPE:
${list}

PATIENT CHART:
${input.chartNarrative}

Return the JSON now.`;

  const res = await engineClient().chat.completions.create({
    model: engineModel(),
    max_tokens: 1500,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const raw = res.choices[0]?.message?.content ?? "{}";
  const m = raw.match(/\{[\s\S]*\}/);
  let parsed: { claims?: unknown[] } = {};
  try {
    parsed = JSON.parse(m ? m[0] : raw);
  } catch {
    parsed = {};
  }
  const ids = new Set(input.criteria.map((c) => c.id));
  return (Array.isArray(parsed.claims) ? parsed.claims : [])
    .map((x) => x as Record<string, unknown>)
    .filter((x) => typeof x.aetnaClaim === "string" && x.aetnaClaim.trim())
    .slice(0, 3)
    .map((x) => {
      const cid = typeof x.criterionId === "string" && ids.has(x.criterionId) ? x.criterionId : null;
      const st = x.chartStatus === "met" || x.chartStatus === "unmet" ? x.chartStatus : "unknown";
      return { aetnaClaim: String(x.aetnaClaim).trim(), criterionId: cid, chartStatus: st, chartEvidence: String(x.chartEvidence ?? "").trim() };
    });
}
