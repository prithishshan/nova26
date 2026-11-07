import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { cfg, SERVER_ROOT } from "./env.js";
import { newId } from "./store.js";

export const AUDIO_DIR = path.join(SERVER_ROOT, ".audio");
fs.mkdirSync(AUDIO_DIR, { recursive: true });

export function llm() {
  const c = cfg();
  if (!c.openrouterKey) throw new Error("OPENROUTER_API_KEY is not set");
  return new OpenAI({
    apiKey: c.openrouterKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: { "HTTP-Referer": "https://nova26.local", "X-Title": "nova26" },
  });
}

export function parseJson<T = any>(s: string | null | undefined): T | null {
  if (!s) return null;
  const t = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {}
  }
  return null;
}

function pcmToWav(pcm: Buffer, rate: number, channels = 1, bits = 16): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE((rate * channels * bits) / 8, 28);
  h.writeUInt16LE((channels * bits) / 8, 32);
  h.writeUInt16LE(bits, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Text-to-speech via OpenRouter. Returns the audio file name (served at /audio/<file>, .mp3 or .wav) or null on failure. */
/** Average every `factor` 16-bit mono samples (a simple low-pass + decimate). */
function downsample(pcm: Buffer, factor: number): Buffer {
  const n = Math.floor(pcm.length / 2 / factor);
  const out = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += pcm.readInt16LE((i * factor + k) * 2);
    out.writeInt16LE(Math.round(sum / factor), i * 2);
  }
  return out;
}

export async function tts(text: string): Promise<string | null> {
  const c = cfg();
  if (!c.openrouterKey || !text.trim()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  const pcm = /gemini/i.test(c.ttsModel);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/audio/speech", {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${c.openrouterKey}`, "Content-Type": "application/json" },
      // Gemini TTS on OpenRouter only supports raw PCM (24kHz s16le mono); we wrap it in a WAV header.
      body: JSON.stringify({ model: c.ttsModel, input: text, voice: c.ttsVoice, response_format: pcm ? "pcm" : "mp3" }),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok || buf.length < 500) {
      console.warn(`[tts] failed ${res.status}: ${buf.toString("utf8").slice(0, 300)}`);
      return null;
    }
    const id = newId("a_");
    if (pcm) {
      const rate = Number(res.headers.get("content-type")?.match(/rate=(\d+)/)?.[1] ?? 24000);
      // Phone lines carry 8 kHz audio: downsample to keep files ~3x smaller and Twilio fetches fast.
      const out = rate % 8000 === 0 && rate > 8000 ? downsample(buf, rate / 8000) : buf;
      fs.writeFileSync(path.join(AUDIO_DIR, `${id}.wav`), pcmToWav(out, out === buf ? rate : 8000));
      return `${id}.wav`;
    }
    fs.writeFileSync(path.join(AUDIO_DIR, `${id}.mp3`), buf);
    return `${id}.mp3`;
  } catch (err) {
    console.warn("[tts] error", (err as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function normalizePhone(p?: string): string | undefined {
  if (!p) return undefined;
  const trimmed = p.trim();
  const d = trimmed.replace(/\D/g, "");
  if (!d) return undefined;
  if (trimmed.startsWith("+")) return "+" + d;
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return "+" + d;
}
