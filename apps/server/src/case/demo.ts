// Hero demo data. The chart is written FROM Aetna CPB 0341 (Infliximab products), scoped to
// General + the Crohn's disease branch, so every required criterion is documented with dated
// 2026 evidence. Denied line: J1745 (infliximab, 10 mg units), governed by Aetna 0341.
import type { BillLine, ChartSummary, EobLine, PatientCase } from "@nova26/shared";

export const DOS = "2026-06-03";
export const PROVIDER = "Riverside Infusion Center";
export const STATEMENT_DATE = "2026-07-01";

export const PATIENT: PatientCase["patient"] = {
  name: "Prithish Shan",
  memberId: "W123456789",
  payer: "Aetna",
  plan: "Aetna Open Access PPO",
  dob: "1998-04-12",
};

export const GI_DOCTOR = "Dr. Elena Park, MD";
export const GI_OFFICE = "Riverside Health Gastroenterology";

// PA-hero chart: written FROM Aetna CPB 0341 (General + Crohn's branch). All evidence predates the
// 2026-10-28 denial; infliximab has NOT been started (pending approval); the member is flaring.
export const CHART: ChartSummary = {
  name: "Prithish Shan",
  age: 28,
  mrn: "E1009934",
  conditions: [
    "Crohn's disease of small and large intestine (ileocolonic), moderate-to-severe, active flare (K50.811) [active] (onset 2023-02)",
    "Iron deficiency anemia secondary to chronic GI blood loss [active] (onset 2024-08)",
  ],
  medications: [
    "Infliximab (Remicade) 5 mg/kg IV (360 mg) at weeks 0, 2, 6 then 5 mg/kg IV every 8 weeks [ordered 2026-10-14, PENDING PRIOR AUTHORIZATION, not yet administered] - prescriber: Dr. Elena Park, MD, Gastroenterology",
    "Budesonide 9 mg PO daily [active] (bridge while awaiting biologic, started 2026-10-14)",
    "Prednisone 40 mg PO daily with taper [completed] (2026-01-05 to 2026-03-30) - inadequate response; flare on taper",
    "Azathioprine 2.5 mg/kg PO daily [discontinued 2026-10-14] (2026-01-20 to 2026-10-14) - inadequate response after ~9-month trial at therapeutic dose (TPMT normal)",
    "Ferrous sulfate 325 mg PO daily [active]",
  ],
  observations: [
    "QuantiFERON-TB Gold Plus: Negative (2026-09-30)",
    "Chest X-ray PA/lateral: no active cardiopulmonary disease, no findings of prior or active TB (2026-09-30)",
    "Hepatitis B surface antigen: Negative (2026-09-30)",
    "Hepatitis B core antibody: Negative (2026-09-30)",
    "TPMT enzyme activity: Normal (2026-01-15)",
    "C-reactive protein: 24 mg/L [High] (2026-10-14)",
    "Fecal calprotectin: 610 ug/g [High] (2026-10-10)",
    "Hemoglobin: 10.4 g/dL [Low] (2026-10-14)",
    "Harvey-Bradshaw Index: 12 (moderate-to-severe activity) (2026-10-14)",
    "Weight: 72 kg (2026-10-14)",
  ],
  procedures: ["Ileocolonoscopy with biopsy (2026-09-22)"],
  allergies: ["No known drug allergies"],
  immunizations: ["Hepatitis B vaccine series complete (2024-01-12)", "Influenza vaccine (2025-10-09)", "Tdap (2025-04-02)"],
  diagnostics: [
    "Colonoscopy: moderate-to-severe inflammation with deep ulcerations, terminal ileum and right colon; SES-CD 15 (2026-09-22)",
    "Pathology: chronic active ileocolitis with granulomas, consistent with Crohn's disease (2026-09-24)",
    "MR enterography: active inflammation of the distal 15 cm of terminal ileum, no fistula or abscess (2026-10-02)",
  ],
  noteExcerpts: [
    {
      title: "Gastroenterology Clinic Note - Dr. Elena Park, MD (Gastroenterology)",
      date: "2026-10-14",
      text:
        "28-year-old adult with ileocolonic Crohn's disease, moderately-to-severely active, confirmed endoscopically (SES-CD 15, 2026-09-22) and histologically (2026-09-24); HBI 12, CRP 24, calprotectin 610. " +
        "Inadequate response to conventional therapy: corticosteroids (prednisone 40 mg with taper, 2026-01-05 to 2026-03-30, flared on taper) and an adequate ~9-month trial of the immunomodulator azathioprine 2.5 mg/kg (2026-01-20 to 2026-10-14, TPMT normal); azathioprine stopped today. " +
        "Plan: IV infliximab (Remicade, reference product), prescribed by me as the treating gastroenterologist. Dosing per FDA label for adult Crohn's disease: 5 mg/kg IV induction at weeks 0, 2 and 6, then 5 mg/kg IV maintenance every 8 weeks (72 kg -> 360 mg per dose). " +
        "Response will be formally reassessed at week 14; infliximab will be discontinued if there is no response by week 14. " +
        "Patient is biologic-naive. Infliximab will be the ONLY biologic or targeted synthetic agent - no concomitant biologic or targeted synthetic drug (no JAK inhibitor, no other anti-TNF, no vedolizumab/ustekinumab). " +
        "TB screening: QuantiFERON-TB Gold Plus negative 2026-09-30 (within 12 months of initiation) and chest X-ray 2026-09-30 negative for active or prior TB; no active TB and no latent TB, so no TB treatment is required. Hepatitis B serologies negative. No active or chronic infection. " +
        "Treatment is IV infliximab; the subcutaneous product (Zymfentra) is not being prescribed. Budesonide 9 mg as a bridge. " +
        "Precertification request for infliximab to be submitted to Aetna by our office.",
    },
    {
      title: "Prior Authorization Encounter - Riverside Health Gastroenterology",
      date: "2026-10-16",
      text:
        "Precertification request for infliximab (Remicade) J1745, 5 mg/kg IV induction weeks 0/2/6 then every 8 weeks, submitted to Aetna by our office on 2026-10-16 (Dr. Elena Park, Gastroenterology). Aetna decision 2026-10-28: not approved, reference PA-2026-1048837.",
    },
    {
      title: "Telephone Encounter - Riverside Health Gastroenterology (nurse triage)",
      date: "2026-11-04",
      text:
        "Patient called reporting worsening Crohn's flare: 8-10 loose stools/day with blood, abdominal pain, fatigue, missed work. Infliximab not yet started - awaiting Aetna prior authorization (denied 2026-10-28; appeal pending with Riverside Health PA & Denials team). Continue budesonide; ED precautions reviewed. Message routed to Dr. Park.",
    },
  ],
};

