// Shared "call brain" + CallSession state used by both the sim and Twilio drivers.
import type { CallStatus, Errand } from "@nova26/shared";
import { cfg } from "../env.js";
import { llm, parseJson } from "../llm.js";
import { answerQuestion, askUser, emit, errands, newId, now, patchErrand } from "../store.js";

export const MAX_TURNS = 20; // hard cap on agent turns per call, then wrap up politely

export type Line = { speaker: "agent" | "callee" | "note"; text: string };
export type TurnOut = { say: string; hangup: boolean; audio?: string | null };
export type CallResult = { callId: string; status: CallStatus; outcome: string; transcript: string };

export type CallSession = {
  id: string;
  errandId: string;
  driver: "sim" | "twilio";
  to: string;
  name: string;
  goal: string;
  context: string;
  lines: Line[];
  status: CallStatus;
  outcome?: string;
  ended: boolean;
  silences: number;
  turns: number; // agent turns taken (capped at MAX_TURNS)
  relays: string[]; // patient-typed messages waiting to be spoken on the call
  wrapNoted?: boolean;
  createdAt: string;
  twilioSid?: string;
  // twilio turn plumbing
  pending?: Promise<TurnOut>;
  pendingDone?: TurnOut;
  filler?: Promise<TurnOut>;
  fillerResolve?: (f: TurnOut) => void;
  fillerPlayed?: boolean;
  waitStart?: number;
  fillerAudio?: Promise<string | null>; // pre-generated hold filler TTS
  pollTimer?: ReturnType<typeof setInterval>;
  // sim serialization
  chain: Promise<unknown>;
  resolve: (r: CallResult) => void;
  done: Promise<CallResult>;
};

export const calls = new Map<string, CallSession>();

export function createSession(errandId: string, a: { to: string; name: string; goal: string; context?: string }, driver: "sim" | "twilio"): CallSession {
  let resolve!: (r: CallResult) => void;
  const done = new Promise<CallResult>((r) => (resolve = r));
  const s: CallSession = {
    id: newId("c_"),
    errandId,
    driver,
    to: a.to,
    name: a.name,
    goal: a.goal,
    context: a.context ?? "",
    lines: [],
    status: "dialing",
    ended: false,
    silences: 0,
    turns: 0,
    relays: [],
    createdAt: now(),
    chain: Promise.resolve(),
    resolve,
    done,
  };
  calls.set(s.id, s);
  return s;
}

export function setStatus(s: CallSession, status: CallStatus) {
  if (s.status === status) return;
  s.status = status;
  emit(s.errandId, { type: "call_status", callId: s.id, to: s.to, status });
}

export function addCallee(s: CallSession, text: string) {
  s.lines.push({ speaker: "callee", text });
  emit(s.errandId, { type: "transcript", callId: s.id, speaker: "callee", text });
}
function addAgent(s: CallSession, text: string) {
  if (!text) return;
  s.lines.push({ speaker: "agent", text });
  emit(s.errandId, { type: "transcript", callId: s.id, speaker: "agent", text });
}

export const transcriptText = (s: CallSession) =>
  s.lines
    .map((l) => (l.speaker === "note" ? `[${l.text}]` : `${l.speaker === "agent" ? "AGENT" : "CALLEE"}: ${l.text}`))
    .join("\n");

type BrainTurn = { say: string; action: "continue" | "ask_user" | "hangup"; question?: string; options?: string[]; outcome?: string; reasoning?: string; cites?: string[] };

const PAYER_RE = /\b(appeal|denied|denial|claim|reconsideration|prior auth|eob|insurer|insurance|member id|aetna|cigna|humana|unitedhealth|anthem|blue cross)\b/i;
/** Is this a patient-advocate call to an insurance payer (appeal a denied claim)? */
export const isPayerCall = (s: CallSession) => PAYER_RE.test(`${s.goal}\n${s.context}\n${s.name}`);

const NAME_RE = /\b(?:member(?:\s+name)?|patient(?:\s+name)?)\s*[:=-]\s*([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){1,2})/;
const MEMBER_FOR_RE = /\bmember\s+([A-Z][a-zA-Z'-]+\s+[A-Z][a-zA-Z'-]+)\b/;
/** Best-effort full name of the person we're calling for (context "Member: X" > errand.onBehalfOf). */
export function memberName(s: CallSession): string {
  const m = s.context.match(NAME_RE) || s.goal.match(NAME_RE) || s.goal.match(MEMBER_FOR_RE) || s.context.match(MEMBER_FOR_RE);
  if (m) return m[1].trim();
  const ob = errands.get(s.errandId)?.onBehalfOf?.trim();
  if (ob) {
    // "my mom, Ruth Alvarez" -> "Ruth Alvarez"
    const proper = ob.match(/([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)+)/);
    return proper ? proper[1] : ob;
  }
  return "the member";
}
export const firstName = (s: CallSession) => {
  const n = memberName(s);
  return n === "the member" ? "The member" : n.split(/\s+/)[0];
};

