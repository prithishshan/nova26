import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, "..");
const ENV_PATH = path.resolve(SERVER_ROOT, "../../.env");
dotenv.config({ path: ENV_PATH });

// Re-read .env lazily (cheap) so keys pasted while the server runs are picked up.
let cache: { at: number; vals: Record<string, string> } | null = null;
function fileVals(): Record<string, string> {
  if (cache && Date.now() - cache.at < 2000) return cache.vals;
  let vals: Record<string, string> = {};
  try {
    vals = dotenv.parse(fs.readFileSync(ENV_PATH));
  } catch {}
  cache = { at: Date.now(), vals };
  return vals;
}
function get(k: string, def = ""): string {
  const v = fileVals()[k] || process.env[k] || "";
  return v.trim() || def;
}

export const cfg = () => ({
  openrouterKey: get("OPENROUTER_API_KEY"),
  plannerModel: get("PLANNER_MODEL", "anthropic/claude-sonnet-5.5"),
  callModel: get("CALL_MODEL", "google/gemini-3.8-flash"),
  ttsModel: get("TTS_MODEL", "google/gemini-3.8-flash-tts"),
  ttsVoice: get("TTS_VOICE", "Kore"),
  twilioSid: get("TWILIO_ACCOUNT_SID"),
  twilioToken: get("TWILIO_AUTH_TOKEN"),
  twilioFrom: get("TWILIO_FROM_NUMBER"),
  port: Number(process.env.NOVA_PORT || get("PORT", "8787")), // NOVA_PORT (shell) overrides .env for side-by-side test servers
  publicUrl: get("PUBLIC_URL").replace(/\/+$/, ""),
  // Hard cap on real/sim calls per errand run, so the agent can't keep redialing.
  maxCallsPerErrand: Number(get("MAX_CALLS_PER_ERRAND", "1")),
  callMode: (get("CALL_MODE", "sim") === "twilio" ? "twilio" : "sim") as "sim" | "twilio",
});
