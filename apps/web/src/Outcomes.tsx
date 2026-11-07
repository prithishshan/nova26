// What the payer call secured. The call opens the case; Aetna decides on the written appeal + peer-to-peer.
import { useState } from "react";
import type { CaseOutcome, PatientCase } from "@nova26/shared";

export const securedCount = (o?: CaseOutcome) => o?.items.filter(i => i.status === "secured").length ?? 0;

export function OutcomesTab({ c }: { c: PatientCase }) {
  const o = c.outcome;
  const [done, setDone] = useState<Record<number, boolean>>({});
  return (
    <div className="doc-wrap outcomes">
      <div className="oc-summary">
        {o ? o.summary : c.stage === "done" && c.callOutcome ? c.callOutcome : "No outcome yet — the agent will record what the call secures."}
      </div>

      {o && (
        <>
          <section className="oc-sec">
            <div className="seclabel">What the call secured</div>
            <ul className="oc-items">
              {o.items.map((it, i) => (
                <li key={i} className={`oc-item st-${it.status}`}>
                  <span className="oc-mark">{it.status === "secured" ? "✓" : it.status === "pending" ? "…" : "✕"}</span>
                  <span className="oc-label">{it.label}</span>
                  <span className="oc-value">{it.value || "—"}</span>
                  <span className="oc-status mono">{it.status === "secured" ? "SECURED" : it.status === "pending" ? "PENDING" : "NOT OBTAINED"}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="oc-sec">
            <div className="seclabel">Key facts</div>
            <dl className="oc-facts">
              <Fact k="Appeal type" v={o.appealType} />
              <Fact k="Reference #" v={o.referenceNumber} mono />
              <Fact k="Decision due" v={o.decisionDue} />
              <Fact k="Send written appeal to" v={o.submitTo} mono />
              <Fact k="Peer-to-peer" v={o.peerToPeer} />
              <Fact k="Aetna rep" v={o.repName} />
            </dl>
          </section>

          {o.nextActions.length > 0 && (
            <section className="oc-sec">
              <div className="seclabel">Next actions</div>
              <table className="oc-actions">
                <thead><tr><th>Owner</th><th>Action</th><th>Due</th><th className="center">Done</th></tr></thead>
                <tbody>
                  {o.nextActions.map((a, i) => {
                    const isDone = done[i] ?? !!a.done;
                    return (
                      <tr key={i} className={isDone ? "done" : ""}>
                        <td className="oc-owner">{a.owner}</td>
                        <td>{a.action}</td>
                        <td className="mono">{a.due ?? "—"}</td>
                        <td className="center"><input type="checkbox" checked={isDone} onChange={e => setDone(s => ({ ...s, [i]: e.target.checked }))} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      <p className="muted small oc-note">The phone call opens the case. Aetna decides on the written appeal and the peer-to-peer.</p>
    </div>
  );
}

function Fact({ k, v, mono }: { k: string; v: string | null; mono?: boolean }) {
  return <div className="oc-fact"><dt>{k}</dt><dd className={mono ? "mono" : ""}>{v || "—"}</dd></div>;
}

/** Compact right-rail card: summary + jump to the Outcomes tab. */
export function OutcomeSummaryCard({ c, onView }: { c: PatientCase; onView: () => void }) {
  const text = c.outcome?.summary ?? c.callOutcome;
  if (!text) return null;
  return (
    <section className="panel outcome">
      <div className="oc-label">Call result</div>
      <div className="oc-text">{text}</div>
      <button className="btn sm" style={{ marginTop: 10 }} onClick={onView}>View outcomes</button>
    </section>
  );
}
