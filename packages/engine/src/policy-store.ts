// Bundled-JSON policy store (no DB). Routing uses the GOVERNED `codes` only, payer-scoped,
// fewest-codes tiebreak (most specific policy wins).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CompiledPolicy } from "./policies.js";

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/compiled-policies.json");
let cache: CompiledPolicy[] | null = null;

export function allPolicies(): CompiledPolicy[] {
  if (!cache) cache = JSON.parse(fs.readFileSync(DATA, "utf8")) as CompiledPolicy[];
  return cache;
}

export function policyByCode(code: string, payer?: string): CompiledPolicy | undefined {
  const all = allPolicies();
  const scoped = payer ? all.filter((p) => p.payer.toLowerCase() === payer.toLowerCase()) : all;
  const matches = scoped.filter((p) => (p.codes ?? []).includes(code));
  if (matches.length <= 1) return matches[0];
  return [...matches].sort((a, b) => a.codes.length - b.codes.length || a.policyId.localeCompare(b.policyId))[0];
}

export function policyById(policyId: string): CompiledPolicy | undefined {
  return allPolicies().find((p) => p.policyId === policyId);
}
