// "Aetna's claim vs. the chart": the agent reasons over three sources (denial letter, Aetna policy,
// patient chart) to show Aetna's stated denial reason is contradicted by evidence in the chart.
import type { DenialDispute } from "@nova26/shared";

export default function DisputeCard({ dispute, compact }: { dispute: DenialDispute; compact?: boolean }) {
  const ok = dispute.contradicted;
  return (
    <section className={`dispute ${compact ? "compact" : ""}`}>
      <div className="dp-head">
        <span className="dp-title">Aetna's claim vs. the chart</span>
        <span className="mono muted small">{dispute.claims.length} claim{dispute.claims.length === 1 ? "" : "s"}</span>
      </div>

      <div className="dp-sources">
        <span className="dp-src"><b>Denial letter</b> → Aetna says…</span>
        <span className="dp-src"><b>Aetna policy</b> → the rule (§…)</span>
        <span className="dp-src"><b>Patient chart</b> → what's documented</span>
      </div>

      {!compact && <blockquote className="dp-reason"><span className="dp-k">DENIAL LETTER · VERBATIM</span>“{dispute.reasonText}”</blockquote>}

      <div className="dp-claims">
        {dispute.claims.map(cl => {
          const contra = cl.chartStatus === "met";
          return (
            <div key={cl.criterionId} className="dp-claim">
              <div className="dp-rule">
                <span className="dp-k">AETNA POLICY</span>
                <span className="dp-rule-label">{cl.criterionLabel}</span>
                {cl.sectionPath && <span className="mono dp-sec">§{cl.sectionPath}</span>}
                {!cl.inCompiledPolicy && <span className="tag dp-verify">Not in compiled policy · verify</span>}
                {!compact && cl.policyQuote && <div className="dp-q">“{cl.policyQuote}”</div>}
              </div>
              <div className="dp-compare">
                <div className="dp-side says">
                  <div className="dp-k">AETNA SAYS <span className="dp-from">· denial letter</span></div>
                  <div className="dp-v">{cl.aetnaClaim}</div>
                </div>
                <div className={`dp-neq ${contra ? "on" : ""}`}>
                  <span className="dp-neq-sym">{contra ? "≠" : "="}</span>
                  <span className="dp-neq-lbl">{contra ? "CONTRADICTION" : cl.chartStatus === "unmet" ? "CONSISTENT" : "UNCLEAR"}</span>
                </div>
                <div className={`dp-side shows s-${cl.chartStatus}`}>
                  <div className="dp-k">
                    THE CHART SHOWS <span className="dp-from">· patient chart</span>
                    <span className={`pf-badge ${contra ? "met" : cl.chartStatus === "unmet" ? "unmet" : "unk"}`}>{contra ? "MET" : cl.chartStatus === "unmet" ? "NOT MET" : "NO EVIDENCE"}</span>
                  </div>
                  <div className="dp-v">{cl.chartEvidence || "No supporting chart evidence found."}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className={`dp-verdict ${ok ? "ok" : "bad"}`}>
        <div className="dp-vline">
          <span className="dp-vicon">{ok ? "✓" : "!"}</span>
          {ok ? "Appeal and call justified: Aetna's stated reason is contradicted by the chart" : "Chart does not fully answer the denial"}
        </div>
        {dispute.justification && <div className="dp-just">{dispute.justification}</div>}
      </div>
    </section>
  );
}
