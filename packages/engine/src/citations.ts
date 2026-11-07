// Policy-tree projection (full tree, in-scope flags + leaf verdicts) and numbered letter citations.
import { isFact, type PolicyNode, type Status } from "./policies.js";

export type PolicyTreeNode = {
  id: string;
  kind: "all_of" | "any_of" | "n_of" | "leaf" | "judgment";
  label: string;
  n?: number;
  inScope: boolean;
  status?: Status;
  notApplicable?: boolean;
  quote?: string;
  sectionPath?: string;
  evidence?: string;
  children?: PolicyTreeNode[];
};

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

function collectIds(n: PolicyNode, out = new Set<string>()): Set<string> {
  out.add(n.id);
  if (!isFact(n)) n.children.forEach((c) => collectIds(c, out));
  return out;
}

/** Convert the FULL compiled tree; nodes inside `scoped` (the adjudicated subtree) are inScope and carry verdicts. */
export function toPolicyTree(
  full: PolicyNode,
  scoped: PolicyNode,
  statusById: Record<string, Status>,
  rationaleById: Record<string, string>,
  notApplicable: Set<string> = new Set(),
): PolicyTreeNode {
  const scopedIds = collectIds(scoped);
  const walk = (n: PolicyNode, parentIn: boolean, isRoot: boolean): PolicyTreeNode => {
    const inScope = isRoot || (parentIn && scopedIds.has(n.id));
    if (isFact(n)) {
      const label = n.label?.trim() || trunc(n.requirement?.description ?? n.id, 120);
      return {
        id: n.id,
        kind: n.type,
        label: trunc(label, 120),
        inScope,
        ...(inScope
          ? {
              status: statusById[n.id] ?? "unknown",
              ...(notApplicable.has(n.id) ? { notApplicable: true } : {}),
              evidence: rationaleById[n.id] ?? "",
            }
          : {}),
        quote: n.provenance?.quote,
        sectionPath: n.provenance?.sectionPath,
      };
    }
    const label =
      n.label?.trim() || (n.type === "any_of" ? "Any of the following" : n.type === "n_of" ? `At least ${n.n ?? 1} of the following` : "All of the following");
    return {
      id: n.id,
      kind: n.type,
      label: trunc(label, 120),
      ...(n.type === "n_of" ? { n: n.n ?? 1 } : {}),
      inScope,
      children: n.children.map((c) => walk(c, inScope, false)),
    };
  };
  return walk(full, true, true);
}

export type EvidenceItem = { marker: string; criterionId?: string; chart?: string; policy?: string };

/** Numbered evidence block for the LLM prompt. */
export function evidenceBlock(items: EvidenceItem[]): string {
  return items
    .map((e) => `[${e.marker}]${e.chart ? ` CHART: ${e.chart}` : ""}${e.policy ? ` | POLICY: ${e.policy}` : ""}`)
    .join("\n");
}

/**
 * Validate markers in the letter: drop numbers that don't resolve, renumber sequentially by first
 * appearance, and return only the citations actually used. Handles "[3]", "[3, 5]", "[3][5]", "[3-5]".
 */
export function resolveCitations(letter: string, items: EvidenceItem[]): { letter: string; citations: EvidenceItem[] } {
  const byMarker = new Map(items.map((e) => [e.marker, e]));
  const remap = new Map<string, string>();
  const citations: EvidenceItem[] = [];
  const out = letter.replace(/\s?\[(\d+(?:\s*[,\-–]\s*\d+)*)\]/g, (_m, inner: string) => {
    const nums: string[] = [];
    for (const part of inner.split(/\s*,\s*/)) {
      const r = part.split(/\s*[-–]\s*/).map(Number);
      if (r.length === 2 && r[1] >= r[0] && r[1] - r[0] < 20) for (let k = r[0]; k <= r[1]; k++) nums.push(String(k));
      else nums.push(String(r[0]));
    }
    const mapped: string[] = [];
    for (const num of nums) {
      const ev = byMarker.get(num);
      if (!ev) continue;
      if (!remap.has(num)) {
        const nm = String(remap.size + 1);
        remap.set(num, nm);
        citations.push({ ...ev, marker: nm });
      }
      const nm = remap.get(num)!;
      if (!mapped.includes(nm)) mapped.push(nm);
    }
    return mapped.length ? " " + mapped.map((m) => `[${m}]`).join("") : "";
  });
  return { letter: out, citations };
}