/** Callee display name without parentheticals/departments: "Aetna (claims appeals)" -> "Aetna". */
export const payerName = (s: CallSession) =>
  s.name
    .replace(/\s*\(.*?\)\s*/g, " ")
    .split(/\s+[-–—|:]\s*|,/)[0]
    .replace(/\s+(member services|claims?|appeals?|customer service|provider services).*$/i, "")
    .trim() || s.name;

const PROVIDER_RE = /\b(NPI|tax ?id|TIN|prior authorization team|provider services|precertification)\b/i;
/** Hospital/provider-side call (verifies with NPI + tax ID) vs. member-side patient-advocate call. */
export const isProviderCall = (s: CallSession) => PROVIDER_RE.test(`${s.goal}\n${s.context}`);

/** Provider org + clinician from context, e.g. "Riverside Health's prior authorization team for Dr. Elena Park". */
export function providerInfo(s: CallSession): { org?: string; doctor?: string } {
  const t = `${s.goal}\n${s.context}`;
  const org =
    t.match(/on behalf of ([A-Z][\w&.' -]{1,60}?)['\u2019]s? prior auth/i)?.[1] ||
    t.match(/\b(?:organization|hospital|health system|facility|practice)\s*[:=-]\s*([A-Z][^\n;,.]{1,60})/i)?.[1];
  const doctor = t.match(/\b(Dr\.?\s+[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)/)?.[1]?.replace(/^Dr\s/, "Dr. ");
  return { org: org?.trim(), doctor: doctor?.trim() };
}

/** Hold filler spoken when the agent checks with its principal (ask_user). Pre-generated at call start. */
export const holdFiller = (s: CallSession) =>
  isProviderCall(s) ? "One moment while I check with my team." : "One moment while I check.";

/** Deterministic one-sentence opening for payer calls (fast; its TTS can be pre-generated while ringing). */
export function payerOpening(s: CallSession): string {
  if (isProviderCall(s)) {
    const { org, doctor } = providerInfo(s);
    const team = org ? `${org}'s prior authorization team` : "the provider's prior authorization team";
    return `Hi, this is an AI assistant calling on behalf of ${team}${doctor ? ` for ${doctor}` : ""}, regarding a prior authorization denial for an ${payerName(s)} member.`;
  }
  return `Hi, this is an AI assistant calling on behalf of ${payerName(s)} member ${memberName(s)}, with their permission, about appealing a denial.`;
}

function payerRules(s: CallSession) {
  const member = memberName(s);
  const first = firstName(s);
  const provider = isProviderCall(s);
  const { org, doctor } = providerInfo(s);
  const role = provider
    ? `PAYER-CALL MODE (PROVIDER SIDE): you represent ${org ?? "the provider"}'s prior authorization team${doctor ? ` for ${doctor}` : ""}, calling ${payerName(s)} provider services about a denial for member ${member}. Speak as the provider's office ("we", "our team", "${doctor ?? "the physician"}").`
    : `PAYER-CALL MODE: you are a patient advocate calling the insurer (${payerName(s)}) for member ${member}, with their permission.`;
  const identity = provider
    ? `- Identity verification: when asked, give ONLY what CONTEXT contains: provider NPI, tax ID, provider/practice name, then member name, date of birth, member ID, and the PA/case or claim number. Read digits clearly, grouped.`
    : `- Identity: when asked, give ONLY what CONTEXT contains (name, date of birth, member ID, claim number). Read IDs and numbers clearly.`;
  const askUser = provider
    ? `- NEVER invent facts (dates, IDs, results, policy text, numbers) that are not in CONTEXT. If the rep asks for something not in CONTEXT, wants a peer-to-peer, or asks for a decision you can't make, use action "ask_user" with a clear question for the supervisor on our team (e.g. "The rep is asking for the date of the last colonoscopy. Do we have it?"); "say" is exactly "One moment while I check with my team."
- [TEAM RELAY: ...] lines are messages from your supervisor for you to pass on NOW. Convey the content naturally in your very next "say", in first-person plural or attributed to a colleague (e.g. "My colleague confirms we can fax the GI note today."). Never say "X says:". Then continue toward the goal.`
    : `- NEVER invent facts (dates, IDs, results, policy text, numbers) that are not in CONTEXT. If the rep asks for something not in CONTEXT, or insists on speaking with the member directly, use action "ask_user" with a clear question for ${first} (e.g. "The rep wants to speak with you directly. Can you join, or should I ask them to use the authorization on file?"); "say" is a brief filler like "One moment, let me check with ${first}."
- Transcript lines like AGENT: ${first} says: "..." are the member's own words, already spoken aloud by you. Don't repeat them; your "say" is a brief natural follow-up (or "" if nothing to add).`;
  const chartEx = provider ? "The patient's" : `${first}'s`;
  return `

${role}
- Never use gendered pronouns (he/she/his/her/him) for the member. Say "${first}", "the member", or ${provider ? '"the patient"' : '"my client"'}.
${identity}
- Don't assume what was denied: it may be a pre-service prior-authorization request or a post-service claim line. Use CONTEXT's terms. When relevant, state it concisely: the drug/service and code, the date (request or service date) and amount if CONTEXT gives them, any reference/case number, and the denial reason.
- Request an appeal / reconsideration of that denial. If CONTEXT says expedited/urgent, explicitly ask for an EXPEDITED appeal and give the clinical reason for urgency from CONTEXT.
- When the rep pushes back (e.g. "no documentation of failed therapy", "not medically necessary"), answer with the SPECIFIC chart evidence AND the policy section from CONTEXT, briefly and naturally, e.g. "${chartEx} chart documents an inadequate response to prednisone and azathioprine, per the GI note from May 1st, which meets the step-therapy criterion in section 2 of your policy." Use the real drugs, dates and section from CONTEXT, never this example's.
- Get: an appeal reference number, the decision timeline, and where/how to send any written appeal or records (fax, address, or portal) if needed.
- As soon as the rep has given the appeal reference number AND the timeline: in ONE turn, read the reference number back to confirm, thank them, say goodbye, and use action "hangup" with an "outcome" summarizing the reference number, timeline, and next steps (fax/address/what to send, or "submission destination not yet confirmed"). This takes priority over any other open question: do NOT ask anything further (not even a fax number) once you have the reference number and timeline.
${askUser}
- At most 2 short sentences per utterance, and never more than about 30 words; say one point per turn.`;
}

function systemPrompt(s: CallSession, e: Errand | undefined) {
  const who = e?.onBehalfOf || "the user";
  return `You are an AI assistant on a live phone call, calling ${s.name} on behalf of ${who}.
GOAL OF THIS CALL: ${s.goal}
CONTEXT: ${s.context || "(none)"}
ERRAND: ${e?.summary || e?.objective || ""}
CONSTRAINTS: ${(e?.constraints ?? []).map((c) => `${c.kind}: ${c.text}`).join("; ") || "(none)"}
APPROVAL RULES (must check with the user before any of these): ${(e?.approvalRules ?? []).join("; ") || "(none)"}

Rules:
- Your opening line MUST disclose you are an AI, in ONE sentence: "Hi, this is an AI assistant calling on behalf of ${who}..." with the reason; then stop and wait.
- Speak like a polite, efficient human caller. 1-2 short sentences per turn (under ~30 words). No lists, no markdown, no emojis.
- Never pay or give card numbers, SSN or passwords. Share identifying info (DOB, member ID) only if CONTEXT provides it for this call and only when asked. If asked for payment, say the user will follow up.
- When you need the user's decision (choosing between options the callee offered, anything outside the constraints, anything an approval rule gates, a price over budget), use action "ask_user": "say" is a brief filler like "One moment while I check." and "question" is a concise question for the user (add "options" if the callee gave choices).
- Lines like [USER ANSWERED ...] are the user's private answers to you; act on them.
- A [TURN LIMIT ...] line means wrap up now: get any missing reference number, thank them, and hang up.
- When the goal is achieved or clearly impossible, say a brief thank-you/goodbye and use action "hangup" with "outcome": a 1-2 sentence factual summary of what was agreed (reference numbers, timelines, where to send documents, names, times, prices).
- If the callee hung up, use "hangup" with say "" and an outcome.${isPayerCall(s) ? payerRules(s) : ""}

Respond ONLY with strict JSON: {"reasoning": string, "cites"?: string[], "say": string, "action": "continue"|"ask_user"|"hangup", "question"?: string, "options"?: string[], "outcome"?: string}
"reasoning" (never spoken; shown to your supervisor): 1-2 short sentences on what the rep just asked or claimed and why your reply answers it, e.g. "Rep claims no failed conventional therapy. Rebut with the dated prednisone + azathioprine failure from the 2026-05-01 GI note, which satisfies the step-therapy criterion." "cites": short labels for the evidence or policy sections you use this turn (e.g. ["GI note 2026-05-01", "CPB 0341 §2(b)", "NPI"]); omit if none.`;
}

async function brain(s: CallSession): Promise<BrainTurn> {
  const e = errands.get(s.errandId);
  if (!s.lines.some((l) => l.speaker !== "note") && isPayerCall(s)) return { say: payerOpening(s), action: "continue" };
  const user = s.lines.length
    ? `Transcript so far:\n${transcriptText(s)}\n\nGive your next turn as JSON.`
    : "The callee just picked up. Give your one-sentence opening line as JSON.";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await llm().chat.completions.create({
        model: cfg().callModel,
        messages: [
          { role: "system", content: systemPrompt(s, e) },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
        // 400 was hit (finish_reason=length) mid-JSON on Gemini, producing "Sorry, could you repeat that?".
        max_tokens: 1500,
        // OpenRouter unified reasoning control: keep thinking short (latency) and out of the content.
        reasoning: { effort: "low", exclude: true },
      } as any);
      const msg = (r as any).choices?.[0];
      const j = parseJson<BrainTurn>(msg?.message?.content);
      if (j && typeof j.say === "string" && ["continue", "ask_user", "hangup"].includes(j.action)) return j;
      // Truncated / unparseable -> loop retries once before falling back.
      console.warn(`[brain] unparseable turn (attempt ${attempt + 1}):`, msg?.finish_reason, msg?.message?.content?.slice(0, 500));
    } catch (err) {
      console.warn("[brain] error", (err as Error).message);
      if (attempt === 1) throw err;
    }
  }
  return { say: "Sorry, could you repeat that?", action: "continue" };
}

/**
 * Run one agent turn: brain -> (maybe ask the user, mid-call) -> final utterance.
 * onFiller is called with the hold filler text when the brain needs the user.
 */
export async function agentStep(s: CallSession, onFiller?: (text: string) => string | void): Promise<TurnOut> {
  s.turns++;
  if (s.turns > MAX_TURNS) {
    const relayed = drainRelays(s);
    const bye = "I've taken a lot of your time, so I'll follow up in writing. Thank you for your help, goodbye.";
    addAgent(s, bye);
    s.lines.push({ speaker: "note", text: `turn limit (${MAX_TURNS}) reached; agent wrapped up` });
    return { say: join(relayed, bye), hangup: true };
  }
  if (s.turns >= MAX_TURNS - 2 && !s.wrapNoted) {
    s.wrapNoted = true;
    s.lines.push({ speaker: "note", text: "TURN LIMIT NEAR: wrap up this call within the next turn or two" });
  }
  let relayed = "";
  for (let i = 0; i < 4; i++) {
    relayed = join(relayed, drainRelays(s));
    const t = await brain(s);
    if (t.reasoning) emit(s.errandId, { type: "reasoning", callId: s.id, text: t.reasoning, ...(t.cites?.length ? { cites: t.cites.slice(0, 6).map(String) } : {}) });
    if (t.action === "ask_user" && i < 3) {
      const filler = t.say || "One moment while I check.";
      addAgent(s, onFiller?.(filler) || filler);
      setStatus(s, "on_hold_for_user");
      const q = t.question || "How should I respond?";
      emit(s.errandId, { type: "log", text: `On the call with ${s.name}, checking with you: ${q}` });
      const answer = await askUser(s.errandId, q, t.options);
      s.lines.push({ speaker: "note", text: `USER ANSWERED "${q}": ${answer}` });
      if (!s.ended) setStatus(s, "in_progress");
      if (errands.get(s.errandId)?.status === "needs_input") patchErrand(s.errandId, { status: "running" });
      // Whatever was spoken before the hold already played (with the filler); start the post-hold utterance fresh.
      relayed = "";
      continue;
    }
    // A relay typed while the brain was thinking: speak it too (before the brain's line).
    relayed = join(relayed, drainRelays(s));
    addAgent(s, t.say);
    if (t.action === "hangup") {
      s.outcome = t.outcome || s.outcome;
      return { say: join(relayed, t.say), hangup: true };
    }
    return { say: join(relayed, t.say), hangup: false };
  }
  return { say: join(relayed, "Thanks so much, goodbye."), hangup: true };
}

/** Speak any queued patient relays, attributed and verbatim. Returns the text to say. */
function drainRelays(s: CallSession): string {
  const out: string[] = [];
  while (s.relays.length) {
    const text = s.relays.shift()!.trim().replace(/^["']+|["']+$/g, "");
    if (!text) continue;
    if (isProviderCall(s)) {
      // Supervisor relay: the brain conveys it naturally in its very next line (see payerRules).
      s.lines.push({ speaker: "note", text: `TEAM RELAY: ${text}` });
      continue;
    }
    const line = `${firstName(s)} says: "${text}"`;
    addAgent(s, line);
    out.push(line);
  }
  return out.join(" ");
}

/**
 * Queue a patient message to be spoken on the call at the agent's next speaking opportunity.
 * If the agent is on hold waiting for the user (ask_user), the relay also resolves that question.
 */
export function queueRelay(s: CallSession, text: string): { resolvedHold: boolean } {
  s.relays.push(text);
  emit(s.errandId, { type: "log", text: `Relaying your message on the call: "${text}"` });
  let resolvedHold = false;
  if (s.status === "on_hold_for_user" && errands.get(s.errandId)?.pendingQuestion) {
    resolvedHold = answerQuestion(s.errandId, undefined, `(relayed directly to the rep) ${text}`);
  }
  return { resolvedHold };
}

const join = (...parts: string[]) => parts.filter((p) => p && p.trim()).join(" ");

/** Speech-recognition hints for this call: names, payer, codes and drug terms from the call context. */
export function speechHints(s: CallSession): string {
  const text = `${s.goal}\n${s.context}`;
  const set = new Set<string>();
  const add = (w?: string) => {
    const t = w?.trim().replace(/[.,;:]+$/, "");
    if (t && t.length > 1 && t.length <= 60 && !t.includes(",")) set.add(t);
  };
  const member = memberName(s);
  if (member !== "the member") {
    add(member);
    member.split(/\s+/).forEach(add);
  }
  add(payerName(s));
  const prov = providerInfo(s);
  add(prov.org);
  add(prov.doctor?.replace(/^Dr\.?\s+/, ""));
  ["NPI", "tax ID", "provider services", "peer to peer", "expedited"].forEach(add);
  // Billing / drug codes (J1745, 99213, CPT/HCPCS), IDs like W123456789, ICD-10 like K50.90.
  for (const m of text.matchAll(/\b(?:[A-Z]\d{4}|\d{5}|[A-Z]{1,3}\d{6,12}|[A-Z]\d{2}\.\d{1,2})\b/g)) add(m[0]);
  // Drug names: generics (-mab, -nib, -prine, -sone, -olone, -ate...) and capitalized brand-ish words.
  for (const m of text.matchAll(/\b[a-z]{4,}(?:mab|nib|cept|prine|sone|olone|zumab|ximab|kinumab|trexate|limus)\b/gi)) add(m[0].toLowerCase());
  for (const m of text.matchAll(/\b[A-Z][a-z]{3,}(?:'s)?\b/g)) if (!COMMON.has(m[0])) add(m[0]);
  [
    "appeal", "reconsideration", "peer to peer", "reference number", "member ID", "date of birth", "claim number",
    "date of service", "medical necessity", "step therapy", "prior authorization", "denied", "Crohn's",
    "zero", "oh", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  ].forEach(add);
  return [...set].slice(0, 90).join(", ");
}
const COMMON = new Set([
  "This", "That", "The", "They", "Their", "There", "Then", "When", "What", "With", "From", "Call", "Calling", "Please",
  "Member", "Patient", "Name", "Date", "Note", "Notes", "Goal", "Context", "Policy", "Section", "Claim", "Line", "Code",
  "Denial", "Reason", "Chart", "Evidence", "Criterion", "Criteria", "Status", "Amount", "Billed", "Allowed", "Plan",
  "January", "February", "March", "April", "June", "July", "August", "September", "October", "November", "December",
  "Payer", "Urgency", "Urgent", "Expedited", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Appeal", "Request", "Ask", "Your",
]);

async function summarize(s: CallSession): Promise<string> {
  if (!s.lines.length) return `Call ended (${s.status}) before any conversation.`;
  try {
    const r = await llm().chat.completions.create({
      model: cfg().callModel,
      messages: [
        { role: "system", content: "Summarize the outcome of this phone call in 1-2 factual sentences (what was agreed, times, prices). Plain text." },
        { role: "user", content: `Goal: ${s.goal}\n\n${transcriptText(s)}` },
      ],
      max_tokens: 200,
    });
    return r.choices[0]?.message?.content?.trim() || "Call ended.";
  } catch {
    return "Call ended (summary unavailable).";
  }
}

export async function finalize(s: CallSession, status: CallStatus = "completed") {
  if (s.ended) return;
  s.ended = true;
  setStatus(s, status);
  const outcome = s.outcome || (await summarize(s));
  s.outcome = outcome;
  s.resolve({ callId: s.id, status, outcome, transcript: transcriptText(s) });
}
