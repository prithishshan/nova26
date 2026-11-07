// Patient-side appeal letter (adapted from azure_hackathon src/lib/pa-justification.ts).
// First person from the member to the payer's appeals department. Documentation-only
// guardrail: cites ONLY the evaluated chart evidence + the policy's own language.
import { engineClient, engineModel } from "./client.js";
import type { Status } from "./policies.js";
import { evidenceBlock, type EvidenceItem } from "./citations.js";

export type AppealInput = {
  member: { name: string; dob: string; memberId: string; plan: string };
  payer: string;
  policy: { policyId: string; title: string; sourceUrl?: string | null };
  indication?: string | null;
  claim: { dateOfService: string; provider: string; code: string; description: string; billed: number; denialCode?: string; denialReason?: string };
  denialContext?: string; // why it was denied / why it is being appealed (facts only)
  criteria: { label: string; status: Status; evidence?: string; policyQuote?: string; sectionPath?: string }[];
};

export async function generateAppealLetter(input: AppealInput): Promise<string> {
  const fmt = (c: AppealInput["criteria"][number]) =>
    `- ${c.label}\n    chart evidence: ${c.evidence || "(none)"}\n    policy text: "${c.policyQuote ?? ""}" [${c.sectionPath ?? ""}]`;
  const met = input.criteria.filter((c) => c.status === "met");
  const unmet = input.criteria.filter((c) => c.status === "unmet");
  const unknown = input.criteria.filter((c) => c.status === "unknown");

  const system = [
    "You write a member's first-level internal appeal letter to a health insurer's appeals department, in the FIRST PERSON",
    "from the member (who may note that an authorized representative is assisting). Plain, firm, courteous. Structure: a date",
    "line placeholder; addressed to the payer's Appeals Department; a RE line with member name, member ID, date of service,",
    "provider, procedure/drug code, and denial code; a short statement that the member requests reconsideration of that",
    "specific claim line; then for EACH satisfied criterion a short bullet that quotes the payer's own policy language (with",
    "the policy number and section) and states the chart evidence that satisfies it; a closing request to overturn the denial",
    "and reprocess the claim line, plus a request for the specific clinical criteria and reviewer credentials used if the",
    "denial is upheld; and a signature block with the member's name.",
    "GUARDRAIL: use ONLY the evidence provided. ABSOLUTELY DO NOT invent clinical facts, dates, results, diagnoses, or",
    "physician statements. Never claim an undocumented or unmet criterion is satisfied. Avoid gendered pronouns: use 'I',",
    "'my', or the member's name. Criteria whose evidence begins with 'Not applicable' may be grouped in one brief bullet.",
    "If DENIAL CONTEXT is given, explain it briefly and factually near the top (e.g. documentation that was not included with the",
    "original claim and is now cited/attached), without adding details beyond it.",
    "Output the letter as plain text only (no markdown, no JSON).",
  ].join(" ");

  const c = input.claim;
  const user = `LETTER DATE: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} (use this exact date; never write a [Date] placeholder)
PAYER: ${input.payer}
POLICY: ${input.policy.title} (${input.payer} Clinical Policy Bulletin ${input.policy.policyId})${input.policy.sourceUrl ? ` - ${input.policy.sourceUrl}` : ""}
${input.indication ? `INDICATION: ${input.indication}\n` : ""}MEMBER: ${input.member.name}, DOB ${input.member.dob}, Member ID ${input.member.memberId}, plan ${input.member.plan}
CLAIM LINE: DOS ${c.dateOfService}, provider ${c.provider}, ${c.code} ${c.description}, billed $${c.billed.toFixed(2)}${c.denialCode ? `, denied CARC ${c.denialCode}` : ""}${c.denialReason ? ` ("${c.denialReason}")` : ""}

${input.denialContext ? `DENIAL CONTEXT: ${input.denialContext}

` : ""}SATISFIED CRITERIA (documented in chart):
${met.map(fmt).join("\n") || "(none)"}

NOT MET (chart contradicts; do not claim these):
${unmet.map(fmt).join("\n") || "(none)"}

UNDOCUMENTED (do not assert):
${unknown.map((x) => `- ${x.label}`).join("\n") || "(none)"}

Write the letter now.`;

  const res = await engineClient().chat.completions.create({
    model: engineModel(),
    max_tokens: 2500,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return (res.choices[0]?.message?.content ?? "").trim();
}

// ---- Pre-service: provider EXPEDITED appeal / reconsideration of a PA denial ----
export type PaAppealInput = {
  member: { name: string; dob: string; memberId: string; plan: string };
  payer: string;
  policy: { policyId: string; title: string; sourceUrl?: string | null };
  indication?: string | null;
  denial: { date: string; referenceNumber: string; service: string; code: string; decision: string; reason: string; requestedBy: string };
  urgency: string; // documented clinical urgency (facts from the chart only)
  rebuttalEvidence?: string; // chart facts that directly answer the stated denial reason
  from: { name: string; specialty: string; org: string; npi: string; taxId: string; team: string }; // ordering provider / org
  criteria: { label: string; status: Status; evidence?: string; policyQuote?: string; sectionPath?: string }[]; // applicable only
  evidence?: EvidenceItem[]; // numbered evidence; when present the letter cites it with [n] markers
};

export async function generateExpeditedPaAppeal(input: PaAppealInput): Promise<string> {
  const fmt = (c: PaAppealInput["criteria"][number]) =>
    `- ${c.label}
    chart evidence: ${c.evidence || "(none)"}
    policy text: "${c.policyQuote ?? ""}" [${c.sectionPath ?? ""}]`;
  const met = input.criteria.filter((c) => c.status === "met");
  const notMet = input.criteria.filter((c) => c.status !== "met");
  const system = [
    "You write an ordering provider's EXPEDITED appeal / request for reconsideration of a health insurer's prior-authorization",
    "(precertification) denial, on behalf of the member, from the physician and the health system's prior authorization team,",
    "addressed to the insurer's Appeals / Precertification Department. Professional, concise, clinical. Structure: date placeholder;",
    "a RE line with 'EXPEDITED APPEAL - Request for Reconsideration of Prior Authorization Denial', member name, DOB, member ID,",
    "PA reference number, service and code, denial date, ordering provider with NPI and practice tax ID; one paragraph requesting",
    "expedited reconsideration on the member's behalf and quoting the stated denial reason; one paragraph on clinical urgency using",
    "ONLY the urgency facts given (why a standard timeframe could seriously jeopardize the member's health); a bullet for EACH",
    "satisfied criterion quoting the key phrase of the payer's policy language (policy number + section) and the chart evidence",
    "with dates; a paragraph directly rebutting the stated denial reason with the specific chart evidence; a request for an",
    "expedited decision within 72 hours and approval as prescribed; an offer of a peer-to-peer review with the ordering physician",
    "(contact via the prior authorization team); a request for the specific criteria and reviewer credentials if upheld; and a",
    "signature block for the ordering physician and the health system's prior authorization team.",
    "GUARDRAIL: use ONLY the evidence provided. DO NOT invent clinical facts, dates, results, diagnoses or physician statements.",
    "Never claim an unsatisfied criterion is met. Refer to the patient as 'the member', 'the patient', or by name; never use",
    "gendered pronouns or honorifics (no Mr./Ms./Mrs.) for the patient (use 'they' or the full name). Use REBUTTAL EVIDENCE to answer the denial reason.",
    "Never add internal notes, placeholders other than the date, or commentary. Keep it under ~650 words. Plain text only (no markdown, no JSON).",
    ...(input.evidence?.length
      ? [
          "CITATIONS (mandatory): a NUMBERED EVIDENCE list is provided. Put an inline marker like [3] immediately after EVERY",
          "clinical or policy claim (dates, results, medications, doses, prescriber, policy quotes, urgency facts), using ONLY",
          "numbers from that list (e.g. '... flared on taper [2].' or '[4][9]'). Never invent a number. Do not add a reference",
          "list at the end; the markers alone are enough. Header/identity lines (member ID, NPI) need no marker.",
        ]
      : []),
  ].join(" ");
  const d = input.denial;
  const user = `LETTER DATE: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} (use this exact date; never write a [Date] placeholder)
PAYER: ${input.payer}
POLICY: ${input.policy.title} (${input.payer} Clinical Policy Bulletin ${input.policy.policyId})${input.policy.sourceUrl ? ` - ${input.policy.sourceUrl}` : ""}
${input.indication ? `INDICATION: ${input.indication}\n` : ""}MEMBER: ${input.member.name}, DOB ${input.member.dob}, Member ID ${input.member.memberId}, plan ${input.member.plan}
DENIAL: letter dated ${d.date}, PA reference ${d.referenceNumber}; service ${d.service} (${d.code}); requested by ${d.requestedBy}
DECISION: ${d.decision}
STATED REASON: "${d.reason}"
CLINICAL URGENCY (facts from chart): ${input.urgency}
REBUTTAL EVIDENCE (chart facts answering the denial reason): ${input.rebuttalEvidence ?? "(see criteria)"}
FROM: ${input.from.name} (${input.from.specialty}), NPI ${input.from.npi}; ${input.from.org} ${input.from.team}, tax ID ${input.from.taxId}

SATISFIED CRITERIA (documented in chart):
${met.map(fmt).join("\n") || "(none)"}

NOT SATISFIED / UNDOCUMENTED (do not assert):
${notMet.map((x) => `- ${x.label}`).join("\n") || "(none)"}
${input.evidence?.length ? `\nNUMBERED EVIDENCE (cite ONLY these numbers, inline, after each claim):\n${evidenceBlock(input.evidence)}\n` : ""}
Write the letter now.`;
  const res = await engineClient().chat.completions.create({
    model: engineModel(),
    max_tokens: 5000,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return (res.choices[0]?.message?.content ?? "").trim();
}
