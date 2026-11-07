import OpenAI from "openai";

export const engineModel = () => (process.env.ENGINE_MODEL || "anthropic/claude-sonnet-5.5").trim();

export function engineClient() {
  const key = (process.env.OPENROUTER_API_KEY || "").trim();
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  return new OpenAI({
    apiKey: key,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: { "HTTP-Referer": "https://nova26.local", "X-Title": "nova26-engine" },
  });
}
