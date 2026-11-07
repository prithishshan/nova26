import { useEffect, useState } from "react";
import type { PatientCase, PolicyLibraryItem, PolicyTreeNode } from "@nova26/shared";
import { API_BASE } from "./api";
import { PolicyTab } from "./Tabs";

type Detail = { policy: PolicyLibraryItem; tree: PolicyTreeNode };

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(API_BASE + path);
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json() as Promise<T>;
}

// Payer policy library: compiled, grounded criteria trees the agents adjudicate against.
export default function Policies() {
  const [items, setItems] = useState<PolicyLibraryItem[] | null>(null);
  const [sel, setSel] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getJson<{ policies: PolicyLibraryItem[] }>("/policies")
      .then(r => {
        setItems(r.policies);
        const first = r.policies[0];
        if (first) return getJson<Detail>(`/policies/${encodeURIComponent(first.payer)}/${encodeURIComponent(first.policyId)}`).then(setSel);
      })
      .catch(e => setErr((e as Error).message));
  }, []);

  const open = (p: PolicyLibraryItem) =>
    getJson<Detail>(`/policies/${encodeURIComponent(p.payer)}/${encodeURIComponent(p.policyId)}`).then(setSel).catch(e => setErr((e as Error).message));

  // PolicyTab renders a case's policy; feed it the library tree as an attached, unevaluated policy.
  const asCase = sel ? ({ policyPreview: { policy: { payer: sel.policy.payer, policyId: sel.policy.policyId, title: sel.policy.title, sourceUrl: sel.policy.sourceUrl }, indication: null, tree: sel.tree } } as unknown as PatientCase) : null;

  return (
    <div className="ops">
      <div className="ops-head">
        <h1>Payer Policies</h1>
        <p className="muted">Coverage policies compiled from payer sites into criteria trees. Agents check every chart against these.</p>
      </div>
      {err && <div className="panel" style={{ color: "var(--red)" }}>Couldn't load policies: {err}</div>}

      <div className="panel">
        <div className="panel-head">
          <h2><span className="sdot live" />Policy library</h2>
          <button className="btn" disabled title="Add a payer policy URL to compile (coming soon)">+ Add policy</button>
        </div>
        <table className="worklist">
          <thead>
            <tr><th>Payer</th><th>Policy</th><th>Governs</th><th>Version</th><th>Effective</th><th>Criteria</th><th>Status</th><th>Open cases</th><th>Source</th></tr>
          </thead>
          <tbody>
            {(items ?? []).map(p => (
              <tr key={p.payer + p.policyId} className={`hero ${sel?.policy.policyId === p.policyId ? "selected" : ""}`} onClick={() => open(p)} style={{ cursor: "pointer" }}>
                <td><b>{p.payer}</b></td>
                <td><div><b>{p.title}</b></div><div className="muted small">{p.indication}</div></td>
                <td className="mono small">{p.codes.slice(0, 4).join(" · ")}{p.codes.length > 4 ? ` +${p.codes.length - 4}` : ""}</td>
                <td className="mono">v{p.version}</td>
                <td className="mono small">{p.effectiveStart ?? "—"}</td>
                <td className="mono">{p.criteriaCount}</td>
                <td><span className={`chip ${p.status === "approved" ? "st-overturned" : "st-appeal_drafted"}`}>{p.status}</span></td>
                <td className="mono">{p.usedByCases}</td>
                <td>{p.sourceUrl ? <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="mono small" onClick={e => e.stopPropagation()}>aetna.com ↗</a> : "—"}</td>
              </tr>
            ))}
            {items && items.length === 0 && <tr><td colSpan={9} className="muted">No policies.</td></tr>}
          </tbody>
        </table>
      </div>

      {sel && (
        <div className="panel">
          <div className="panel-head">
            <h2>{sel.policy.payer} {/cpb/i.test(sel.policy.policyId) ? sel.policy.policyId : `CPB ${sel.policy.policyId}`} · compiled criteria tree</h2>
            <span className="mono small muted">{sel.policy.nodeCount} nodes · {sel.policy.criteriaCount} criteria · extracted with {sel.policy.extractionModel ?? "—"}{sel.policy.sourceHash ? ` · source ${sel.policy.sourceHash.slice(0, 10)}` : ""}</span>
          </div>
          <div className="mono small muted" style={{ marginBottom: 8 }}>
            Governed codes: {sel.policy.codes.join(", ")}
            {sel.policy.referencedCodes.length ? ` · referenced only: ${sel.policy.referencedCodes.slice(0, 8).join(", ")}${sel.policy.referencedCodes.length > 8 ? "…" : ""}` : ""}
          </div>
          {asCase && <PolicyTab c={asCase} onHl={() => {}} library />}
        </div>
      )}
    </div>
  );
}
