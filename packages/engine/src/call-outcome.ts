// Turn a finished payer-call transcript into a structured outcome: what the call secured
// (appeal opened, reference number, deadline, where to send the written appeal, peer-to-peer)
// and who does what next. Only facts stated in the transcript are recorded.
import type { CaseOutcome, NextAction, OutcomeItem } from "@nova26/shared";
import { engineClient, engineModel } from "./client.js";

export async function extractCaseOutcome(input: {
  transcript: string;
  payer: string;
  physician: string;
  denialRef: string;
  today: string;
}): Promise<CaseOutcome> {
  const system =
    "You record the outcome of a phone call a hospital's prior-authorization agent made to a payer about a denial. " +
    "Phone calls do not decide the denial; they open the case. Extract ONLY what the transcript states - never invent numbers, names, dates or times. " +
    "Use null for anything not stated. Respond ONLY with JSON: " +
    '{"summary":"<max 25 words: what the call secured; note the written appeal and peer-to-peer decide it>",' +
    '"appealType":"Expedited appeal"|"Reconsideration"|"Standard appeal"|null,' +
    '"referenceNumber":string|null,"decisionDue":string|null,"submitTo":"<fax/portal for the written appeal>"|null,' +
    '"peerToPeer":"<short: day, time, with whom>"|null,"repName":string|null}. Keep every value short (under 12 words); submitTo is just the number or portal, without the word fax.';
  const user = `PAYER: ${input.payer}
ORIGINAL DENIAL: ${input.denialRef}
ORDERING PHYSICIAN: ${input.physician}
TODAY: ${input.today}

TRANSCRIPT:
${input.transcript}

Return the JSON now.`;

  let j: Record<string, unknown> = {};
  try {
    const res = await engineClient().chat.completions.create({
      model: engineModel(),
      max_tokens: 800,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const raw = res.choices[0]?.message?.content ?? "{}";
    j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? raw);
  } catch {
    j = {};
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const appealType = str(j.appealType);
  const referenceNumber = str(j.referenceNumber);
  const decisionDue = str(j.decisionDue);
  const submitTo = str(j.submitTo);
  const peerToPeer = str(j.peerToPeer);
  const repName = str(j.repName);

  const it = (label: string, value: string | null, fallback = "Not obtained on the call"): OutcomeItem =>
    ({ label, value: value ?? fallback, status: value ? "secured" : "not_obtained" });
  const items: OutcomeItem[] = [
    it("Appeal opened", appealType),
    it("Reference number", referenceNumber),
    it("Decision deadline", decisionDue),
    it("Where to send the written appeal", submitTo),
    it("Peer-to-peer booked", peerToPeer, "Not booked"),
  ];

  const nextActions: NextAction[] = [
    { owner: "nova26 agent", action: `Fax the cited appeal letter and GI note${submitTo ? ` to ${submitTo.replace(/^fax[:\s]*/i, "")}` : ""}${referenceNumber ? `, referencing ${referenceNumber}` : ""}`, due: "Today" },
    peerToPeer
      ? { owner: "Dr. Park", action: `Peer-to-peer with ${input.payer}'s medical director (one-page brief ready)`, due: peerToPeer }
      : { owner: "Supervisor", action: `Request a peer-to-peer for Dr. Park with ${input.payer}'s medical director` },
    { owner: "nova26 agent", action: `Check appeal status with ${input.payer}${referenceNumber ? ` (${referenceNumber})` : ""}`, due: decisionDue ?? "In 48 hours" },
    { owner: input.payer, action: "Decide the appeal on the written record and the peer-to-peer", due: decisionDue ?? undefined },
  ];
  if (!referenceNumber) nextActions.unshift({ owner: "Supervisor", action: `Call ${input.payer} back to obtain an appeal reference number` });

  const summary =
    str(j.summary) ??
    (referenceNumber
      ? `${input.payer} opened ${appealType ? appealType.toLowerCase() : "an appeal"} ${referenceNumber}${decisionDue ? `, decision due ${decisionDue}` : ""}; the written appeal and peer-to-peer decide it.`
      : `The call ended without an appeal reference number; follow up with ${input.payer}.`);

  return { summary, appealType, referenceNumber, decisionDue, submitTo, peerToPeer, repName, items, nextActions, extractedAt: new Date().toISOString() };
}
