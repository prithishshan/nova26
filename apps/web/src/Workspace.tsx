import { useCallback, useEffect, useRef, useState } from "react";
import type { Errand, ErrandEvent, PatientCase, PolicyTreeNode } from "@nova26/shared";
import { ORG } from "@nova26/shared";
import { api, type Health } from "./api";
import { usd } from "./format";
import { OutcomeSummaryCard, OutcomesTab, securedCount } from "./Outcomes";
import { AppealTab, CallTab, ChartTab, DenialTab, PolicyTab } from "./Tabs";
import DisputeCard from "./Dispute";
import ReasoningTrace, { deriveSteps, policyLabel } from "./Reasoning";

type Tab = "denial" | "chart" | "policy" | "appeal" | "call" | "outcomes";
type Busy = null | "ingest" | "chart" | "analyze" | "call" | "reset";

const ANALYZE_MSGS = [
  "Loading Aetna Clinical Policy Bulletin 0341 (infliximab)...",
  "Extracting coverage criteria for the indication...",
  "Matching chart evidence to each criterion...",
  "Checking conventional-therapy history (steroids, immunomodulators)...",
  "Grounding every citation to a policy section...",
  "Computing appeal readiness...",
  "Drafting the appeal letter for Dr. Park's signature...",
];

export const STAGE_LABEL: Record<PatientCase["stage"], string> = {
  start: "New denial", chart: "Chart pulled", docs: "Denial ingested", analyzed: "Awaiting approval", calling: "Calling Aetna", done: "Awaiting decision",
};

