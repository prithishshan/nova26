// Payer policy library for the supervisor console. Showcases the Aetna policy the demo case routes to.
import type { FastifyInstance } from "fastify";
import type { PolicyLibraryItem, PolicyTreeNode } from "@nova26/shared";
import { allPolicies, toPolicyTree, type CompiledPolicy, type PolicyNode } from "@nova26/engine";
import { DENIAL_LETTER, PATIENT } from "./demo.js";

// Only the Aetna policy behind the demo case is shown for now.
const SHOWCASE = [{ payer: "Aetna", policyId: "0341" }];

const isGate = (n: PolicyNode): n is Extract<PolicyNode, { children: PolicyNode[] }> => Array.isArray((n as { children?: unknown }).children);
function count(n: PolicyNode): { nodes: number; leaves: number } {
  if (!isGate(n)) return { nodes: 1, leaves: 1 };
  return n.children.map(count).reduce((a, b) => ({ nodes: a.nodes + b.nodes, leaves: a.leaves + b.leaves }), { nodes: 1, leaves: 0 });
}

function toItem(p: CompiledPolicy): PolicyLibraryItem {
  const raw = p as CompiledPolicy & Record<string, unknown>;
  const c = count(p.root);
  const usedByCases = p.payer === PATIENT.payer && (p.codes ?? []).includes(DENIAL_LETTER.code) ? 1 : 0;
  return {
    payer: p.payer, policyId: p.policyId, title: p.title, indication: p.indication,
    version: String(p.version), status: String(raw.status ?? "approved"),
    effectiveStart: (raw.effectiveStart as string) ?? null, effectiveEnd: (raw.effectiveEnd as string) ?? null,
    codes: drugFirst(p.codes ?? []), referencedCodes: p.referencedCodes ?? [], sourceUrl: p.sourceUrl ?? null,
    sourceHash: (raw.sourceHash as string) ?? null,
    extractionModel: ((raw.extraction as { model?: string } | undefined)?.model) ?? null,
    criteriaCount: c.leaves, nodeCount: c.nodes, usedByCases,
  };
}

export function stripStatus(n: PolicyTreeNode): PolicyTreeNode {
  const { status: _s, evidence: _e, ...rest } = n;
  return { ...rest, ...(n.children ? { children: n.children.map(stripStatus) } : {}) };
}
const DRUG = /^[JQS]\d/;
const drugFirst = (codes: string[]) => [...codes].sort((a, b) => Number(DRUG.test(b)) - Number(DRUG.test(a)));

const showcased = () =>
  allPolicies().filter((p) => SHOWCASE.some((s) => s.payer === p.payer && s.policyId === p.policyId));

export function registerPolicyRoutes(app: FastifyInstance) {
  app.get("/policies", async () => ({ policies: showcased().map(toItem) }));
  app.get("/policies/:payer/:policyId", async (req, reply) => {
    const { payer, policyId } = req.params as { payer: string; policyId: string };
    const p = showcased().find((x) => x.payer.toLowerCase() === payer.toLowerCase() && x.policyId === policyId);
    if (!p) return reply.code(404).send({ error: "policy not found" });
    return { policy: toItem(p), tree: stripStatus(toPolicyTree(p.root, p.root, {}, {})) };
  });
}
