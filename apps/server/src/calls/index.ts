import { cfg } from "../env.js";
import { normalizePhone } from "../llm.js";
import { emit } from "../store.js";
import { calls, createSession, finalize, type CallResult, type CallSession } from "./core.js";
import { startSim } from "./sim.js";
import { startTwilio, twilioConfigError } from "./twilio.js";

export { calls };
export { simReply } from "./sim.js";

const CALL_CAP_MS = 20 * 60_000;

/** Place a call and await its completion. */
export async function placeCall(
  errandId: string,
  a: { to: string; name: string; goal: string; context?: string },
  opts: { mode?: "sim" | "twilio"; dial?: boolean } = {},
): Promise<CallResult> {
  const to = normalizePhone(a.to);
  if (!to) throw new Error(`invalid phone number: ${a.to}`);
  const mode = opts.mode ?? cfg().callMode;
  if (mode === "twilio" && opts.dial !== false) {
    const err = twilioConfigError();
    if (err) {
      emit(errandId, { type: "error", text: err });
      throw new Error(err);
    }
  }
  const s = createSession(errandId, { ...a, to }, mode);
  emit(errandId, { type: "log", text: `Calling ${a.name} at ${to} (${mode} mode)` });
  if (mode === "twilio") {
    try {
      await startTwilio(s, { dial: opts.dial });
    } catch (err) {
      s.outcome = `Call could not be placed: ${(err as Error).message}`;
      emit(errandId, { type: "error", text: s.outcome });
      await finalize(s, "failed");
    }
  } else {
    startSim(s);
  }
  return Promise.race([
    s.done,
    new Promise<CallResult>((r) =>
      setTimeout(async () => {
        s.outcome = s.outcome || "Call timed out.";
        await finalize(s, "failed");
        r(await s.done);
      }, CALL_CAP_MS),
    ),
  ]);
}

export function createDebugTwilioSession(errandId: string, a: { to: string; name: string; goal: string; context?: string }): CallSession {
  const s = createSession(errandId, { ...a, to: normalizePhone(a.to) ?? a.to }, "twilio");
  void startTwilio(s, { dial: false });
  return s;
}