export default function Workspace({ health, onBack }: { health: Health | null; onBack: () => void }) {
  const [c, setC] = useState<PatientCase | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [events, setEvents] = useState<ErrandEvent[]>([]);
  const [errand, setErrand] = useState<Errand | null>(null);
  const seqRef = useRef(0);
  const [tab, setTab] = useState<Tab>("denial");
  const [hl, setHl] = useState<string[] | null>(null);
  const pulledAt = useRef<string | undefined>(undefined);
  const prev = useRef<{ stage?: string; analyzed?: boolean; chart?: boolean; denial?: boolean; outcome?: boolean; init?: boolean }>({});

  // Pick the tab on first load; auto-switch on analysis completion / call start.
  useEffect(() => {
    if (!c) return;
    if (c.chartConnected && !pulledAt.current) pulledAt.current = new Date().toISOString();
    const analyzed = !!c.analysis?.denial;
    const p = prev.current;
    if (!p.init) {
      setTab(c.outcome ? "outcomes" : c.stage === "calling" || c.stage === "done" ? "call" : analyzed ? "appeal" : "denial");
    } else {
      if (c.stage === "calling" && p.stage !== "calling") setTab("call");
      else if (c.outcome && !p.outcome) setTab("outcomes");
      else if (analyzed && !p.analyzed) setTab("appeal");
      else if (c.chartConnected && !p.chart) setTab("chart");
      else if (c.denialLetter && !p.denial) setTab("denial");
    }
    prev.current = { stage: c.stage, analyzed, chart: c.chartConnected, denial: !!c.denialLetter, outcome: !!c.outcome, init: true };
  }, [c]);

  useEffect(() => {
    api.getCase().then(r => setC(r.case)).catch(e => setLoadErr((e as Error).message));
  }, []);

  // Poll errand events while a call exists
  const errandId = c?.errandId;
  useEffect(() => {
    setEvents([]); setErrand(null); seqRef.current = 0;
    if (!errandId) return;
    let alive = true;
    let inflight = false;
    const tick = async () => {
      if (inflight) return;
      inflight = true;
      try {
        const r = await api.events(errandId, seqRef.current);
        if (!alive) return;
        if (r.events.length) {
          seqRef.current = Math.max(seqRef.current, ...r.events.map(e => e.seq));
          setEvents(prev => {
            const seen = new Set(prev.map(e => e.seq));
            return [...prev, ...r.events.filter(e => !seen.has(e.seq))].sort((a, b) => a.seq - b.seq);
          });
        }
        setErrand(r.errand);
      } catch { /* transient */ } finally { inflight = false; }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(t); };
  }, [errandId]);

  // Poll the case while calling (callOutcome / stage=done)
  const stage = c?.stage;
  useEffect(() => {
    if (stage !== "calling") return;
    const t = setInterval(() => { api.getCase().then(r => setC(r.case)).catch(() => {}); }, 2500);
    return () => clearInterval(t);
  }, [stage]);

  // Analyze progress ticker
  useEffect(() => {
    if (busy !== "analyze") return;
    const start = Date.now();
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - start) / 1000);
      setProgress(`${ANALYZE_MSGS[Math.min(ANALYZE_MSGS.length - 1, Math.floor(s / 4))]} (${s}s)`);
    }, 500);
    return () => clearInterval(t);
  }, [busy]);

  const runAgent = useCallback(async () => {
    if (!c) return;
    setErr(null);
    let cur = c;
    try {
      if (!cur.denialLetter) {
        setBusy("ingest"); setProgress("Ingesting Aetna prior-auth determination letter...");
        cur = (await api.ingestDenial()).case; setC(cur);
      }
      if (!cur.chartConnected) {
        setBusy("chart"); setProgress("Pulling patient chart from Epic (FHIR)...");
        cur = (await api.pullChart()).case; setC(cur);
      }
      if (!cur.analysis?.denial) {
        setBusy("analyze"); setProgress(ANALYZE_MSGS[0]);
        cur = (await api.analyze()).case; setC(cur);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null); setProgress("");
    }
  }, [c]);

  const approveAndCall = async () => {
    setErr(null); setBusy("call"); setProgress("Placing call to Aetna provider services...");
    try { const r = await api.callPayer(); setC(r.case); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); setProgress(""); }
  };

  const reset = async () => {
    if (!confirm("Reset the demo case to the beginning?")) return;
    setErr(null); setBusy("reset");
    try { const r = await api.reset(); setC(r.case); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); setProgress(""); }
  };

  if (loadErr) return <div className="panel pad"><h2>Could not load case</h2><p className="muted">{loadErr}</p><button className="btn" onClick={onBack}>Back to operations</button></div>;
  if (!c) return <div className="panel pad muted">Loading case...</div>;

  const resultEvent = [...events].reverse().find(e => e.type === "result") as Extract<ErrandEvent, { type: "result" }> | undefined;
  const outcome = resultEvent?.outcome ?? c.callOutcome;
  const steps = deriveSteps(c, events);
  const thinking = busy && busy !== "reset" ? progress : undefined;
  const d = c.analysis?.denial;
  const ch = c.chart;
  const countLeaves = (n?: PolicyTreeNode): number => !n ? 0 : (n.children?.length ? n.children.reduce((s, k) => s + countLeaves(k), 0) : n.inScope && !n.notApplicable ? 1 : 0);
  const tabs: { key: Tab; label: string; count?: number | string }[] = [
    { key: "denial", label: "Denial letter", count: c.denialLetter ? 1 : undefined },
    { key: "chart", label: "Patient chart", count: ch ? ch.conditions.length + ch.medications.length + ch.observations.length + ch.noteExcerpts.length : undefined },
    { key: "policy", label: `Aetna policy${policyLabel(c) ? ` · ${policyLabel(c).replace(/^\S+\s/, "")}` : ""}`, count: d ? (d.policyTree ? countLeaves(d.policyTree) : d.criteria.filter(x => !x.notApplicable).length) : (c.policyPreview ? countLeaves(c.policyPreview.tree) : undefined) },
    { key: "appeal", label: "Appeal draft", count: d ? (d.letterCitations?.length ?? "1") : undefined },
    { key: "call", label: "Live call", count: c.errandId ? events.filter(e => e.type === "transcript").length : undefined },
    { key: "outcomes", label: "Outcomes", count: c.outcome ? securedCount(c.outcome) : undefined },
  ];

  return (
    <div className="workspace">
      <div className="objhead">
        <div className="objhead-top">
          <div>
            <div className="crumb"><a onClick={onBack}>OPERATIONS</a> / CASE</div>
            <div className="objtitle">
              <span className="objtype">PA DENIAL</span>
              <span className="mono">{c.denialLetter?.referenceNumber ?? "pending ingest"}</span>
              <span className={`tag stage-${c.stage}`}>{STAGE_LABEL[c.stage]}</span>
            </div>
          </div>
          <dl className="props inline">
            <Prop k="Patient" v={c.patient.name} />
            <Prop k="Payer" v={c.patient.payer} />
            <Prop k="Service" v={`${c.denialLetter?.service ?? "Remicade (infliximab)"} · ${c.denialLetter?.code ?? "J1745"}`} />
            <Prop k="Amount" v={usd(4860)} mono />
          </dl>
          <div className="actions">
            <button className="btn" onClick={reset} disabled={busy !== null}>↺ Reset demo</button>
            <button className="btn" onClick={onBack}>← Operations</button>
          </div>
        </div>
      </div>

      <Pipeline c={c} busy={busy} />
      {err && <div className="alert">Error: {err}</div>}

      <div className="grid-tabs">
        <div className="tabpanel panel">
          <div className="tabbar">
            {tabs.map(t => (
              <button key={t.key} className={`tabbtn ${tab === t.key ? "on" : ""} ${t.key === "call" && c.stage === "calling" ? "livetab" : ""}`} onClick={() => setTab(t.key)}>
                {t.label}{t.count !== undefined && <span className="tcount mono">{t.count}</span>}
              </button>
            ))}
          </div>
          <div className="tabbody">
            {tab === "denial" && <DenialTab c={c} />}
            {tab === "chart" && <ChartTab c={c} hl={hl} pulledAt={pulledAt.current} />}
            {tab === "policy" && <PolicyTab c={c} onHl={setHl} />}
            {tab === "appeal" && <AppealTab c={c} onHl={setHl} />}
            {tab === "call" && <CallTab c={c} events={events} errand={errand} health={health} />}
            {tab === "outcomes" && <OutcomesTab c={c} />}
          </div>
        </div>
        <div className="col rail-right">
          <OutcomeSummaryCard c={c} onView={() => setTab("outcomes")} />
          <ActionCard c={c} busy={busy} onRun={runAgent} onApprove={approveAndCall} />
          <ReasoningTrace steps={steps} thinking={thinking} />
        </div>
      </div>
    </div>
  );
}

