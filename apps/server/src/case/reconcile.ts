// Deterministic EOB <-> bill reconciliation (no LLM). Plain-language copy for a stressed patient.
import type { BillLine, EobLine, Finding } from "@nova26/shared";

const COST_SHARE: Record<string, string> = {
  "1": "your deductible (the amount you pay each year before your plan starts sharing costs)",
  "2": "your coinsurance (your agreed share of the cost after the deductible)",
  "3": "your copay (the flat fee your plan sets for this kind of visit)",
};
// CARCs that mean "not covered / not medically necessary / needs auth" - worth appealing.
const APPEALABLE = new Set(["50", "96", "197", "198", "204", "55", "56", "15", "39", "151"]);

const usd = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`;
const close = (a: number, b: number) => Math.abs(a - b) < 0.01;

export function reconcile(eob: EobLine[], bill: BillLine[]): Finding[] {
  const out: Finding[] = [];
  const used = new Set<string>();

  for (const b of bill) {
    const e = eob.find((x) => !used.has(x.id) && x.code === b.code && x.date === b.date);
    if (!e) {
      out.push({
        lineId: b.id,
        kind: "mismatch",
        title: `${b.description} isn't on your insurance statement`,
        amount: b.amount,
        plain: `The hospital is charging you ${usd(b.amount)} for "${b.description}" (${b.code}), but your insurer's statement (EOB) for ${b.date} doesn't list it at all. That means insurance was likely never billed for it, so you shouldn't be asked to pay it yet.`,
        action: `Hold off on paying this ${usd(b.amount)}. We'll ask the billing office to send it to Aetna first or remove it.`,
      });
      continue;
    }
    used.add(e.id);
    const carc = e.carc ?? "";

    if (e.group === "PR" && APPEALABLE.has(carc)) {
      out.push({
        lineId: b.id,
        kind: "appealable_denial",
        title: `${b.description} was denied, and you can appeal`,
        amount: b.amount,
        plain: `Aetna paid $0 for this ${usd(e.billed)} drug and called it "not medically necessary" (code CARC ${carc}), because your claim was sent without the doctor's notes showing that standard treatments didn't work. Because you signed the infusion center's financial-responsibility form, the bill was assigned to you. Your chart already documents what Aetna's own policy requires, so this is worth appealing.`,
        action: `Don't pay this ${usd(b.amount)} yet. We'll check your chart against Aetna's policy, draft an appeal letter, and call Aetna to request reconsideration.`,
      });
      continue;
    }
    if (close(e.patientResp, 0) && b.amount > 0) {
      out.push({
        lineId: b.id,
        kind: "billing_error",
        title: `You're being billed for something you don't owe`,
        amount: b.amount,
        plain: `Your EOB says you owe $0 for "${e.description}", but the bill asks for ${usd(b.amount)}. This looks like a billing error.`,
        action: `Don't pay this. We'll ask the billing office to correct it.`,
      });
      continue;
    }
    if (b.amount > e.patientResp + 0.01) {
      out.push({
        lineId: b.id,
        kind: "mismatch",
        title: `The bill is higher than what insurance says you owe`,
        amount: b.amount,
        plain: `Your EOB says your share of "${e.description}" is ${usd(e.patientResp)}, but the bill asks for ${usd(b.amount)}. The difference (${usd(b.amount - e.patientResp)}) shouldn't be charged to you.`,
        action: `Pay at most ${usd(e.patientResp)} for this line. We'll ask the billing office to fix the rest.`,
      });
      continue;
    }
    if (e.group === "PR" && COST_SHARE[carc] && close(b.amount, e.patientResp)) {
      out.push({
        lineId: b.id,
        kind: "owe_ok",
        title: `${e.description}: ${usd(b.amount)} is correct`,
        amount: b.amount,
        plain: `Aetna allowed ${usd(e.allowed)} and paid ${usd(e.planPaid)}. The ${usd(b.amount)} left is ${COST_SHARE[carc]}. This matches your insurance statement, so it's a fair charge.`,
        action: `This one is fine to pay when you're ready.`,
      });
      continue;
    }
    out.push({
      lineId: b.id,
      kind: "owe_ok",
      title: `${e.description}: matches your EOB`,
      amount: b.amount,
      plain: `This charge (${usd(b.amount)}) matches what your insurance statement says you owe.`,
      action: `This one is fine to pay when you're ready.`,
    });
  }
  return out;
}
