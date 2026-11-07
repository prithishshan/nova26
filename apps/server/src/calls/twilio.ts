// Twilio driver: turn-based <Gather input="speech"> with OpenRouter TTS (<Play>), <Say> fallback.
import type { FastifyInstance } from "fastify";
import twilio from "twilio";
import type { CallStatus } from "@nova26/shared";
import { cfg } from "../env.js";
import { tts } from "../llm.js";
import { emit } from "../store.js";
import { addCallee, agentStep, calls, finalize, holdFiller, isPayerCall, payerOpening, setStatus, speechHints, type CallSession, type TurnOut } from "./core.js";
import { registerRelayRoute } from "./relay.js";

const VoiceResponse = twilio.twiml.VoiceResponse;
const MAX_HOLD_MS = 90_000;
// Answer every Twilio webhook fast; if the reply isn't ready, pause 1s and have Twilio check back (/twilio/wait).
// Long-held webhooks (6s+) were being dropped by Twilio with "cannot reach your TwiML server".
const WEBHOOK_BUDGET_MS = Number(process.env.WEBHOOK_BUDGET_MS || 2500);
const STILL_THERE = "Sorry, are you still there?";
const NO_ANSWER_BYE = "I'm not hearing anything, so I'll try again later. Goodbye.";
// Gather speech model. Twilio docs: when speechModel is set, speechTimeout must be a positive integer
// ("Don't use auto"), and `enhanced` is deprecated. The requested behavior is speechTimeout="auto", so by
// default we send NO speechModel (Twilio default model) and rely on `hints` + language for accuracy.
// Opt in with GATHER_SPEECH_MODEL=phone_call (then speechTimeout becomes GATHER_SPEECH_TIMEOUT, default 2s).
const SPEECH_MODEL = (process.env.GATHER_SPEECH_MODEL || "").trim();
const SPEECH_TIMEOUT_S = Number(process.env.GATHER_SPEECH_TIMEOUT || 2) || 2;

/** TTS cached by exact text (opening, filler, stock lines are re-used across turns and calls). */
const ttsCache = new Map<string, Promise<string | null>>();
function ttsCached(text: string): Promise<string | null> {
  const key = text.trim();
  if (!key) return Promise.resolve(null);
  let p = ttsCache.get(key);
  if (!p) {
    p = tts(key).then((id) => {
      if (!id) ttsCache.delete(key); // don't cache failures
      return id;
    });
    ttsCache.set(key, p);
    if (ttsCache.size > 500) ttsCache.delete(ttsCache.keys().next().value!);
  }
  return p;
}

export function twilioConfigError(): string | null {
  const c = cfg();
  const missing = [
    !c.twilioSid && "TWILIO_ACCOUNT_SID",
    !c.twilioToken && "TWILIO_AUTH_TOKEN",
    !c.twilioFrom && "TWILIO_FROM_NUMBER",
    !c.publicUrl && "PUBLIC_URL",
  ].filter(Boolean);
  return missing.length ? `Twilio call mode is missing config: ${missing.join(", ")} (set them in .env)` : null;
}

const url = (p: string, s: CallSession) => `${cfg().publicUrl}${p}?callId=${encodeURIComponent(s.id)}`;
const audioUrl = (file: string) => `${cfg().publicUrl}/audio/${file}`;

// If the voice isn't ready within this many ms, speak the line with Twilio <Say> instead (instant).
const TTS_DEADLINE_MS = Number(process.env.TTS_DEADLINE_MS || 3500);
async function withAudio(p: Promise<TurnOut>): Promise<TurnOut> {
  const out = await p;
  if (!out.say) return { ...out, audio: null };
  const t0 = Date.now();
  const audio = await Promise.race([ttsCached(out.say), new Promise<null>((r) => setTimeout(() => r(null), TTS_DEADLINE_MS))]);
  if (!audio) console.warn(`[twilio] TTS not ready in ${Date.now() - t0}ms; using <Say> for: ${out.say.slice(0, 60)}`);
  return { ...out, audio };
}

/** Kick off the brain turn and the filler hook for the next response. */
function startTurn(s: CallSession) {
  s.pendingDone = undefined;
  s.fillerPlayed = false;
  s.filler = new Promise<TurnOut>((r) => (s.fillerResolve = r));
  s.pending = withAudio(
    agentStep(s, (text) => {
      s.waitStart = Date.now();
      // Use the pre-generated filler audio (zero TTS latency); fall back to TTS of the brain's own filler.
      // Always speak the fixed filler (its audio is pre-generated at call start) so hold has no TTS latency.
      const pre = s.fillerAudio ?? Promise.resolve(null);
      pre.then((audio) => s.fillerResolve?.({ say: holdFiller(s), hangup: false, audio }));
      return holdFiller(s);
    }),
  );
  s.pending.then((o) => (s.pendingDone = o)).catch((err) => {
    console.error("[twilio] turn error", err);
    s.pendingDone = { say: "Sorry, I'm having technical trouble. I'll call back later. Goodbye.", hangup: true, audio: null };
  });
}

