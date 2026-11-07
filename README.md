# nova26

AI agents that work prior-authorization denials for a hospital's denials team, with a human supervisor on every decision.

An agent reads the payer's denial letter, the patient's chart and the payer's own published coverage policy. It finds where the
denial's stated reason is contradicted by evidence in the chart, drafts an appeal in which every claim is cited, and, once a
supervisor approves, phones the payer to open an expedited appeal and book a peer-to-peer. The call opens the case; the written
appeal and the peer-to-peer (a call between the treating physician and the payer's medical director) decide it.

> All patient, provider and claim data in this repo is fictional demo data.

## The demo case

| | |
|---|---|
| Payer | Aetna, policy CPB 0341 (infliximab products) |
| Denied | Remicade (infliximab) IV, J1745, $4,860 per infusion, prior-auth ref `PA-2026-1048837` |
| Aetna's reason | "No documented inadequate response or intolerance to conventional therapy" |
| Chart shows | Prednisone Jan 5 – Mar 30 (flared on taper) and ~9 months of azathioprine, inadequate response (GI note, Oct 14) |
| Agent outcome | Expedited appeal opened, reference number + deadline + fax secured, peer-to-peer booked |

## How it works

1. **Case opens with three sources attached:** the denial letter, the chart (Epic-shaped FHIR data) and the governing policy, compiled into
   an AND/OR criteria tree where every rule keeps its verbatim policy quote.
2. **Analyze:** the engine judges each in-scope rule against the chart, maps the denial's stated reason onto the tree (and keeps it as its
   own check, flagged "not in compiled policy", when no rule covers it), and records whether the chart contradicts it.
3. **Draft:** the appeal letter may only cite a fixed, numbered list of chart facts and policy quotes; citations that don't resolve are removed.
4. **Approve and call:** the supervisor approves; the voice agent calls the payer (Twilio), verifies with NPI / tax ID / member details,
   argues the contradiction to justify expediting, and hands anything outside its brief to the supervisor (question cards and a
   "tell the agent to say..." relay).
5. **Outcome:** the transcript is turned into a structured outcome (what the call secured, next actions with owners).

Readiness and verdicts are computed in code, not by the model.

## Repo layout

```
apps/
  server/   Fastify API: case flow, policy library, agent + call sessions, Twilio webhooks (port 8787)
  web/      Supervisor console (Vite + React): operations, case workspace tabs, policy library (port 5173)
  mobile/   Earlier Expo prototype (patient-side); not used by the current demo
packages/
  shared/   Contract: Errand, PatientCase, DenialAnalysis, PolicyTreeNode, CaseOutcome, HTTP API notes
  engine/   Policy engine: bundled compiled policies, criteria evaluator, denial-reason mapping,
            cited appeal writer, call-outcome extraction
docs/       Pitch decks (.pptx) and the Aetna-rep script for rehearsing the live call
```

The policy trees were compiled by the policy compiler in the separate `azure_hackathon` project and are bundled here as
`packages/engine/data/compiled-policies.json`.

## Setup

Requirements: Node 24, npm, and [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
for a public URL Twilio can reach.

```bash
npm install
cp .env.example .env   # then fill in the values below
```

| Variable | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | All models (evaluation, call turns, TTS) go through OpenRouter |
| `ENGINE_MODEL` | Criteria evaluation + appeal letter (default `anthropic/claude-sonnet-5.5`) |
| `CALL_MODEL` | Voice agent turns (default `google/gemini-3.8-flash`) |
| `TTS_MODEL`, `TTS_VOICE` | Agent voice (default `google/gemini-3.8-flash-tts`, `Kore`) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Outbound calls |
| `DEMO_TO_NUMBER` | Phone the agent calls as "the payer" (on a Twilio trial it must be a verified number) |
| `PUBLIC_URL` | HTTPS URL of the tunnel, e.g. `https://xxxx.trycloudflare.com` |
| `CALL_MODE` | `twilio` for real calls, `sim` to type the payer's side in the console |
| `MAX_CALLS_PER_ERRAND` | Hard cap on calls per case (default 1) |

Optional: `TTS_DEADLINE_MS` (fall back to Twilio's built-in voice if TTS is slower, default 3500), `GATHER_SPEECH_MODEL`,
`GATHER_SPEECH_TIMEOUT`, `NOVA_PORT` (override the port from the shell).

## Run

```bash
npm run tunnel   # copy the trycloudflare URL into PUBLIC_URL in .env
npm run server   # API on :8787 (restart after changing .env)
npm run web      # console on http://localhost:5173  (open #case for the demo case)
```

In the console: open the case, click **Run agent** (about 30 s), review the appeal draft and the "Aetna's claim vs. the chart" card,
then **Approve & call Aetna**. Play the rep using `docs/aetna-rep-script.docx`.

## Notes and limits

- **Twilio trial:** calls start with a "press any key" message, can only reach verified numbers, and reject some optional API parameters
  (the server falls back to status polling). Calls are turn-based (`<Gather>`), so expect a few seconds per reply.
- **State is in memory:** restarting the server ends any call in progress and resets the case.
- **Peer-to-peers are physician-only:** the agent books them and prepares a brief; it does not conduct them.
- The compiled CPB 0341 tree has no explicit "failed conventional therapy" rule for Crohn's disease, which is why the denial reason
  shows up as a separate, flagged check.
