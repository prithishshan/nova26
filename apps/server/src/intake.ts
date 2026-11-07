import type { ChatMessage, Errand } from "@nova26/shared";
import { Constraint, Contact } from "@nova26/shared";
import { cfg } from "./env.js";
import { llm, normalizePhone, parseJson } from "./llm.js";
import { chats, errands, newErrand, now, patchErrand } from "./store.js";

const TOOL = {
  type: "function" as const,
  function: {
    name: "update_errand",
    description: "Return your chat reply plus the full, updated errand fields.",
    parameters: {
      type: "object",
      properties: {
        reply: { type: "string", description: "Your chat reply to the user (short, friendly)." },
        objective: { type: "string", description: "The goal in the user's words." },
        summary: { type: "string", description: "One-line restatement of the errand." },
        constraints: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["time", "budget", "location", "preference", "must", "must_not", "other"] },
              text: { type: "string" },
            },
            required: ["kind", "text"],
          },
        },
        onBehalfOf: { type: "string", description: "Whose errand this is (name), if known." },
        contacts: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, phone: { type: "string" }, url: { type: "string" }, role: { type: "string" } },
            required: ["name"],
          },
        },
        approvalRules: { type: "array", items: { type: "string" } },
        missingInfo: { type: "array", items: { type: "string" }, description: "Essentials still missing (empty if ready)." },
        ready: { type: "boolean", description: "True when the objective is clear enough to act on." },
      },
      required: ["reply", "objective", "constraints", "contacts", "approvalRules", "missingInfo", "ready"],
    },
  },
};

const SYSTEM = `You are the intake assistant for nova26, an agent that runs errands for people: it researches on the web and makes phone calls on their behalf.
Turn the conversation into a structured errand. Each message refines it; keep everything already known unless the user changes it.
- Put times, budgets, locations, preferences, musts and must-nots into constraints.
- Extract any businesses/people to contact (with phone numbers or URLs if given). If no number is given that's OK: the agent can look it up on the web.
- approvalRules: things the user wants to approve first ("check with me before paying"). Always include "Never share payment card details or sensitive personal info" implicitly; don't list it unless the user says something related.
- Ask at most 1-2 clarifying questions, and ONLY for genuinely missing essentials that the agent can't figure out itself. Otherwise tell the user it's ready and summarize the plan in one sentence.
- ready=true when the objective is clear enough to act.
Always respond by calling update_errand.`;

export async function intake(errandId: string | undefined, message: string) {
  let errand: Errand = (errandId && errands.get(errandId)) || newErrand(message);
  const msgs = chats.get(errand.id)!;
  msgs.push({ role: "user", text: message, at: now() });

  const current = {
    objective: errand.objective,
    summary: errand.summary,
    constraints: errand.constraints,
    onBehalfOf: errand.onBehalfOf,
    contacts: errand.contacts,
    approvalRules: errand.approvalRules,
    missingInfo: errand.missingInfo,
  };
  // Note: Claude on OpenRouter rejects forced tool_choice, so we use "auto" and nudge once if needed.
  const base: any[] = [
    { role: "system", content: `${SYSTEM}

Today is ${new Date().toDateString()}.
Current errand state:
${JSON.stringify(current)}` },
    ...msgs.map((m: ChatMessage) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.text })),
  ];
  let args: any = null;
  let msg: any = null;
  for (let attempt = 0; attempt < 2 && !args; attempt++) {
    const r = await llm().chat.completions.create({
      model: cfg().plannerModel,
      messages: attempt === 0 ? base : [...base, { role: "user", content: "(system: respond by calling update_errand now)" }],
      tools: [TOOL],
      tool_choice: "auto",
      max_tokens: 1500,
    });
    msg = r.choices[0]?.message;
    args = parseJson<any>(msg?.tool_calls?.[0]?.function?.arguments) ?? parseJson<any>(msg?.content);
  }
  args = args ?? {};

  const constraints = (Array.isArray(args.constraints) ? args.constraints : [])
    .map((c: unknown) => Constraint.safeParse(c))
    .filter((p: any) => p.success)
    .map((p: any) => p.data);
  const contacts = (Array.isArray(args.contacts) ? args.contacts : [])
    .map((c: any) => Contact.safeParse({ ...c, phone: normalizePhone(c?.phone) }))
    .filter((p: any) => p.success)
    .map((p: any) => p.data);
  const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

  const reply: string = typeof args.reply === "string" && args.reply ? args.reply : msg?.content || "Got it.";
  const canChangeStatus = errand.status === "draft" || errand.status === "ready";
  errand = patchErrand(errand.id, {
    objective: args.objective || errand.objective,
    summary: args.summary || errand.summary,
    constraints,
    onBehalfOf: args.onBehalfOf || errand.onBehalfOf,
    contacts,
    approvalRules: strArr(args.approvalRules),
    missingInfo: strArr(args.missingInfo),
    ...(canChangeStatus ? { status: args.ready ? "ready" : "draft" } : {}),
  });
  msgs.push({ role: "agent", text: reply, at: now() });
  return { errand, messages: msgs, reply };
}
