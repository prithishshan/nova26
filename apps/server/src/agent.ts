// The errand runner: a tool-calling loop over web research, phone calls and user questions.
import type OpenAI from "openai";
import type { PlanStep } from "@nova26/shared";
import { cfg } from "./env.js";
import { llm, parseJson } from "./llm.js";
import { askUser, emit, errands, newId, patchErrand } from "./store.js";
import { fetchPage, webSearch } from "./web.js";
import { placeCall } from "./calls/index.js";

const MAX_ITERS = 25;
const running = new Set<string>();
const callsPlaced = new Map<string, number>(); // errandId -> calls placed this run

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({
  type: "function" as const,
  function: { name, description, parameters: { type: "object", properties, required } },
});

const TOOLS = [
  fn("set_plan", "Set or update the step-by-step plan shown to the user. Call first, and again when steps change status.", {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["web", "call", "ask_user", "note"] },
          description: { type: "string" },
          status: { type: "string", enum: ["pending", "running", "done", "failed", "skipped"] },
        },
        required: ["kind", "description", "status"],
      },
    },
  }, ["steps"]),
  fn("web_search", "Search the web. Returns top results {title,url,snippet}.", { query: { type: "string" } }, ["query"]),
  fn("fetch_page", "Fetch a web page as text/markdown (truncated to ~8k chars).", { url: { type: "string" } }, ["url"]),
  fn("place_call", "Place a phone call; a voice agent handles the conversation toward the goal. Blocks until the call ends and returns {outcome, transcript}.", {
    to: { type: "string", description: "Phone number" },
    name: { type: "string", description: "Who you're calling (business/person)" },
    goal: { type: "string", description: "What the call must accomplish" },
    context: { type: "string", description: "Everything the caller needs to know (details, constraints, fallbacks)" },
  }, ["to", "name", "goal"]),
  fn("ask_user", "Ask the user a question and wait for their answer.", {
    question: { type: "string" },
    options: { type: "array", items: { type: "string" } },
  }, ["question"]),
  fn("finish", "Finish the errand with a result for the user.", {
    outcome: { type: "string", description: "One-line outcome" },
    details: { type: "string", description: "Details (times, prices, confirmation, next steps)" },
  }, ["outcome"]),
];

function systemPrompt(errandId: string) {
  const e = errands.get(errandId)!;
  return `You are nova26, an errand agent acting on behalf of ${e.onBehalfOf || "the user"}. You do web research and make phone calls to get the errand done.
Today is ${new Date().toDateString()}.

ERRAND:
${JSON.stringify({ objective: e.objective, summary: e.summary, constraints: e.constraints, onBehalfOf: e.onBehalfOf, contacts: e.contacts, approvalRules: e.approvalRules, missingInfo: e.missingInfo }, null, 2)}

How to work:
1. Call set_plan first with a short plan (2-6 steps). Update it (set_plan again) as steps complete.
2. Use web_search / fetch_page to find missing info (phone numbers, hours, prices). Don't over-research.
3. Use place_call for calls. Give the caller a clear goal and rich context (all relevant constraints, the approval rules, acceptable fallbacks). The caller can check with the user mid-call itself.
4. APPROVAL RULES are binding: use ask_user BEFORE any action they gate. Never pay for anything or share payment/sensitive personal info yourself.
5. If something essential is missing and can't be found, ask_user (concise, with options when possible).
6. Finish with finish({outcome, details}) — concrete facts: what was booked/ordered, times, prices, names, and anything the user must do next.
Be efficient: at most ~${MAX_ITERS} steps.`;
}

export function startRun(errandId: string) {
  if (running.has(errandId)) return;
  running.add(errandId);
  callsPlaced.set(errandId, 0);
  patchErrand(errandId, { status: "running" });
  emit(errandId, { type: "log", text: "Starting errand" });
  run(errandId)
    .catch((err) => {
      console.error("[agent] error", err);
      emit(errandId, { type: "error", text: (err as Error).message });
      patchErrand(errandId, { status: "failed" });
    })
    .finally(() => running.delete(errandId));
}

