# @nova26/server

Errand agent backend: intake chat, a tool-calling agent (web search, page fetch, phone calls, ask-user), and phone calls via Twilio or a simulator. API contract: `packages/shared/src/index.ts`.

## Env (root `.env`, re-read live every ~2s)

| var | notes |
| --- | --- |
| `OPENROUTER_API_KEY` | required; every model goes through OpenRouter |
| `PLANNER_MODEL` | intake + agent loop (default `anthropic/claude-sonnet-5.5`) |
| `CALL_MODEL` | the per-turn call brain (default `google/gemini-3.8-flash`) |
| `TTS_MODEL` / `TTS_VOICE` | default `google/gemini-3.8-flash-tts` / `Kore`. Gemini TTS only returns PCM, so the server wraps it as WAV in `.audio/<id>.wav` |
| `CALL_MODE` | `sim` (the app plays the callee) or `twilio` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | twilio mode only |
| `PUBLIC_URL` | public HTTPS URL Twilio can reach (twilio mode) |
| `PORT` | default 8787 |

## Run

```
npm install          # from repo root
npm run server       # tsx watch, http://localhost:8787
curl localhost:8787/health
```

Note: state is in memory, so a restart (including a tsx-watch reload) clears all errands.

## Sim mode (no phone)

1. `POST /errands/intake {message}`, then `POST /errands/:id/run`.
2. Poll `GET /errands/:id/events?after=N`. A `call_status` event carries the `callId`.
3. Play the callee: `POST /calls/:callId/sim-reply {"text":"..."}`. `"[hangup]"` ends the call.
4. Answer questions: `POST /errands/:id/answer {questionId, text}`.

## Twilio setup

1. Get a Twilio trial account and number (a shared trial number works). On a trial account you can only call **verified** numbers, so verify your own cell under Phone Numbers -> Verified Caller IDs.
2. Fill in `TWILIO_*` in `.env`.
3. `npm run tunnel` (cloudflared quick tunnel), then copy the `https://xxxx.trycloudflare.com` URL into `PUBLIC_URL`. A new tunnel gives a new URL each time.
4. Set `CALL_MODE=twilio`. The env is re-read live, but restarting is cleanest: Ctrl+C, then `npm run server`.
5. Run an errand whose contact is your verified cell.

Trial accounts play a "press any key to execute your code" preamble before the call connects. The callee must press a key to get through.

How the call works: the opening line and its audio are generated while the phone rings. Each turn uses `<Gather input="speech">`, then the brain runs, then TTS, then `<Play>` (with `<Say>` as the fallback). If the agent needs the user mid-call, it plays "One moment while I check." and then loops `<Pause>`/`<Redirect>` on `/twilio/wait` for up to 90s. If the trial account rejects `statusCallback` params, the server retries `calls.create` with only `{to, from, url}` and polls the call's status every 2s.

Dev helpers: `GET /debug/tts?text=...` and `POST /debug/twilio-session {errandId}`. The second one creates a Twilio-driver session without dialing, so you can POST to `/twilio/voice|turn|wait?callId=...` locally.