function Prop({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div className="prop"><dt>{k}</dt><dd className={mono ? "mono" : ""}>{v}</dd></div>;
}

// ---------------- Slim horizontal pipeline ----------------
function Pipeline({ c, busy }: { c: PatientCase; busy: Busy }) {
  const d = c.analysis?.denial;
  const calling = c.stage === "calling";
  const done = c.stage === "done";
  const steps: { label: string; state: "done" | "active" | "waiting" | "todo" }[] = [
    { label: "Ingest denial", state: c.denialLetter ? "done" : busy === "ingest" ? "active" : "todo" },
    { label: "Pull chart from Epic", state: c.chartConnected ? "done" : busy === "chart" ? "active" : "todo" },
    { label: "Check criteria vs Aetna policy", state: d ? "done" : busy === "analyze" ? "active" : "todo" },
    { label: "Draft appeal", state: d?.appealLetter ? "done" : busy === "analyze" ? "active" : "todo" },
    { label: "Call Aetna", state: done ? "done" : calling || busy === "call" ? "active" : d ? "waiting" : "todo" },
    { label: "Aetna decision (written appeal + peer-to-peer)", state: done ? "active" : "todo" },
  ];
  return (
    <ol className="hpipe">
      {steps.map((s, i) => (
        <li key={i} className={`hstep ${s.state}`}>
          <span className="hnum mono">{s.state === "done" ? "✓" : i + 1}</span>
          <span>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

// ---------------- Action card (run / approve) ----------------
function ActionCard({ c, busy, onRun, onApprove }: { c: PatientCase; busy: Busy; onRun: () => void; onApprove: () => void }) {
  const d = c.analysis?.denial;
  if (d && c.stage === "analyzed") {
    const met = d.criteria.filter(x => !x.notApplicable && x.status === "met").length;
    return (
      <section className="panel hitl">
        <div className="hitl-title">Supervisor approval required</div>
        {d.dispute && (
          <div className="hitl-verdict">
            <div className="hitl-vrow"><span className="hitl-k">AETNA SAYS</span> {d.dispute.claims.map(x => x.aetnaClaim).join("; ")} <b>not documented</b></div>
            <div className="hitl-vrow"><span className="hitl-k">CHART SHOWS</span> {d.dispute.claims.every(x => x.chartStatus === "met") ? <b className="hitl-met">documented (met)</b> : "not fully documented"}</div>
            <div className="hitl-vline">{d.dispute.contradicted ? "≠ Contradiction found: appeal and call are justified." : "Chart does not fully answer the denial."} <span className="muted">Details in Appeal draft.</span></div>
          </div>
        )}
        <p>Appeal drafted citing {met} criteria · readiness {Math.round(d.readinessPct)}% · verdict <b>{d.verdict}</b>. Approve to let the agent call Aetna, open an expedited appeal, and book a peer-to-peer for Dr. Park.</p>
        <button className="btn primary block big" onClick={onApprove} disabled={busy !== null}>
          {busy === "call" ? "Placing call..." : "Approve & call Aetna"}
        </button>
      </section>
    );
  }
  if (!d) {
    return (
      <section className="panel">
        <button className="btn primary block big flat" onClick={onRun} disabled={busy !== null}>
          {busy ? "Agent working..." : "Run agent"}
        </button>
      </section>
    );
  }
  return null;
}

