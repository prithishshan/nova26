import { randomUUID } from "node:crypto";
import type { Errand, ErrandEvent, ChatMessage } from "@nova26/shared";

export const errands = new Map<string, Errand>();
export const chats = new Map<string, ChatMessage[]>();
const events = new Map<string, ErrandEvent[]>();
const waiters = new Map<string, { errandId: string; resolve: (t: string) => void }>();

export const now = () => new Date().toISOString();
export const newId = (p = "") => p + randomUUID().replace(/-/g, "").slice(0, 12);

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export function emit(errandId: string, ev: DistOmit<ErrandEvent, "seq" | "at">) {
  const list = events.get(errandId) ?? [];
  const full = { ...ev, seq: list.length + 1, at: now() } as ErrandEvent;
  list.push(full);
  events.set(errandId, list);
  console.log(`[${errandId}] ${JSON.stringify(ev).slice(0, 220)}`);
  return full;
}
export const eventsAfter = (errandId: string, after: number) =>
  (events.get(errandId) ?? []).filter((e) => e.seq > after);

export function newErrand(objective = ""): Errand {
  const e: Errand = {
    id: newId("e_"),
    createdAt: now(),
    objective,
    constraints: [],
    contacts: [],
    approvalRules: [],
    missingInfo: [],
    status: "draft",
    plan: [],
  };
  errands.set(e.id, e);
  chats.set(e.id, []);
  return e;
}

export function patchErrand(id: string, patch: Partial<Errand>): Errand {
  const e = errands.get(id);
  if (!e) throw new Error("errand not found");
  const next = { ...e, ...patch, id: e.id, createdAt: e.createdAt } as Errand;
  if ("pendingQuestion" in patch && patch.pendingQuestion === undefined) delete next.pendingQuestion;
  errands.set(id, next);
  return next;
}

/** Ask the user a question; resolves with their answer (from POST /errands/:id/answer). */
export function askUser(errandId: string, text: string, options?: string[]): Promise<string> {
  const q = { id: newId("q_"), text, ...(options?.length ? { options } : {}) };
  patchErrand(errandId, { pendingQuestion: q, status: "needs_input" });
  emit(errandId, { type: "question", question: q });
  return new Promise((resolve) => {
    waiters.set(q.id, {
      errandId,
      resolve: (answer) => {
        const e = errands.get(errandId);
        patchErrand(errandId, {
          pendingQuestion: undefined,
          status: e?.status === "needs_input" ? "running" : e?.status,
        });
        emit(errandId, { type: "answer", questionId: q.id, text: answer });
        resolve(answer);
      },
    });
  });
}

export function answerQuestion(errandId: string, questionId: string | undefined, text: string): boolean {
  const qid = questionId || errands.get(errandId)?.pendingQuestion?.id;
  const w = qid ? waiters.get(qid) : undefined;
  if (!w || w.errandId !== errandId) return false;
  waiters.delete(qid!);
  w.resolve(text);
  return true;
}
