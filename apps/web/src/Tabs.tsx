import PolicyFlow from "./PolicyFlow";
import DisputeCard from "./Dispute";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DenialDispute, CallStatus, Errand, ErrandEvent, LetterCitation, PatientCase, PolicyTreeNode } from "@nova26/shared";
import { ORG } from "@nova26/shared";
import type { Health } from "./api";
import { fmtDate, fmtTime } from "./format";
import { NeedsHuman, RelayBox, SimBox, useCallState } from "./LiveCall";
import { policyLabel } from "./Reasoning";

// ---------------- highlight helpers ----------------
const STOP = new Set(["clinic", "note", "notes", "patient", "with", "from", "this", "that", "which", "policy", "chart", "documented", "documentation", "therapy", "after", "before", "their", "there", "about", "other", "within", "least"]);
export function keyTerms(s: string | undefined): string[] {
  if (!s) return [];
  const dates = s.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  const words = (s.toLowerCase().match(/[a-z][a-z0-9-]{4,}/g) ?? []).filter(w => !STOP.has(w));
  return [...new Set([...dates, ...words])];
}
export function matches(text: string, terms: string[] | null): boolean {
  if (!terms || !terms.length) return false;
  const t = text.toLowerCase();
  if (terms.some(x => /^\d{4}-/.test(x) && t.includes(x))) return true;
  const hits = terms.filter(x => !/^\d{4}-/.test(x) && t.includes(x)).length;
  return hits >= Math.min(2, terms.filter(x => !/^\d{4}-/.test(x)).length) && hits > 0;
}

function DocIcon() {
  return <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><path fill="currentColor" d="M3 1h7l3 3v11H3zm1 1v12h8V5H9V2zm6 .4V4h1.6z" /></svg>;
}
function Attachment({ name, meta }: { name: string; meta: string }) {
  return <div className="attach"><DocIcon /><span className="attach-name mono">{name}</span><span className="muted">· {meta}</span></div>;
}

// ---------------- 1. Denial letter ----------------
export function DenialTab({ c }: { c: PatientCase }) {
  const L = c.denialLetter;
  if (!L) return <Empty>Denial not ingested yet. Run the agent to ingest Aetna's determination letter.</Empty>;
  return (
    <div className="doc-wrap">
      <Attachment name={`Aetna_PA_Determination_${L.referenceNumber}.pdf`} meta={`received ${fmtDate(L.date)}`} />
      <article className="paper">
        <div className="paper-head">
          <div className="paper-from">{L.from}</div>
          <div className="paper-sub">Prior Authorization Determination</div>
        </div>
        <dl className="paper-meta">
          <dt>Date</dt><dd>{fmtDate(L.date)}</dd>
          <dt>To</dt><dd>{L.requestedBy}</dd>
          <dt>Member</dt><dd>{c.patient.name} · ID {c.patient.memberId}</dd>
          <dt>Re</dt><dd>{L.service} ({L.code}) · Reference {L.referenceNumber}</dd>
        </dl>
        <p className="paper-decision">Decision: {L.decision}</p>
        <p>{L.reason}</p>
        <h4>Your appeal rights</h4>
        <p>{L.appealRights}</p>
      </article>
    </div>
  );
}

