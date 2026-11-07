// Patient relay: POST /calls/:callId/relay {text} -> the agent speaks the patient's words, attributed.
import type { FastifyInstance } from "fastify";
import { calls, queueRelay, type CallSession } from "./core.js";
import { simRelayNow } from "./sim.js";

/**
 * Queue the text; it is spoken at the agent's next speaking opportunity:
 *  - on hold for the user (ask_user): resolves the pending question and is spoken right away;
 *  - sim: spoken immediately (no audio channel to wait on);
 *  - twilio: spoken on the next turn response (callee speaks, or the Gather times out on silence ~6s).
 */
export function relayToCall(s: CallSession, text: string) {
  const { resolvedHold } = queueRelay(s, text);
  if (s.driver === "sim" && !resolvedHold) simRelayNow(s);
  return { resolvedHold };
}

export function registerRelayRoute(app: FastifyInstance) {
  app.post("/calls/:callId/relay", async (req, reply) => {
    const { callId } = req.params as { callId: string };
    const s = calls.get(callId);
    if (!s) return reply.code(404).send({ error: "call not found" });
    if (s.ended) return reply.code(409).send({ error: "call has ended" });
    const text = String((req.body as any)?.text ?? "").trim();
    if (!text) return reply.code(400).send({ error: "text required" });
    if (text.length > 500) return reply.code(400).send({ error: "text too long (max 500 chars)" });
    return { ok: true, ...relayToCall(s, text) };
  });
}
