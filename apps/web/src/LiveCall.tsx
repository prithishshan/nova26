import { useEffect, useRef, useState } from "react";
import type { CallStatus, Errand, ErrandEvent, PatientCase } from "@nova26/shared";
import { ORG } from "@nova26/shared";
import { api } from "./api";
import { fmtTime } from "./format";

const CALL_STEPS: { key: CallStatus; label: string }[] = [
  { key: "dialing", label: "Dialing" },
  { key: "ringing", label: "Ringing" },
  { key: "in_progress", label: "In progress" },
  { key: "on_hold_for_user", label: "On hold for team" },
  { key: "completed", label: "Completed" },
];

export type Q = { id: string; text: string; options?: string[] };

export function useCallState(c: PatientCase, events: ErrandEvent[], errand: Errand | null) {
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const statusEvents = events.filter((e): e is Extract<ErrandEvent, { type: "call_status" }> => e.type === "call_status");
  const lastStatus = statusEvents[statusEvents.length - 1];
  const callStatus: CallStatus | undefined = lastStatus?.status;
  const callId = lastStatus?.callId ??
    (events.find(e => e.type === "transcript" || e.type === "reasoning") as { callId?: string } | undefined)?.callId;
  const ended = callStatus === "completed" || callStatus === "failed" || callStatus === "no_answer" || c.stage === "done";
  const answeredIds = new Set(events.filter(e => e.type === "answer").map(e => (e as Extract<ErrandEvent, { type: "answer" }>).questionId));
  const qs = events.filter(e => e.type === "question").map(e => (e as Extract<ErrandEvent, { type: "question" }>).question);
  const derived = [...qs].reverse().find(q => !answeredIds.has(q.id));
  let pending: Q | undefined = errand ? (errand.pendingQuestion ?? (errand.status === "needs_input" ? derived : undefined)) : derived;
  if (pending && (answered.has(pending.id) || answeredIds.has(pending.id))) pending = undefined;
  if (ended) pending = undefined;
  const markAnswered = (id: string) => setAnswered(s => new Set(s).add(id));
  return { callStatus, callId, ended, pending, markAnswered };
}

export default function Transcript({ c, events, errand }: { c: PatientCase; events: ErrandEvent[]; errand: Errand | null }) {
  const { callStatus, callId, ended } = useCallState(c, events, errand);
  const feed = events.filter(e => e.type === "transcript" || e.type === "answer" || e.type === "error" || e.type === "question");
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed.length]);
  const activeIdx = callStatus ? CALL_STEPS.findIndex(s => s.key === callStatus) : -1;
  const failed = callStatus === "failed" || callStatus === "no_answer";

  return (
    <section className="panel livecall">
      <div className="lc-head">
        <div>
          <div className="lc-label"><span className={`sdot ${ended ? "idle" : "live"}`} />AGENT · CALL SESSION {callId && <span className="mono muted">{callId}</span>}</div>
          <div className="lc-title">
            {!ended && <span className="live big">LIVE</span>}
            Aetna Provider Services · Expedited appeal
          </div>
          <div className="muted">nova26 agent on behalf of {ORG.orderingProvider.name}, {ORG.name} · PA ref <span className="mono">{c.denialLetter?.referenceNumber}</span></div>
        </div>
      </div>
      <ol className="callsteps">
        {CALL_STEPS.map((s, i) => {
          const state = failed ? "todo" : i < activeIdx || callStatus === "completed" ? "done" : i === activeIdx ? "active" : "todo";
          return <li key={s.key} className={`cstep ${state}`}><span className="cdot" />{s.label}</li>;
        })}
        {failed && <li className="cstep failed"><span className="cdot" />{callStatus === "no_answer" ? "No answer" : "Call failed"}</li>}
      </ol>
      <div className="transcript" ref={scrollRef}>
        {feed.length === 0 && <div className="muted center pad">{callStatus ? "Waiting for the conversation to begin..." : "Connecting call..."}</div>}
        {feed.map(e => {
          if (e.type === "transcript") {
            const agent = e.speaker === "agent";
            return (
              <div key={e.seq} className={`tline ${agent ? "agent" : "rep"}`}>
                <span className="ts mono">{fmtTime(e.at)}</span>
                <span className="spk mono">{agent ? "AGENT" : "AETNA"}</span>
                <span className="txt">{e.text}</span>
              </div>
            );
          }
          if (e.type === "question") return <div key={e.seq} className="tline sys warn"><span className="ts mono">{fmtTime(e.at)}</span><span className="spk mono">HOLD</span><span className="txt">Agent asked the team: {e.question.text}</span></div>;
          if (e.type === "answer") return <div key={e.seq} className="tline sys"><span className="ts mono">{fmtTime(e.at)}</span><span className="spk mono">TEAM</span><span className="txt">“{e.text}”</span></div>;
          return <div key={e.seq} className="tline sys err"><span className="ts mono">{fmtTime(e.at)}</span><span className="spk mono">ERROR</span><span className="txt">{(e as { text: string }).text}</span></div>;
        })}
      </div>
    </section>
  );
}