// ---------------- 2. Patient chart ----------------
export function ChartTab({ c, hl, pulledAt }: { c: PatientCase; hl: string[] | null; pulledAt?: string }) {
  const ch = c.chart;
  const [open, setOpen] = useState<Set<number>>(new Set());
  if (!ch) return <Empty>Chart not pulled yet.</Empty>;
  const Sec = ({ title, items }: { title: string; items: string[] }) => !items.length ? null : (
    <section className="csec">
      <div className="seclabel">{title} <span className="mono muted">{items.length}</span></div>
      <ul className="citems">{items.map((x, i) => <li key={i} className={matches(x, hl) ? "hl" : ""}>{x}</li>)}</ul>
    </section>
  );
  return (
    <div className="doc-wrap">
      <Attachment name={`Epic · ${ch.name} · MRN ${ch.mrn}`} meta={`pulled ${pulledAt ? fmtTime(pulledAt) : "today"} · FHIR R4`} />
      {hl && <div className="hl-note">Highlighting chart items matching the selected citation</div>}
      <div className="chart-grid">
        <Sec title="Conditions" items={ch.conditions} />
        <Sec title="Medications" items={ch.medications} />
        <Sec title="Labs" items={ch.observations} />
        <Sec title="Procedures & diagnostics" items={[...ch.procedures, ...ch.diagnostics]} />
      </div>
      {ch.noteExcerpts.length > 0 && (
        <section className="csec">
          <div className="seclabel">Notes <span className="mono muted">{ch.noteExcerpts.length}</span></div>
          {ch.noteExcerpts.map((n, i) => {
            const isOpen = open.has(i);
            const hit = matches(`${n.title} ${n.date} ${n.text}`, hl);
            return (
              <div key={i} className={`cnote ${hit ? "hl" : ""}`}>
                <button className="cnote-head" onClick={() => setOpen(s => { const x = new Set(s); if (x.has(i)) x.delete(i); else x.add(i); return x; })}>
                  <span>{isOpen ? "▾" : "▸"} {n.title}</span><span className="mono muted">{n.date}</span>
                </button>
                {(isOpen || hit) && <div className="cnote-body">{n.text}</div>}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

// ---------------- 3. Policy tree ----------------
const GATE: Record<string, (n?: number) => string> = {
  all_of: () => "ALL OF", any_of: () => "ANY OF", n_of: n => `${n ?? "N"} OF`, judgment: () => "JUDGMENT",
};

export function PolicyTab({ c, onHl, library }: { c: PatientCase; onHl: (t: string[] | null) => void; library?: boolean }) {
  const d = c.analysis?.denial;
  const pv = c.policyPreview;
  const meta = d?.policy ?? pv?.policy;
  if (!meta) return <Empty>No payer policy attached to this case.</Empty>;
  const pl = policyLabel(c);
  const tree = d?.policyTree ?? pv?.tree;
  const head = (
    <div className="policy-head">
      <div>
        <div className="seclabel" style={{ margin: 0 }}>{pl}{!d && !library && " · attached · not yet evaluated"}</div>
        <div className="policy-title">{meta.title}{pv?.indication ? ` · ${pv.indication} branch` : ""}</div>
      </div>
      {meta.sourceUrl && <a href={meta.sourceUrl} target="_blank" rel="noreferrer" className="mono small">source ↗</a>}
    </div>
  );
  if (!tree && d) {
    return (
      <div className="doc-wrap">
        {head}
        <ul className="ptree">
          {d.criteria.map(cr => (
            <TreeNode key={cr.id} depth={0} onHl={onHl} node={{ id: cr.id, kind: "leaf", label: cr.label, inScope: !cr.notApplicable, status: cr.status, notApplicable: cr.notApplicable, quote: cr.policyQuote, sectionPath: cr.sectionPath, evidence: cr.evidence, disputed: cr.disputed }} />
          ))}
        </ul>
      </div>
    );
  }
  if (!tree) return <Empty>No payer policy attached to this case.</Empty>;
  return <PolicyViews tree={tree} head={head} onHl={onHl} dispute={library ? undefined : d?.dispute} drug={c.denialLetter?.service?.split(",")[0] ?? (library ? meta.title.replace(/^.*CPB \d+\s*/, "") || undefined : undefined)} library={library} />;
}

// Decision chart (default) or the raw compiled tree — same data, two readings.
function PolicyViews({ tree, head, onHl, drug, library, dispute }: { dispute?: DenialDispute; tree: PolicyTreeNode; head: ReactNode; onHl: (t: string[] | null) => void; drug?: string; library?: boolean }) {
  const [mode, setMode] = useState<"flow" | "tree">("flow");
  return (
    <div className="doc-wrap">
      {head}
      <div className="seg">
        <button className={mode === "flow" ? "on" : ""} onClick={() => setMode("flow")}>Decision chart</button>
        <button className={mode === "tree" ? "on" : ""} onClick={() => setMode("tree")}>Compiled tree</button>
      </div>
      {mode === "flow" ? <PolicyFlow tree={tree} onHl={onHl} drug={drug} library={library} dispute={dispute} /> : <RawTree tree={tree} onHl={onHl} />}
    </div>
  );
}

function RawTree({ tree, onHl }: { tree: PolicyTreeNode; onHl: (t: string[] | null) => void }) {
  const kids = tree.children ?? [];
  const inScope = kids.filter(k => k.inScope);
  const out = kids.filter(k => !k.inScope);
  return (
    <>
      <div className="pnode-root"><span className="gate mono">{GATE[tree.kind]?.(tree.n) ?? tree.kind.toUpperCase()}</span><span>{tree.label}</span></div>
      <ul className="ptree">
        {inScope.map(k => <TreeNode key={k.id} node={k} depth={0} onHl={onHl} />)}
        {out.length > 0 && <OtherIndications nodes={out} onHl={onHl} />}
      </ul>
    </>
  );
}

function OtherIndications({ nodes, onHl }: { nodes: PolicyTreeNode[]; onHl: (t: string[] | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="pnode dim">
      <button className="prow" onClick={() => setOpen(o => !o)}>
        <span className="caret">{open ? "▾" : "▸"}</span><span>Other indications</span><span className="mono muted small">{nodes.length} branches · out of scope</span>
      </button>
      {open && <ul className="ptree">{nodes.map(k => <TreeNode key={k.id} node={k} depth={1} onHl={onHl} />)}</ul>}
    </li>
  );
}

function TreeNode({ node, depth, onHl }: { node: PolicyTreeNode; depth: number; onHl: (t: string[] | null) => void }) {
  const isLeaf = node.kind === "leaf" || !node.children?.length;
  const [open, setOpen] = useState(node.inScope);
  const dim = !node.inScope || node.notApplicable;
  if (isLeaf) {
    const icon = node.notApplicable ? "–" : node.status === "met" ? "✓" : node.status === "unmet" ? "✕" : node.status === "unknown" ? "?" : "·";
    return (
      <li className={`pnode leaf ${dim ? "dim" : ""} ${node.status && !node.notApplicable ? `c-${node.status}` : ""}`}>
        <button className="prow" onClick={() => { setOpen(o => !o); onHl(!open ? keyTerms(node.evidence) : null); }}>
          <span className="licon">{icon}</span>
          <span className="plabel">{node.label}</span>
          {node.notApplicable && <span className="tag na">N/A</span>}
          {node.disputed && <span className="tag disputed">AETNA'S DENIAL REASON</span>}
          {node.kind === "judgment" && <span className="gate mono">JUDGMENT</span>}
          {node.sectionPath && <span className="mono sect">§{node.sectionPath}</span>}
        </button>
        {open && node.inScope && (node.quote || node.evidence) && (
          <div className="pdetail">
            {node.quote && <div><span className="k">POLICY</span>“{node.quote}”</div>}
            {node.evidence && <div><span className="k">CHART</span>{node.evidence}</div>}
          </div>
        )}
      </li>
    );
  }
  return (
    <li className={`pnode ${dim ? "dim" : ""}`}>
      <button className="prow" onClick={() => setOpen(o => !o)}>
        <span className="caret">{open ? "▾" : "▸"}</span>
        <span className="gate mono">{GATE[node.kind]?.(node.n) ?? node.kind.toUpperCase()}</span>
        <span className="plabel">{node.label}</span>
      </button>
      {open && <ul className="ptree">{node.children!.map(k => <TreeNode key={k.id} node={k} depth={depth + 1} onHl={onHl} />)}</ul>}
    </li>
  );
}

// ---------------- 4. Appeal draft ----------------
export function AppealTab({ c, onHl }: { c: PatientCase; onHl: (t: string[] | null) => void }) {
  const d = c.analysis?.denial;
  const [active, setActive] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const cites = d?.letterCitations ?? [];
  const byMarker = useMemo(() => new Map(cites.map(x => [x.marker, x])), [cites]);
  const cur = pinned ?? active;
  useEffect(() => { const ci = cur ? byMarker.get(cur) : undefined; onHl(ci ? keyTerms(ci.chart) : null); }, [cur, byMarker, onHl]);
  if (!d) return <Empty>No appeal drafted yet.</Empty>;
  const parts = d.appealLetter.split(/(\[\d+\])/g);
  const copy = async () => { try { await navigator.clipboard.writeText(d.appealLetter); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } };
  return (
    <div className="doc-wrap">
      {d.dispute && <DisputeCard dispute={d.dispute} />}
      <div className="doc-toolbar">
        <Attachment name={`Expedited_Appeal_${c.denialLetter?.referenceNumber ?? "draft"}.docx`} meta={`draft for ${ORG.orderingProvider.name} · ${cites.length} citations`} />
        <button className="btn sm" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <article className="paper letter-paper">
        {parts.map((p, i) => {
          const m = p.match(/^\[(\d+)\]$/);
          if (!m) return <span key={i}>{p}</span>;
          const ci = byMarker.get(m[1]);
          return (
            <span key={i} className="cite-wrap" onMouseEnter={() => setActive(m[1])} onMouseLeave={() => setActive(null)}>
              <sup className={`cmark ${cur === m[1] ? "on" : ""}`} onClick={() => setPinned(x => (x === m[1] ? null : m[1]))}>{m[1]}</sup>
              {cur === m[1] && ci && <CitePop ci={ci} />}
            </span>
          );
        })}
        {cites.length > 0 && (
          <footer className="sources">
            <div className="sources-title">Sources</div>
            <ol>
              {cites.map(ci => (
                <li key={ci.marker} className={cur === ci.marker ? "on" : ""} onMouseEnter={() => setActive(ci.marker)} onMouseLeave={() => setActive(null)}>
                  <span className="smark">[{ci.marker}]</span>
                  <div>{ci.chart && <div><b>Chart:</b> {ci.chart}</div>}{ci.policy && <div><b>Policy:</b> {ci.policy}</div>}</div>
                </li>
              ))}
            </ol>
          </footer>
        )}
      </article>
    </div>
  );
}

function CitePop({ ci }: { ci: LetterCitation }) {
  return (
    <span className="cpop">
      <span className="cpop-k">SOURCE [{ci.marker}]</span>
      {ci.chart && <span className="cpop-row"><b>CHART</b>{ci.chart}</span>}
      {ci.policy && <span className="cpop-row"><b>POLICY</b>{ci.policy}</span>}
    </span>
  );
}

// ---------------- 5. Live call ----------------
const CALL_STEPS: { key: CallStatus; label: string }[] = [
  { key: "dialing", label: "Dialing" }, { key: "ringing", label: "Ringing" }, { key: "in_progress", label: "In progress" },
  { key: "on_hold_for_user", label: "On hold for team" }, { key: "completed", label: "Completed" },
];

export function CallTab({ c, events, errand, health }: { c: PatientCase; events: ErrandEvent[]; errand: Errand | null; health: Health | null }) {
  const { callStatus, callId, ended, pending, markAnswered } = useCallState(c, events, errand);
  const scrollRef = useRef<HTMLDivElement>(null);
  const feed = events.filter(e => e.type === "transcript" || e.type === "answer" || e.type === "error" || e.type === "question");
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [feed.length]);
  if (!c.errandId) return <Empty>No call yet. After the appeal is drafted, a supervisor approves the agent to call Aetna.</Empty>;

  // Map each agent transcript line to the reasoning event immediately preceding it.
  const why = new Map<number, Extract<ErrandEvent, { type: "reasoning" }>>();
  let lastR: Extract<ErrandEvent, { type: "reasoning" }> | null = null;
  for (const e of events) {
    if (e.type === "reasoning") lastR = e;
    else if (e.type === "transcript" && e.speaker === "agent") { if (lastR) why.set(e.seq, lastR); lastR = null; }
  }
  const activeIdx = callStatus ? CALL_STEPS.findIndex(s => s.key === callStatus) : -1;
  const failed = callStatus === "failed" || callStatus === "no_answer";

  return (
    <div className="calltab">
      <div className="call-top">
        <div className="lc-label"><span className={`sdot ${ended ? "idle" : "live"}`} />{!ended && <span className="live">LIVE</span>}AETNA PROVIDER SERVICES · EXPEDITED APPEAL {callId && <span className="mono muted">{callId}</span>}</div>
        <ol className="callsteps">
          {CALL_STEPS.map((s, i) => {
            const st = failed ? "todo" : i < activeIdx || callStatus === "completed" ? "done" : i === activeIdx ? "active" : "todo";
            return <li key={s.key} className={`cstep ${st}`}><span className="cdot" />{s.label}</li>;
          })}
          {failed && <li className="cstep failed"><span className="cdot" />{callStatus === "no_answer" ? "No answer" : "Call failed"}</li>}
        </ol>
      </div>
      <div className="transcript" ref={scrollRef}>
        {feed.length === 0 && <div className="muted center pad">{callStatus ? "Waiting for the conversation to begin..." : "Connecting call..."}</div>}
        {feed.map(e => {
          if (e.type === "transcript") {
            const agent = e.speaker === "agent";
            const r = agent ? why.get(e.seq) : undefined;
            return (
              <div key={e.seq} className={`tline ${agent ? "agent" : "rep"}`}>
                <span className="ts mono">{fmtTime(e.at)}</span>
                <span className="spk mono">{agent ? "AGENT" : "AETNA"}</span>
                <div className="tbody">
                  <div className="txt">{e.text}</div>
                  {r && <Why r={r} />}
                </div>
              </div>
            );
          }
          if (e.type === "question") return <div key={e.seq} className="tline sys warn"><span className="ts mono">{fmtTime(e.at)}</span><span className="spk mono">HOLD</span><div className="txt">Agent asked the team: {e.question.text}</div></div>;
          if (e.type === "answer") return <div key={e.seq} className="tline sys"><span className="ts mono">{fmtTime(e.at)}</span><span className="spk mono">TEAM</span><div className="txt">“{e.text}”</div></div>;
          return <div key={e.seq} className="tline sys err"><span className="ts mono">{fmtTime(e.at)}</span><span className="spk mono">ERROR</span><div className="txt">{(e as { text: string }).text}</div></div>;
        })}
      </div>
      <div className="call-bottom">
        {pending && c.errandId && <NeedsHuman errandId={c.errandId} q={pending} onDone={markAnswered} />}
        {!ended && <RelayBox callId={callId} disabled={ended} />}
        {!ended && health?.callMode === "sim" && callId && <SimBox callId={callId} />}
      </div>
    </div>
  );
}

function Why({ r }: { r: Extract<ErrandEvent, { type: "reasoning" }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="why">
      {r.cites && r.cites.length > 0 && <div className="rcites">{r.cites.map((x, i) => <span key={i} className="cite mono">{x}</span>)}</div>}
      <button className="linkbtn why-btn" onClick={() => setOpen(o => !o)}>{open ? "▾" : "▸"} why</button>
      {open && <div className="why-text">{r.text}</div>}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="empty muted">{children}</div>;
}