async function run(errandId: string) {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt(errandId) },
    { role: "user", content: "Run this errand now." },
  ];
  for (let i = 0; i < MAX_ITERS; i++) {
    const r = await llm().chat.completions.create({ model: cfg().plannerModel, messages, tools: TOOLS, max_tokens: 2000 });
    const msg = r.choices[0]?.message;
    if (!msg) throw new Error("empty response from planner");
    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls });
    if (msg.content?.trim()) emit(errandId, { type: "log", text: msg.content.trim() });
    if (!msg.tool_calls?.length) {
      messages.push({ role: "user", content: "Continue. Use tools; call finish when done." });
      continue;
    }
    for (const tc of msg.tool_calls) {
      if (tc.type !== "function") continue;
      const args = parseJson<any>(tc.function.arguments) ?? {};
      let result: unknown;
      try {
        result = await runTool(errandId, tc.function.name, args);
      } catch (err) {
        result = { error: (err as Error).message };
      }
      if (tc.function.name === "finish" && !(result as any)?.error) return;
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 12000) });
    }
  }
  emit(errandId, { type: "error", text: `Stopped after ${MAX_ITERS} steps without finishing.` });
  patchErrand(errandId, { status: "failed" });
}

async function runTool(errandId: string, name: string, a: any): Promise<unknown> {
  switch (name) {
    case "set_plan": {
      const plan: PlanStep[] = (a.steps ?? []).map((s: any, i: number) => ({
        id: String(s.id ?? `s${i + 1}`),
        kind: ["web", "call", "ask_user", "note"].includes(s.kind) ? s.kind : "note",
        description: String(s.description ?? ""),
        status: ["pending", "running", "done", "failed", "skipped"].includes(s.status) ? s.status : "pending",
      }));
      patchErrand(errandId, { plan });
      emit(errandId, { type: "plan", plan });
      return { ok: true };
    }
    case "web_search": {
      const query = String(a.query ?? "");
      emit(errandId, { type: "web", action: "search", query });
      const results = await webSearch(query);
      emit(errandId, { type: "web", action: "search", query, summary: `${results.length} results: ${results.slice(0, 3).map((r) => r.title).join(" | ")}` });
      return results;
    }
    case "fetch_page": {
      const url = String(a.url ?? "");
      emit(errandId, { type: "web", action: "fetch", query: url });
      const text = await fetchPage(url);
      emit(errandId, { type: "web", action: "fetch", query: url, summary: `${text.length} chars: ${text.slice(0, 120).replace(/\s+/g, " ")}` });
      return { url, text };
    }
    case "place_call": {
      const placed = callsPlaced.get(errandId) ?? 0;
      if (placed >= cfg().maxCallsPerErrand) {
        emit(errandId, { type: "log", text: `Call limit reached (${cfg().maxCallsPerErrand}); not redialing` });
        return { error: `Call limit reached (${cfg().maxCallsPerErrand} per errand). Do NOT call again. Call finish with what you learned, including anything left unresolved.` };
      }
      callsPlaced.set(errandId, placed + 1);
      const res = await placeCall(errandId, { to: String(a.to ?? ""), name: String(a.name ?? "callee"), goal: String(a.goal ?? ""), context: a.context ? String(a.context) : "" });
      emit(errandId, { type: "log", text: `Call with ${a.name} ended (${res.status}): ${res.outcome}` });
      return { status: res.status, outcome: res.outcome, transcript: res.transcript };
    }
    case "ask_user": {
      const answer = await askUser(errandId, String(a.question ?? ""), Array.isArray(a.options) ? a.options.map(String) : undefined);
      patchErrand(errandId, { status: "running" });
      return { answer };
    }
    case "finish": {
      const result = { outcome: String(a.outcome ?? "Done"), ...(a.details ? { details: String(a.details) } : {}) };
      patchErrand(errandId, { result, status: "done" });
      emit(errandId, { type: "result", ...result });
      return { ok: true };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

export const isRunning = (id: string) => running.has(id);
export { newId };
