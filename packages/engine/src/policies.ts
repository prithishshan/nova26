// Runtime policy types + pure tree helpers (ported from azure_hackathon src/lib/policies.ts).

export type Status = "met" | "unmet" | "unknown";

export type Provenance = { quote: string; sectionPath: string; charStart?: number; charEnd?: number };
export type DataRequirement = { description: string; fhirHints: string[] };

export type FactNode = {
  type: "leaf" | "judgment";
  id: string;
  label: string;
  blocking: boolean;
  requirement: DataRequirement;
  provenance: Provenance;
  rationale?: string;
};
export type CompositeNode = {
  type: "all_of" | "any_of" | "n_of";
  id: string;
  label?: string; // short human label for the group (e.g. "Rheumatoid arthritis")
  n?: number;
  children: PolicyNode[];
};
export type PolicyNode = FactNode | CompositeNode;

export type ExceptionClause = {
  id: string;
  label: string;
  waives: string[];
  requirement: DataRequirement;
  provenance: Provenance;
};

export type CompiledPolicy = {
  payer: string;
  policyId: string;
  title: string;
  version: string;
  indication: string;
  codes: string[]; // GOVERNED routing set — codes this policy actually adjudicates
  referencedCodes?: string[]; // codes mentioned (prerequisite drugs, ancillary supplies, comparators) — never route
  root: PolicyNode;
  exceptions: ExceptionClause[];
  sourceUrl?: string | null;
};

export type PolicyMeta = {
  payer: string;
  policyId: string;
  title: string;
  version: string;
  indication: string;
  codes: string[];
  sourceUrl: string | null;
};

// Events streamed from /api/evaluate. The tree (`root`) is sent ONCE, intact, in the
// `policy` event; only per-leaf verdicts stream after it. The boolean gate structure
// is never serialized piecemeal — it's recomputed client-side from these verdicts.
export type StreamEvent =
  | { type: "policy"; policy: PolicyMeta; root: PolicyNode; citation: { label: string; url: string | null } }
  | { type: "assessment"; id: string; status: "met" | "unmet"; rationale: string }
  | { type: "suggestions"; suggestions: { change: string; why: string }[] }
  | { type: "not_applicable"; reason: string; code?: string }
  | { type: "error"; error: string }
  | { type: "done" };

export function isFact(n: PolicyNode): n is FactNode {
  return n.type === "leaf" || n.type === "judgment";
}

/** All fact (leaf/judgment) nodes of a tree, depth-first (with repeats — a shared
 *  criterion can appear under several branches). */
export function flattenLeaves(node: PolicyNode): FactNode[] {
  if (isFact(node)) return [node];
  return node.children.flatMap(flattenLeaves);
}

/** Distinct fact nodes by id — for counting/evaluation so a shared criterion that
 *  gates multiple pathways isn't double-counted or judged twice. */
export function uniqueLeaves(node: PolicyNode): FactNode[] {
  const seen = new Set<string>();
  const out: FactNode[] = [];
  for (const l of flattenLeaves(node)) {
    if (!seen.has(l.id)) {
      seen.add(l.id);
      out.push(l);
    }
  }
  return out;
}

/**
 * Roll a per-leaf status map up to any node, by boolean gate. This is how a
 * composite reports met/unmet/unknown for display — and it's the SOLE arbiter of
 * required-ness (position, not the `blocking` flag).
 */
export function rollup(node: PolicyNode, statusById: Record<string, Status>): Status {
  if (isFact(node)) return statusById[node.id] ?? "unknown";
  const kids = node.children.map((c) => rollup(c, statusById));

  if (node.type === "all_of") {
    if (kids.some((s) => s === "unmet")) return "unmet";
    if (kids.every((s) => s === "met")) return "met";
    return "unknown";
  }
  if (node.type === "any_of") {
    if (kids.some((s) => s === "met")) return "met";
    if (kids.every((s) => s === "unmet")) return "unmet";
    return "unknown";
  }
  // n_of
  const n = node.n ?? 1;
  const met = kids.filter((s) => s === "met").length;
  const notUnmet = kids.filter((s) => s !== "unmet").length; // best-case still reachable
  if (met >= n) return "met";
  if (notUnmet < n) return "unmet"; // can no longer reach the threshold
  return "unknown";
}

/** Rule-based readiness — fraction of leaves met. Transparent placeholder; never
 *  let the LLM emit this number (it would hallucinate false precision). */
export function readiness(root: PolicyNode, statusById: Record<string, Status>) {
  const leaves = uniqueLeaves(root);
  const met = leaves.filter((l) => statusById[l.id] === "met").length;
  const unmet = leaves.filter((l) => statusById[l.id] === "unmet").length;
  const unknown = leaves.length - met - unmet;
  return {
    met,
    unmet,
    unknown,
    total: leaves.length,
    pct: leaves.length ? Math.round((met / leaves.length) * 100) : 0,
    rootStatus: rollup(root, statusById),
  };
}
