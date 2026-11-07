// Typed client for the nova26 server. Contract lives in @nova26/shared.
import type { CaseResponse, ChatMessage, Errand, EventsResponse, IntakeResponse } from "@nova26/shared";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "http://localhost:8787").replace(/\/+$/, "");

export type Health = {
  ok: boolean;
  callMode?: string;
  hasOpenRouterKey?: boolean;
  hasTwilio?: boolean;
  publicUrl?: string;
};

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_URL + path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    // non-JSON response
  }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || text || res.statusText;
    throw new Error(`${method} ${path} -> ${res.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
  }
  return data as T;
}

export const api = {
  health: () => req<Health>("GET", "/health"),
  listErrands: () => req<{ errands: Errand[] }>("GET", "/errands"),
  getErrand: (id: string) => req<{ errand: Errand; messages: ChatMessage[] }>("GET", `/errands/${id}`),
  intake: (message: string, errandId?: string) =>
    req<IntakeResponse>("POST", "/errands/intake", { errandId, message }),
  patchErrand: (id: string, patch: Partial<Errand>) => req<{ errand: Errand }>("PATCH", `/errands/${id}`, patch),
  run: (id: string) => req<{ errand: Errand }>("POST", `/errands/${id}/run`),
  events: (id: string, after: number) =>
    req<EventsResponse>("GET", `/errands/${id}/events?after=${after}`),
  answer: (id: string, questionId: string, text: string) =>
    req<{ ok: true }>("POST", `/errands/${id}/answer`, { questionId, text }),
  simReply: (callId: string, text: string) => req<{ ok: true }>("POST", `/calls/${callId}/sim-reply`, { text }),
  relay: (callId: string, text: string) => req<{ ok: true }>("POST", `/calls/${callId}/relay`, { text }),

  // ---- hero flow (single patient case) ----
  getCase: () => req<CaseResponse>("GET", "/case"),
  resetCase: () => req<CaseResponse>("POST", "/case/reset"),
  connectMyChart: () => req<CaseResponse>("POST", "/case/mychart/connect"),
  addDocuments: (docs: { denialLetter?: boolean; eob?: boolean; bill?: boolean }) => req<CaseResponse>("POST", "/case/documents", docs),
  analyzeCase: () => req<CaseResponse>("POST", "/case/analyze"),
  callPayer: () => req<CaseResponse>("POST", "/case/call-payer"),
};
