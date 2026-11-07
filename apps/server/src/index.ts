import { cfg } from "./env.js";
import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import { Errand } from "@nova26/shared";
import { intake } from "./intake.js";
import { startRun } from "./agent.js";
import { AUDIO_DIR, tts } from "./llm.js";
import { answerQuestion, chats, errands, eventsAfter, patchErrand } from "./store.js";
import { calls, createDebugTwilioSession, simReply } from "./calls/index.js";
import { registerTwilioRoutes } from "./calls/twilio.js";
import { registerCaseRoutes } from "./case/routes.js";
import { registerPolicyRoutes } from "./case/policies.js";

const app = Fastify({ logger: false });
// Twilio webhooks + audio fetches: log status and latency so call failures are diagnosable.
app.addHook("onRequest", async (req) => { (req as unknown as { t0: number }).t0 = Date.now(); });
app.addHook("onResponse", async (req, reply) => {
  if (!/^\/(twilio|audio)\//.test(req.url)) return;
  const ms = Date.now() - ((req as unknown as { t0: number }).t0 ?? Date.now());
  console.log(`[http] ${req.method} ${req.url.split("?")[0]} -> ${reply.statusCode} in ${ms}ms`);
});
app.addHook("onError", async (req, _reply, err) => { console.error(`[http] ERROR ${req.method} ${req.url.split("?")[0]}: ${err.message}`); });
await app.register(cors, { origin: true });
await app.register(formbody);

const notFound = (reply: any, what = "errand") => reply.code(404).send({ error: `${what} not found` });

app.get("/health", async () => {
  const c = cfg();
  return {
    ok: true,
    callMode: c.callMode,
    hasOpenRouterKey: !!c.openrouterKey,
    hasTwilio: !!(c.twilioSid && c.twilioToken && c.twilioFrom),
    publicUrl: c.publicUrl || null,
  };
});

app.post("/errands/intake", async (req, reply) => {
  const b = (req.body ?? {}) as { errandId?: string; message?: string };
  if (!b.message?.trim()) return reply.code(400).send({ error: "message required" });
  if (b.errandId && !errands.has(b.errandId)) return notFound(reply);
  try {
    return await intake(b.errandId, b.message.trim());
  } catch (err) {
    return reply.code(500).send({ error: (err as Error).message });
  }
});

app.get("/errands", async () => ({
  errands: [...errands.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
}));

app.get("/errands/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const errand = errands.get(id);
  if (!errand) return notFound(reply);
  return { errand, messages: chats.get(id) ?? [] };
});

app.patch("/errands/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  if (!errands.has(id)) return notFound(reply);
  const parsed = Errand.partial().safeParse(req.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
  const { id: _i, createdAt: _c, ...patch } = parsed.data;
  return { errand: patchErrand(id, patch) };
});

app.post("/errands/:id/run", async (req, reply) => {
  const { id } = req.params as { id: string };
  if (!errands.has(id)) return notFound(reply);
  if (!cfg().openrouterKey) return reply.code(400).send({ error: "OPENROUTER_API_KEY is not set" });
  startRun(id);
  return { errand: errands.get(id) };
});

app.get("/errands/:id/events", async (req, reply) => {
  const { id } = req.params as { id: string };
  const errand = errands.get(id);
  if (!errand) return notFound(reply);
  const after = Number((req.query as any)?.after ?? 0) || 0;
  return { events: eventsAfter(id, after), errand };
});

app.post("/errands/:id/answer", async (req, reply) => {
  const { id } = req.params as { id: string };
  if (!errands.has(id)) return notFound(reply);
  const b = (req.body ?? {}) as { questionId?: string; text?: string };
  if (!b.text?.trim()) return reply.code(400).send({ error: "text required" });
  if (!answerQuestion(id, b.questionId, b.text.trim())) return reply.code(409).send({ error: "no pending question with that id" });
  return { ok: true };
});

app.post("/calls/:callId/sim-reply", async (req, reply) => {
  const { callId } = req.params as { callId: string };
  const s = calls.get(callId);
  if (!s) return notFound(reply, "call");
  if (s.driver !== "sim") return reply.code(400).send({ error: "not a sim call" });
  if (s.ended) return reply.code(409).send({ error: "call has ended" });
  const text = String((req.body as any)?.text ?? "").trim();
  if (!text) return reply.code(400).send({ error: "text required" });
  simReply(s, text);
  return { ok: true };
});

// Dev helper: create a Twilio-driver session WITHOUT dialing, to exercise /twilio/* TwiML locally.
app.post("/debug/twilio-session", async (req, reply) => {
  const b = (req.body ?? {}) as { errandId?: string; to?: string; name?: string; goal?: string };
  if (!b.errandId || !errands.has(b.errandId)) return notFound(reply);
  const s = createDebugTwilioSession(b.errandId, { to: b.to ?? "+14125550100", name: b.name ?? "Test", goal: b.goal ?? "Say hello" });
  return { callId: s.id };
});

app.get("/debug/tts", async (req) => {
  const text = String((req.query as any)?.text ?? "Hi, this is an AI assistant calling on behalf of Sam.");
  const id = await tts(text);
  return { file: id, url: id ? `/audio/${id}` : null };
});

app.get("/audio/:file", async (req, reply) => {
  const file = (req.params as { file: string }).file;
  if (!/^[\w-]+\.(mp3|wav)$/.test(file)) return notFound(reply, "audio");
  const p = path.join(AUDIO_DIR, file);
  if (!fs.existsSync(p)) return notFound(reply, "audio");
  return reply.type(file.endsWith(".wav") ? "audio/wav" : "audio/mpeg").send(fs.createReadStream(p));
});

registerTwilioRoutes(app);
registerCaseRoutes(app);
registerPolicyRoutes(app);

const port = cfg().port;
await app.listen({ port, host: "0.0.0.0" });
console.log(`nova26 server on :${port} (callMode=${cfg().callMode}, openrouterKey=${cfg().openrouterKey ? "set" : "MISSING"})`);