export function NeedsHuman({ errandId, q, onDone }: { errandId: string; q: Q; onDone: (id: string) => void }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async (t: string) => {
    if (!t.trim()) return;
    setSending(true); setErr(null);
    try { await api.answer(errandId, q.id, t.trim()); onDone(q.id); setText(""); }
    catch (e) { setErr((e as Error).message); } finally { setSending(false); }
  };
  return (
    <div className="needs-human">
      <div className="nh-title">Agent needs your input</div>
      <div className="nh-q">{q.text}</div>
      {q.options && q.options.length > 0 && (
        <div className="nh-opts">
          {q.options.map(o => <button key={o} className="btn amber" disabled={sending} onClick={() => send(o)}>{o}</button>)}
        </div>
      )}
      <form className="row" onSubmit={e => { e.preventDefault(); send(text); }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Type an answer for the agent..." />
        <button className="btn primary" disabled={sending || !text.trim()}>Send answer</button>
      </form>
      {err && <div className="err small">{err}</div>}
    </div>
  );
}

export function RelayBox({ callId, disabled }: { callId?: string; disabled: boolean }) {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const send = async () => {
    if (!callId || !text.trim()) return;
    try { await api.relay(callId, text.trim()); setMsg("Queued: the agent will say this at its next turn."); setText(""); }
    catch (e) { setMsg((e as Error).message); }
    setTimeout(() => setMsg(null), 4000);
  };
  return (
    <form className="relay" onSubmit={e => { e.preventDefault(); send(); }}>
      <label>Tell the agent to say...</label>
      <div className="row">
        <input value={text} disabled={disabled || !callId} onChange={e => setText(e.target.value)}
          placeholder={disabled ? "Call has ended" : callId ? "e.g. Dr. Park is available for a peer-to-peer today after 3pm" : "Waiting for call to connect..."} />
        <button className="btn primary" disabled={disabled || !callId || !text.trim()}>Relay</button>
      </div>
      {msg && <div className="muted small">{msg}</div>}
    </form>
  );
}

export function SimBox({ callId }: { callId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const send = async (t: string) => {
    if (!t.trim()) return;
    try { await api.simReply(callId, t.trim()); setText(""); } catch { /* ignore */ }
  };
  return (
    <div className="simbox">
      <button className="linkbtn" onClick={() => setOpen(o => !o)}>{open ? "▾" : "▸"} Simulate Aetna rep (rehearsal mode)</button>
      {open && (
        <form className="row" onSubmit={e => { e.preventDefault(); send(text); }}>
          <input value={text} onChange={e => setText(e.target.value)} placeholder="Say something as the Aetna rep..." />
          <button className="btn">Send</button>
          <button type="button" className="btn danger" onClick={() => send("[hangup]")}>Hang up</button>
        </form>
      )}
    </div>
  );
}
