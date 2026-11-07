// Decision-chart view of a compiled payer policy: the same tree, read top to bottom as
// "requirements for everyone" → "which condition is it for" → "that condition's requirements".
// Nothing is dropped: every gate keeps its rule (all / at least one / at least N), every leaf keeps
// its policy quote, section and (after evaluation) chart evidence, and every other condition stays expandable.
import { useState } from "react";
import type { DenialDispute, PolicyTreeNode } from "@nova26/shared";
import DisputeCard from "./Dispute";
import { keyTerms } from "./Tabs";

type Hl = (t: string[] | null) => void;

const isGate = (n: PolicyTreeNode) => !!n.children?.length;
const rule = (n: PolicyTreeNode) =>
  n.kind === "any_of" ? "at least one must be met"
  : n.kind === "n_of" ? `at least ${n.n ?? "N"} must be met`
  : n.kind === "judgment" ? "reviewer judgment"
  : "all must be met";

function leafTally(n: PolicyTreeNode): { met: number; unmet: number; unknown: number; na: number; total: number } {
  if (!isGate(n)) {
    const z = { met: 0, unmet: 0, unknown: 0, na: 0, total: 1 };
    if (n.notApplicable) z.na = 1; else if (n.status === "met") z.met = 1; else if (n.status === "unmet") z.unmet = 1; else z.unknown = 1;
    return z;
  }
  return n.children!.map(leafTally).reduce((a, b) => ({ met: a.met + b.met, unmet: a.unmet + b.unmet, unknown: a.unknown + b.unknown, na: a.na + b.na, total: a.total + b.total }));
}

function Badge({ n }: { n: PolicyTreeNode }) {
  if (n.notApplicable) return <span className="pf-badge na">N/A</span>;
  if (n.status === "met") return <span className="pf-badge met">MET</span>;
  if (n.status === "unmet") return <span className="pf-badge unmet">NOT MET</span>;
  if (n.status === "unknown") return <span className="pf-badge unk">NO EVIDENCE</span>;
  return <span className="pf-badge todo">CHECK</span>;
}

function Leaf({ n, onHl }: { n: PolicyTreeNode; onHl: Hl }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`pf-leaf ${n.notApplicable ? "dim" : ""} ${n.status && !n.notApplicable ? `s-${n.status}` : ""}`}>
      <button className="pf-row" onClick={() => { setOpen(o => !o); onHl(!open ? keyTerms(n.evidence) : null); }}>
        <Badge n={n} />{n.disputed && <span className="tag disputed">AETNA'S DENIAL REASON</span>}
        <span className="pf-label">{n.label}</span>
        {n.sectionPath && <span className="pf-sec mono">§{n.sectionPath}</span>}
      </button>
      {open && (
        <div className="pf-detail">
          {n.quote && <div><span className="pf-k">AETNA POLICY</span> “{n.quote}”</div>}
          {n.evidence && <div><span className="pf-k">PATIENT CHART</span> {n.evidence}</div>}
          {!n.quote && !n.evidence && <div className="muted">No quote recorded.</div>}
        </div>
      )}
    </li>
  );
}

// A block of requirements under one gate; nested gates render as indented sub-blocks with their own rule.
function Block({ n, onHl, depth = 0 }: { n: PolicyTreeNode; onHl: Hl; depth?: number }) {
  const leaves = n.children!.filter(k => !isGate(k));
  const gates = n.children!.filter(isGate);
  const applicable = leaves.filter(l => !l.notApplicable);
  const na = leaves.filter(l => l.notApplicable);
  const [showNa, setShowNa] = useState(false);
  return (
    <div className={`pf-block ${depth ? "nested" : ""}`}>
      {depth > 0 && <div className="pf-sub"><span className="pf-rule">{rule(n).toUpperCase()}</span> {n.label}</div>}
      <ul className="pf-list">{applicable.map(l => <Leaf key={l.id} n={l} onHl={onHl} />)}</ul>
      {gates.map(g => <Block key={g.id} n={g} onHl={onHl} depth={depth + 1} />)}
      {na.length > 0 && (
        <div className="pf-na">
          <button className="linkbtn" onClick={() => setShowNa(s => !s)}>{showNa ? "▾" : "▸"} {na.length} rule{na.length > 1 ? "s" : ""} that don't apply to this patient</button>
          {showNa && <ul className="pf-list">{na.map(l => <Leaf key={l.id} n={l} onHl={onHl} />)}</ul>}
        </div>
      )}
    </div>
  );
}

function Step({ num, title, ruleText, tally, children, tone }: { num: number; title: string; ruleText: string; tally?: ReturnType<typeof leafTally>; children: React.ReactNode; tone?: "match" }) {
  const evaluated = tally && tally.unknown < tally.total - tally.na;
  return (
    <section className={`pf-step ${tone ?? ""}`}>
      <header className="pf-step-head">
        <span className="pf-num mono">{num}</span>
        <div className="pf-step-title">
          <div>{title}</div>
          <div className="pf-step-rule">{ruleText}</div>
        </div>
        {tally && (
          <span className="pf-tally mono">
            {evaluated ? `${tally.met}/${tally.total - tally.na} met` : `${tally.total - tally.na} to check`}
            {tally.na ? ` · ${tally.na} N/A` : ""}
          </span>
        )}
      </header>
      <div className="pf-step-body">{children}</div>
    </section>
  );
}

