import { useEffect, useRef, useState } from "react";
import type { ErrandEvent, PatientCase } from "@nova26/shared";
import { fmtTime } from "./format";

export type Step = {
  key: string;
  kind: "read" | "policy" | "criterion" | "verdict" | "wait" | "call" | "live";
  title: string;
  status?: "met" | "unmet" | "unknown";
  detail?: string;
  cites?: string[];
  facts?: { src: "DENIAL LETTER" | "POLICY" | "CHART"; text: string }[];
  at?: string; // real timestamp (call reasoning events)
};

export function policyLabel(c: PatientCase) {
  const pol = c.analysis?.denial?.policy ?? c.policyPreview?.policy;
  if (!pol) return "";
  const pid = /cpb/i.test(pol.policyId) ? pol.policyId : `CPB ${pol.policyId}`;
  return `${pol.payer} ${pid}`;
}

/** Derive the agent's reasoning steps from real case data + call reasoning events. */
export function deriveSteps(c: PatientCase, events: ErrandEvent[]): Step[] {
  const steps: Step[] = [];
  const L = c.denialLetter;
  if (L) steps.push({
    key: "read", kind: "read",
    title: `Read denial: ${L.from.split(/[,(]/)[0].trim() || "Aetna"} says “${L.reason}”`,
    cites: [`ref ${L.referenceNumber}`, L.code],
  });
  if (c.chart) steps.push({
    key: "chart", kind: "read",
    title: `Pulled chart from Epic: ${c.chart.conditions.length} conditions, ${c.chart.medications.length} medications, ${c.chart.noteExcerpts.length} notes`,
    cites: [`MRN ${c.chart.mrn}`],
  });
  const d = c.analysis?.denial;
  if (d) {
    const pl = policyLabel(c);
    steps.push({ key: "policy", kind: "policy", title: `Matched policy: ${pl} · ${d.policy.title}${d.indication ? `, ${d.indication} branch` : ""}`, cites: [pl] });
    for (const cl of d.dispute?.claims ?? []) {
      const ev = cl.chartEvidence.length > 110 ? cl.chartEvidence.slice(0, 109).trimEnd() + "…" : cl.chartEvidence;
      const st = cl.chartStatus === "met" ? "MET" : cl.chartStatus === "unmet" ? "NOT MET" : "NO EVIDENCE";
      steps.push({
        key: `dispute-${cl.criterionId}`, kind: "criterion", status: cl.chartStatus,
        title: `Aetna's denial reason → ${cl.criterionLabel}${cl.chartStatus === "met" ? ": contradicted by the chart" : ": chart " + st.toLowerCase()}`,
        facts: [
          { src: "DENIAL LETTER", text: cl.aetnaClaim },
          { src: "POLICY", text: cl.criterionLabel + (cl.sectionPath ? ` (§${cl.sectionPath})` : "") + (cl.inCompiledPolicy ? "" : " · not in compiled policy, verify") },
          { src: "CHART", text: `${ev || "no supporting evidence"} (${st})` },
        ],
      });
    }
    const app = d.criteria.filter(x => !x.notApplicable);
    for (const cr of app) {
      steps.push({
        key: `cr-${cr.id}`, kind: "criterion", status: cr.status, title: cr.label,
        detail: cr.evidence || "no supporting chart evidence found",
        cites: [`${pl.replace(/^\S+\s/, "")} §${cr.sectionPath}`],
      });
    }
    const met = app.filter(x => x.status === "met").length;
    if (d.dispute?.justification) steps.push({ key: "justification", kind: "verdict", title: `Justification: ${d.dispute.justification}` });
    steps.push({
      key: "verdict", kind: "verdict",
      title: `Verdict: ${d.verdict} (${Math.round(d.readinessPct)}%) — drafting expedited appeal citing ${met} criteria`,
    });
    if (c.stage === "analyzed") steps.push({ key: "wait", kind: "wait", title: "Waiting for supervisor approval to call Aetna" });
    if (c.stage === "calling" || c.stage === "done") steps.push({ key: "approved", kind: "call", title: "Supervisor approved — calling Aetna provider services" });
  }
  for (const e of events) {
    if (e.type === "reasoning") steps.push({ key: `ev-${e.seq}`, kind: "live", title: e.text, cites: e.cites, at: e.at });
  }
  const outText = c.outcome?.summary ?? (c.stage === "done" ? c.callOutcome : undefined);
  if (outText) steps.push({ key: "outcome", kind: "verdict", title: `Call result: ${outText}`, cites: c.outcome?.referenceNumber ? [`ref ${c.outcome.referenceNumber}`] : undefined });
  return steps;
}

export default function ReasoningTrace({ steps, thinking, big }: { steps: Step[]; thinking?: string; big?: boolean }) {
  // Reveal steps one at a time (~600ms) so the audience can follow along.
  const [shown, setShown] = useState(0);
  const times = useRef<Record<string, string>>({});
  useEffect(() => {
    if (shown > steps.length) { setShown(steps.length); return; }
    if (shown === steps.length) return;
    const t = setTimeout(() => setShown(n => n + 1), shown === 0 ? 150 : 600);
    return () => clearTimeout(t);
  }, [shown, steps.length]);
  if (steps.length === 0) times.current = {};
  const visible = steps.slice(0, shown);
  for (const s of visible) if (!times.current[s.key]) times.current[s.key] = s.at ?? new Date().toISOString();

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown, thinking]);

  return (
    <section className={`panel reasoning ${big ? "big" : ""}`}>
      <div className="panel-head"><h2><span className={`sdot ${thinking || shown < steps.length ? "ai" : "idle"}`} />Agent reasoning</h2><span className="mono muted small">{visible.length} STEPS</span></div>
      <div className="rtrace" ref={scrollRef}>
        {steps.length === 0 && !thinking && <div className="muted rempty">The agent's reasoning will appear here once it starts working the case.</div>}
        <ol className="timeline">
          {visible.map(s => (
            <li key={s.key} className={`rstep k-${s.kind} ${s.status ? `c-${s.status}` : ""}`}>
              <div className="rmeta"><span className="tag ai">AGENT</span><span className="mono muted">{fmtTime(times.current[s.key])}</span>{s.kind === "live" && <span className="tag live-tag">ON CALL</span>}</div>
              <div className="rtitle">
                {s.kind === "criterion" && <span className="ricon">{s.status === "met" ? "✓" : s.status === "unmet" ? "✕" : "?"}</span>}
                {s.title}
              </div>
              {s.facts && <div className="rfacts">{s.facts.map((f, i) => <div key={i} className="rfact"><span className="src">{f.src}</span><span>{f.text}</span></div>)}</div>}
              {s.detail && <div className="rdetail"><span className="k">CHART</span>{s.detail}</div>}
              {s.cites && s.cites.length > 0 && <div className="rcites">{s.cites.map((x, i) => <span key={i} className="cite mono">{x}</span>)}</div>}
            </li>
          ))}
          {thinking && (
            <li className="rstep k-thinking">
              <div className="rmeta"><span className="tag ai">AGENT</span><span className="spinner" /></div>
              <div className="rtitle muted">{thinking}</div>
            </li>
          )}
        </ol>
      </div>
    </section>
  );
}
