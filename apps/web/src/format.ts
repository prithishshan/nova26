import type { WorklistStatus } from "@nova26/shared";

export const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const fmtDate = (s: string | Date) => {
  const d = s instanceof Date ? s : new Date(s.length === 10 ? s + "T12:00:00" : s);
  return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
export const fmtTime = (s: string) => {
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
};

export const STATUS_LABEL: Record<WorklistStatus, string> = {
  queued: "Queued", gathering_chart: "Gathering chart", analyzing: "Analyzing", appeal_drafted: "Appeal drafted",
  calling_payer: "Calling payer", needs_human: "Needs human", awaiting_payer: "Awaiting payer", overturned: "Overturned", upheld: "Upheld",
};
export const ACTIVE_STATUSES: WorklistStatus[] = ["gathering_chart", "analyzing", "calling_payer"];