/** Start a real call. Pre-generates the opening line + TTS while ringing. */
export async function startTwilio(s: CallSession, opts: { dial?: boolean } = {}) {
  s.waitStart = Date.now();
  // Pre-generate everything we may need early while the phone rings (cached by text).
  s.fillerAudio = ttsCached(holdFiller(s));
  if (isPayerCall(s)) void ttsCached(payerOpening(s));
  void ttsCached(STILL_THERE);
  void ttsCached(NO_ANSWER_BYE);
  startTurn(s);
  if (opts.dial === false) return;
  const c = cfg();
  const client = twilio(c.twilioSid, c.twilioToken);
  const base = { to: s.to, from: c.twilioFrom, url: url("/twilio/voice", s), method: "POST" as const };
  let call;
  try {
    call = await client.calls.create({
      ...base,
      statusCallback: url("/twilio/status", s),
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallbackMethod: "POST",
    });
  } catch (err) {
    // Trial accounts may reject optional params ("trial accounts have limited parameter access").
    console.warn("[twilio] calls.create with statusCallback failed, retrying minimal:", (err as Error).message);
    emit(s.errandId, { type: "log", text: "Twilio rejected status callbacks (trial account?); retrying with minimal params + status polling." });
    call = await client.calls.create({ to: s.to, from: c.twilioFrom, url: base.url });
    pollStatus(s, client, call.sid);
  }
  s.twilioSid = call.sid;
  setStatus(s, "dialing");
}

/** Fallback when statusCallback is unavailable: poll the call resource every 2s. */
function pollStatus(s: CallSession, client: ReturnType<typeof twilio>, sid: string) {
  s.pollTimer = setInterval(async () => {
    if (s.ended) return clearInterval(s.pollTimer);
    try {
      const c = await client.calls(sid).fetch();
      const st = STATUS_MAP[c.status];
      if (!st) return;
      if (["completed", "failed", "no_answer"].includes(st)) {
        clearInterval(s.pollTimer);
        await finalize(s, st);
      } else if (!(st === "dialing" || st === "ringing") || s.status === "dialing" || s.status === "ringing") {
        if (s.status !== "on_hold_for_user") setStatus(s, st);
      }
    } catch (err) {
      console.warn("[twilio] poll error", (err as Error).message);
    }
  }, 2000);
}

function speak(node: { play: (u: string) => unknown; say: (t: string) => unknown }, out: { say: string; audio?: string | null }) {
  if (!out.say) return;
  if (out.audio) node.play(audioUrl(out.audio));
  else node.say(out.say);
}

function turnTwiml(s: CallSession, out: TurnOut): string {
  const vr = new VoiceResponse();
  if (out.hangup) {
    speak(vr, out);
    vr.hangup();
    // Twilio status callback will finalize; mark outcome now in case it is delayed.
    setTimeout(() => finalize(s, "completed"), 30_000);
    return vr.toString();
  }
  const g = vr.gather(gatherAttrs(s));
  speak(g, out);
  return vr.toString();
}

/** A listen-only Gather (no prompt): used to silently keep waiting after a first empty result. */
function listenTwiml(s: CallSession): string {
  const vr = new VoiceResponse();
  vr.gather(gatherAttrs(s));
  return vr.toString();
}

function gatherAttrs(s: CallSession) {
  const hints = speechHints(s);
  return {
    input: ["speech" as const],
    language: "en-US" as const,
    timeout: 6, // seconds to wait for the callee to START speaking (trial preamble + slow pickups)
    ...(SPEECH_MODEL && SPEECH_MODEL !== "default"
      ? { speechModel: SPEECH_MODEL as "phone_call", speechTimeout: String(SPEECH_TIMEOUT_S) }
      : { speechTimeout: "auto" }),
    ...(hints ? { hints } : {}),
    profanityFilter: false,
    actionOnEmptyResult: true,
    action: url("/twilio/turn", s),
    method: "POST" as const,
  };
}

function waitTwiml(s: CallSession, filler?: TurnOut): string {
  const vr = new VoiceResponse();
  if (filler) speak(vr, filler);
  vr.pause({ length: 1 });
  vr.redirect({ method: "POST" }, url("/twilio/wait", s));
  return vr.toString();
}

function goodbyeTwiml(text: string): string {
  const vr = new VoiceResponse();
  vr.say(text);
  vr.hangup();
  return vr.toString();
}