export const DENIAL_LETTER: NonNullable<PatientCase["denialLetter"]> = {
  date: "2026-10-28",
  from: "Aetna Precertification / Utilization Management",
  requestedBy: `${GI_DOCTOR} (Gastroenterology), ${GI_OFFICE}`,
  service: "Remicade (infliximab) IV infusion, 5 mg/kg every 8 weeks after induction",
  code: "J1745",
  decision: "Not approved - not medically necessary",
  reason:
    "The documentation submitted does not show an inadequate response or intolerance to conventional therapy (e.g., corticosteroids, immunomodulators), as required by Aetna Clinical Policy Bulletin 0341 (Infliximab products) for moderately to severely active Crohn's disease.",
  referenceNumber: "PA-2026-1048837",
  appealRights:
    "You or your provider may appeal this decision within 180 days of the date of this letter. If waiting for a standard decision could seriously harm your health, you may request an EXPEDITED appeal by calling the number on this letter; expedited appeals are decided within 72 hours.",
  daysSinceDenial: 10,
  officeAppealed: false,
};
export const DRUG_COST_PER_INFUSION = 4860;

// Why this medical-necessity denial is PR (patient liability) rather than CO: at the first infusion the
// member signed the infusion center's advance financial-responsibility waiver, and the claim was submitted
// WITHOUT the GI note documenting failed conventional therapy. NOT a missing prior authorization
// (precertification was submitted 2026-05-12).
export const DENIAL_STORY =
  "The original claim was submitted without the gastroenterology clinic note (2026-05-01) documenting the inadequate response to " +
  "corticosteroids and azathioprine, so Aetna's medical-necessity review denied the infliximab line (CARC 50). Because the member " +
  "signed the infusion center's advance financial-responsibility form at the first infusion, the denied amount was assigned to the member " +
  "(group PR). This is not a missing prior authorization: precertification was submitted on 2026-05-12. The missing documentation is now cited and attached.";

export const EOB: EobLine[] = [
  {
    id: "eob1", date: DOS, code: "99213", description: "Office visit, established patient",
    billed: 220, allowed: 140, planPaid: 110, patientResp: 30, group: "PR", carc: "3", reason: "Co-payment amount",
  },
  {
    id: "eob2", date: DOS, code: "96413", description: "Chemotherapy/biologic IV infusion, first hour",
    billed: 640, allowed: 410, planPaid: 328, patientResp: 82, group: "PR", carc: "2", reason: "Coinsurance amount",
  },
  {
    id: "eob3", date: DOS, code: "J1745", description: "Injection, infliximab, excludes biosimilar, 10 mg (x36 units)",
    billed: 4860, allowed: 4860, planPaid: 0, patientResp: 4860, group: "PR", carc: "50",
    reason: "These are non-covered services because this is not deemed a 'medical necessity' by the payer.",
  },
];

export const BILL: BillLine[] = [
  { id: "bill1", date: DOS, code: "99213", description: "Office visit, established patient", amount: 30 },
  { id: "bill2", date: DOS, code: "96413", description: "IV infusion, first hour", amount: 82 },
  { id: "bill3", date: DOS, code: "J1745", description: "Infliximab 10 mg (x36 units)", amount: 4860 },
  { id: "bill4", date: DOS, code: "99070", description: "Pharmacy supply / IV kit", amount: 145 },
];
