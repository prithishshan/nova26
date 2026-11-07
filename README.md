# nova26

**AI agents that fight prior-authorization denials for hospitals, with a human supervisor on every decision.**

> All patient, provider and claim data in this project is fictional demo data.

## The problem

**Denials cost hospitals a tenth of their revenue.** US hospitals lost about **$132 billion**, roughly 10% of net revenue, to final
denials and bad debt in 2025. On top of that, they spend about **$19.7 billion a year** just on the paperwork of fighting denials.

**Billing teams can't keep up, so most denials are never fought.** Somewhere between **35% and 65%** of denied claims are never
reworked. Physicians handle about **39 prior authorizations a week**, roughly 12 hours of staff and physician time, and 43% of providers
say they're understaffed in claims.

**Yet the fight is winnable.** Only **11.5%** of Medicare Advantage prior-auth denials are ever appealed, but **81%** of the ones that
are appealed get overturned.

## What nova26 does

Four steps move a denial forward:

1. **Read the denial and the chart.** The agent reads the payer's denial letter, the patient's chart and the payer's own published
   coverage policy.
2. **Find the contradiction.** It checks the denial's stated reason against what the chart actually documents.
3. **Draft the cited appeal.** Every sentence in the appeal points to a chart fact or a quote from the payer's policy.
4. **Call the insurance provider.** With a supervisor's approval, it calls the payer to open an expedited appeal, get a reference number
   and decision deadline, and book a peer-to-peer.

**The goal isn't a win on the phone. It's a peer-to-peer.** Disputes like this aren't settled over the phone. A **peer-to-peer** is a call
between the patient's own doctor and the insurer's doctor (its medical director): the treating doctor explains the case directly, and the
insurer's doctor can reverse the denial on the spot. Only physicians can do it, so the agent books it and hands the doctor a one-page
brief. The call opens the case; the written appeal and the peer-to-peer decide it.

## The case

**$4,860 per infusion, denied by Aetna. The chart proved Aetna's reason wrong.**

The patient has moderate-to-severe Crohn's disease and is in an active flare. Their gastroenterologist ordered Remicade, an IV
medication.

| | |
|---|---|
| **Aetna said** (Oct 28) | No proof that standard, cheaper treatments were tried first. |
| **The chart shows** (Oct 14 GI note) | Steroids from January to March stopped working as they were tapered; nine months of azathioprine didn't control it. |
| **The agent did** (Nov 7) | Drafted a cited appeal, then called Aetna: expedited appeal opened, peer-to-peer booked. |

Aetna decides within 72 hours, on the written appeal and the peer-to-peer.

## How the agent stays grounded

- **Policies become checklists a human approves.** The payer's published policy (here Aetna CPB 0341) is turned into a tree of rules,
  86 for this policy. Each rule keeps the exact sentence it came from, and nothing reaches an agent until a person has approved the tree.
- **Every claim is cited.** The appeal can only cite a fixed, numbered list of chart facts and policy quotes; anything that doesn't
  check out is removed.
- **Three sources, one contradiction.** The agent reasons over the chart, the policy and the denial letter, and only argues what the
  chart actually shows.
- **A human approves every call** and answers anything the agent can't.

## Try the demo

The demo runs locally: a supervisor console, an AI agent, and a real phone call where someone plays the Aetna rep.

1. `npm install`, then copy `.env.example` to `.env` and fill in the OpenRouter and Twilio keys.
2. Start a tunnel (`npm run tunnel`) and put its URL in `PUBLIC_URL`, then run `npm run server` and `npm run web`.
3. Open http://localhost:5173/#case, click **Run agent**, then **Approve & call Aetna**.
4. Play the rep with the script in `docs/aetna-rep-script.docx`.

The pitch deck is in `docs/` (latest: `nova26-deck-v8.pptx`).

## Sources

Kodiak Solutions (Nov 2026) · Premier survey of 516 hospitals · MGMA / Change Healthcare figures · AMA 2024 Prior Authorization
Physician Survey · Experian Health State of Claims 2025 · KFF analysis of Medicare Advantage prior authorization, 2024.
