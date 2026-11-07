// Sim driver: no audio. The app (or curl) plays the callee via POST /calls/:callId/sim-reply.
import { addCallee, agentStep, finalize, setStatus, type CallSession } from "./core.js";

export function startSim(s: CallSession) {
  setStatus(s, "in_progress");
  s.chain = s.chain.then(async () => {
    const out = await agentStep(s);
    if (out.hangup) await finalize(s, "completed");
  }).catch((err) => failSim(s, err));
}

export function simReply(s: CallSession, text: string) {
  s.chain = s.chain.then(async () => {
    if (s.ended) return;
    if (text.trim().toLowerCase() === "[hangup]") {
      s.lines.push({ speaker: "note", text: "callee hung up" });
      await finalize(s, "completed");
      return;
    }
    addCallee(s, text);
    const out = await agentStep(s);
    if (out.hangup) await finalize(s, "completed");
  }).catch((err) => failSim(s, err));
}

/** Speak queued patient relays now (sim has no audio channel to wait on). No-op if a turn already drained them. */
export function simRelayNow(s: CallSession) {
  s.chain = s.chain.then(async () => {
    if (s.ended || !s.relays.length) return;
    const out = await agentStep(s);
    if (out.hangup) await finalize(s, "completed");
  }).catch((err) => failSim(s, err));
}

async function failSim(s: CallSession, err: unknown) {
  console.error("[sim] error", err);
  s.outcome = `Call failed: ${(err as Error).message}`;
  await finalize(s, "failed");
}