const Arrow = ({ label }: { label: string }) => <div className="pf-arrow"><span>{label}</span></div>;

// Name a branch by the condition its rules sit under in the policy (e.g. "Uveitis"); fall back to the compiled label.
function firstLeaf(n: PolicyTreeNode): PolicyTreeNode { return isGate(n) ? firstLeaf(n.children![0]) : n; }
const GENERIC = /^(all of the following|any of the following|member has|previously received|inadequate response|intolerance|using the requested)/i;
function branchName(b: PolicyTreeNode): string {
  const sec = firstLeaf(b).sectionPath?.split(">").map(x => x.trim()).filter(Boolean) ?? [];
  const cond = [...sec].reverse().find(x => !/^(other|policy|table|criteria|dosage|continuation|initial|appendix)/i.test(x));
  if (GENERIC.test(b.label) && cond) return cond;
  return b.label;
}
const short = (t: string, n = 46) => (t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t);

export default function PolicyFlow({ tree, onHl, drug, library, dispute }: { tree: PolicyTreeNode; onHl: Hl; drug?: string; library?: boolean; dispute?: DenialDispute }) {
  const [openBranch, setOpenBranch] = useState<string | null>(null);
  const top = tree.children ?? [];
  const general: PolicyTreeNode = { ...tree, children: top.filter(k => !isGate(k)) };
  const stages = top.filter(isGate);
  let stepNo = 1;
  const allTally = leafTally(tree);
  const scoped = library ? [] : stages.flatMap(s => s.kind === "any_of" ? s.children!.filter(b => b.inScope) : []);
  const evaluated = allTally.met + allTally.unmet > 0;
  const covered = evaluated && scoped.length > 0 && leafTally({ ...tree, children: [general, ...scoped] }).unmet === 0;

  return (
    <div className="pflow">
      <div className="pf-question">Will Aetna cover {drug ?? "this treatment"}? A patient must pass every step below.</div>
      {dispute && <Step num={0} title="Aetna's stated reason" ruleText="What the denial says is missing, tested against the chart"><DisputeCard dispute={dispute} /></Step>}
      {dispute && <Arrow label="CHECK EVERY RULE" />}

      {general.children!.length > 0 && (
        <Step num={stepNo++} title="Requirements for every patient" ruleText="All must be met" tally={leafTally(general)}>
          <Block n={general} onHl={onHl} />
        </Step>
      )}

      {stages.map(stage => {
        if (stage.kind !== "any_of") {
          // A non-branching gate: show it as its own step.
          return (
            <div key={stage.id}>
              <Arrow label="AND" />
              <Step num={stepNo++} title={stage.label} ruleText={rule(stage)[0].toUpperCase() + rule(stage).slice(1)} tally={leafTally(stage)}>
                <Block n={stage} onHl={onHl} />
              </Step>
            </div>
          );
        }
        // Branching gate: which condition is this for?
        const branches = stage.children!;
        const matched = library ? [] : branches.filter(b => b.inScope);
        const others = branches.filter(b => !matched.includes(b));
        const peek = others.find(b => b.id === openBranch);
        const pickNo = stepNo++;
        return (
          <div key={stage.id}>
            <Arrow label="AND" />
            <Step num={pickNo} title="Which condition is it being used for?" ruleText={`One of ${branches.length} covered uses must match${library ? " · click one to see its rules" : ""}`}>
              <div className="pf-branches">
                {matched.map(b => <span key={b.id} className="pf-branch on">✓ {branchName(b)} <em>this patient</em></span>)}
                {others.map(b => (
                  <button key={b.id} title={b.label} className={`pf-branch ${openBranch === b.id ? "open" : ""}`} onClick={() => setOpenBranch(o => (o === b.id ? null : b.id))}>
                    {short(branchName(b))}<span className="mono"> {isGate(b) ? `${leafTally(b).total} rules` : "1 rule"}</span>
                  </button>
                ))}
              </div>
              {peek && (
                <div className="pf-peek">
                  {isGate(peek) ? (
                    <>
                      <div className="pf-sub"><span className="pf-rule">{rule(peek).toUpperCase()}</span> {peek.label}{library ? "" : " · not this patient's condition"}</div>
                      <Block n={peek} onHl={onHl} depth={0} />
                    </>
                  ) : (
                    <ul className="pf-list"><Leaf n={peek} onHl={onHl} /></ul>
                  )}
                </div>
              )}
            </Step>
            {matched.map(b => (
              <div key={b.id}>
                <Arrow label="THEN" />
                <Step num={stepNo++} title={`${branchName(b)} requirements`} ruleText={rule(b)[0].toUpperCase() + rule(b).slice(1)} tally={leafTally(b)} tone="match">
                  <Block n={b} onHl={onHl} />
                </Step>
              </div>
            ))}
          </div>
        );
      })}

      <Arrow label="RESULT" />
      <div className={`pf-outcome ${!evaluated ? "pending" : covered ? "yes" : "no"}`}>
        {!evaluated ? "Not checked yet. Run the agent to test the chart against every rule."
          : covered ? "Every applicable rule is met: the chart supports coverage."
          : "Some rules are not met or lack evidence."}
      </div>
    </div>
  );
}