/** Respond within the webhook budget: the turn result, a hold filler, or a wait loop. */
async function respond(s: CallSession): Promise<string> {
  if (s.pendingDone) return turnTwiml(s, s.pendingDone);
  const timeout = new Promise<{ k: "timeout" }>((r) => setTimeout(() => r({ k: "timeout" }), WEBHOOK_BUDGET_MS));
  const r = await Promise.race([
    s.pending!.then((o) => ({ k: "out" as const, o })).catch(() => ({ k: "timeout" as const })),
    (s.fillerPlayed ? new Promise<never>(() => {}) : s.filler!).then((f) => ({ k: "filler" as const, f })),
    timeout,
  ]);
  if (r.k === "out") return turnTwiml(s, r.o);
  if (r.k === "filler") {
    s.fillerPlayed = true;
    return waitTwiml(s, r.f);
  }
  return waitTwiml(s);
}

const xml = (reply: any, body: string) => reply.type("text/xml").send(body);

const STATUS_MAP: Record<string, CallStatus> = {
  queued: "dialing",
  initiated: "dialing",
  ringing: "ringing",
  "in-progress": "in_progress",
  answered: "in_progress",
  completed: "completed",
  busy: "no_answer",
  "no-answer": "no_answer",
  failed: "failed",
  canceled: "failed",
};

export function registerTwilioRoutes(app: FastifyInstance) {
  // Driver-agnostic in-call patient relay lives with the call routes (already registered by the server).
  registerRelayRoute(app);
  const getSession = (q: any) => calls.get(String(q?.callId ?? ""));

  app.post("/twilio/voice", async (req, reply) => {
    const s = getSession(req.query);
    if (!s) return xml(reply, goodbyeTwiml("Sorry, this call is no longer active. Goodbye."));
    setStatus(s, "in_progress");
    return xml(reply, await respond(s));
  });

  app.post("/twilio/turn", async (req, reply) => {
    const s = getSession(req.query);
    if (!s || s.ended) return xml(reply, goodbyeTwiml("Goodbye."));
    const speech = String((req.body as any)?.SpeechResult ?? "").trim();
    if (!speech) {
      // Silence. A queued patient relay is a speaking opportunity: take a turn now.
      if (s.relays.length) {
        s.silences = 0;
        s.waitStart = Date.now();
        startTurn(s);
        return xml(reply, await respond(s));
      }
      s.silences++;
      // 1st empty: keep listening silently (callee may still be getting settled / trial preamble).
      if (s.silences === 1) return xml(reply, listenTwiml(s));
      if (s.silences >= 3) {
        s.lines.push({ speaker: "note", text: "no response from callee after repeated silence; hung up" });
        emit(s.errandId, { type: "transcript", callId: s.id, speaker: "agent", text: NO_ANSWER_BYE });
        s.outcome = s.outcome || "No response from the callee; hung up after repeated silence.";
        return xml(reply, turnTwiml(s, { say: NO_ANSWER_BYE, hangup: true, audio: await ttsCached(NO_ANSWER_BYE) }));
      }
      emit(s.errandId, { type: "transcript", callId: s.id, speaker: "agent", text: STILL_THERE });
      return xml(reply, turnTwiml(s, { say: STILL_THERE, hangup: false, audio: await ttsCached(STILL_THERE) }));
    }
    s.silences = 0;
    addCallee(s, speech);
    s.waitStart = Date.now();
    startTurn(s);
    return xml(reply, await respond(s));
  });

  app.post("/twilio/wait", async (req, reply) => {
    const s = getSession(req.query);
    if (!s || s.ended) return xml(reply, goodbyeTwiml("Goodbye."));
    if (!s.pendingDone && Date.now() - (s.waitStart ?? Date.now()) > MAX_HOLD_MS) {
      s.lines.push({ speaker: "note", text: "user did not answer in time; ended call" });
      emit(s.errandId, { type: "log", text: "Hold timed out waiting for your answer; ending the call politely." });
      s.outcome = s.outcome || "Call ended while waiting on the user's decision; nothing was confirmed.";
      return xml(reply, goodbyeTwiml("Sorry, I wasn't able to reach them in time. We'll follow up shortly. Thank you, goodbye."));
    }
    return xml(reply, await respond(s));
  });

  app.post("/twilio/status", async (req, reply) => {
    const s = getSession(req.query);
    const raw = String((req.body as any)?.CallStatus ?? "");
    if (s && STATUS_MAP[raw]) {
      const st = STATUS_MAP[raw];
      if (["completed", "failed", "no_answer"].includes(st)) await finalize(s, st);
      else if (s.status !== "on_hold_for_user" && !(st !== "in_progress" && s.status === "in_progress")) setStatus(s, st);
    }
    return reply.send({ ok: true });
  });
}
