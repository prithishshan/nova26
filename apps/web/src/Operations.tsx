import { useEffect, useState } from "react";
import type { PatientCase, WorklistItem } from "@nova26/shared";
import { api } from "./api";
import { ACTIVE_STATUSES, STATUS_LABEL, fmtDate, usd } from "./format";
import { STAGE_LABEL } from "./Workspace";

export function StatusChip({ status }: { status: WorklistItem["status"] }) {
  return <span className={`chip st-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export default function Operations({ onOpenHero }: { onOpenHero: () => void }) {
  const [hero, setHero] = useState<WorklistItem | null>(null);
  const [c, setC] = useState<PatientCase | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [w, cr] = await Promise.all([api.worklist(), api.getCase()]);
        if (!alive) return;
        setHero(w.items.find(i => i.isHero) ?? null);
        setC(cr.case);
        setErr(null);
      } catch (e) { if (alive) setErr((e as Error).message); }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const app = c?.analysis?.denial?.criteria.filter(x => !x.notApplicable);
  const met = app?.filter(x => x.status === "met").length;

  return (
    <div className="ops">
      <div className="page-head">
        <div>
          <h1>Agent Operations</h1>
          <p>One AI agent working an Aetna prior-auth denial, supervised by the denials team.</p>
        </div>
        {err && <span className="chip st-upheld">Server error: {err}</span>}
      </div>

      <div className="kpis three">
        <div className="kpi"><div className="kpi-label">Denial value</div><div className="kpi-value num">{usd(hero?.amount ?? 4860)}</div></div>
        <div className="kpi accent"><div className="kpi-label">Criteria met</div><div className="kpi-value num">{app ? `${met}/${app.length}` : "—"}</div></div>
        <div className="kpi"><div className="kpi-label">Status</div><div className="kpi-value small-val">{c ? STAGE_LABEL[c.stage] : "—"}</div></div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2><span className="sdot live" />Worklist</h2></div>
        <table className="worklist">
          <thead>
            <tr><th>Patient</th><th>Payer</th><th>Service</th><th className="r">Amount</th><th>Denied</th><th>Status</th><th>Agent activity</th></tr>
          </thead>
          <tbody>
            {hero && (
              <tr className="hero" onClick={onOpenHero}>
                <td><div className="pname"><span className="live">LIVE</span>{hero.patientName}</div><div className="sub">MRN {hero.mrn}</div></td>
                <td>{hero.payer}</td>
                <td><div>{hero.service}</div><div className="sub">{hero.code} · PA denial</div></td>
                <td className="r num">{usd(hero.amount)}</td>
                <td className="num">{fmtDate(hero.deniedOn)}</td>
                <td><StatusChip status={hero.status} /></td>
                <td className="activity">{ACTIVE_STATUSES.includes(hero.status) && <span className="pulse" />}<span>{hero.agentActivity}</span></td>
              </tr>
            )}
            {!hero && <tr><td colSpan={7} className="muted center">{err ? "Server unreachable" : "Loading..."}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
