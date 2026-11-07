// Indication scoping helpers (ported from azure_hackathon src/lib/questionnaire.ts; UI projection stripped).
import { isFact, type PolicyNode, type CompositeNode, type FactNode } from "./policies.js";

const labelOf = (n: PolicyNode): string => (isFact(n) ? (n as FactNode).label : (n as CompositeNode).label ?? "");
const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const GENERIC_GATE = /^(all|any|at least|one|two|three|four|five|none|each) (of )?(the )?following/i;
function isIndicationBranch(n: PolicyNode): boolean {
  if (isFact(n)) return false;
  const lbl = labelOf(n).trim();
  return !!lbl && !GENERIC_GATE.test(lbl);
}

function indicationAnyOf(root: PolicyNode): { any: CompositeNode; rebuild: (branches: PolicyNode[]) => PolicyNode } | null {
  if (isFact(root)) return null;
  const comp = root as CompositeNode;
  if (comp.type === "any_of") {
    return { any: comp, rebuild: (b) => ({ ...comp, children: b.length ? b : comp.children }) };
  }
  if (comp.type === "all_of") {
    const idx = comp.children.findIndex((c) => !isFact(c) && (c as CompositeNode).type === "any_of");
    if (idx < 0) return null;
    const any = comp.children[idx] as CompositeNode;
    return {
      any,
      rebuild: (b) => ({ ...comp, children: comp.children.map((c, i) => (i === idx ? ({ ...any, children: b.length ? b : any.children } as CompositeNode) : c)) }),
    };
  }
  return null;
}

/** Keep General + every indication branch matching `indication`; whole tree if none match. */
export function scopeRoot(root: PolicyNode, indication?: string): PolicyNode {
  if (!indication) return root;
  const loc = indicationAnyOf(root);
  if (!loc) return root;
  const want = norm(indication);
  const matches = loc.any.children.filter((c) => {
    if (!isIndicationBranch(c)) return false;
    const lbl = norm(labelOf(c));
    return lbl.includes(want) || want.includes(lbl);
  });
  if (!matches.length) return root;
  return loc.rebuild(matches);
}

export function indicationOptions(root: PolicyNode): string[] {
  const loc = indicationAnyOf(root);
  if (!loc) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of loc.any.children) {
    if (!isIndicationBranch(c)) continue;
    const lbl = labelOf(c);
    const k = norm(lbl);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(lbl);
    }
  }
  return out;
}

export function inferIndication(root: PolicyNode, conditions: string[]): string | undefined {
  const opts = indicationOptions(root);
  if (!opts.length || !conditions.length) return undefined;
  const condText = norm(conditions.join(" "));
  let best: { label: string; score: number } | undefined;
  for (const label of opts) {
    const words = norm(label).split(" ").filter((w) => w.length > 3);
    const score = words.filter((w) => condText.includes(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { label, score };
  }
  return best?.label;
}
