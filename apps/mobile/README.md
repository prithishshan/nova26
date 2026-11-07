# @nova26/mobile

Expo (SDK 58) app for nova26: intake chat, then the structured Errand card, then the live run screen.

## Run

From the repo root (`C:\Users\Prith\nova26`):

```bash
npm install          # once, from the ROOT (npm workspaces)
npm run server       # in another terminal: API on :8787
npm run app:web      # browser (press w if it doesn't open), the demo path
npm run app          # Expo dev server; scan the QR code with Expo Go
```

## Server URL

The app reads `EXPO_PUBLIC_API_URL` and falls back to `http://localhost:8787`.

- Web on the same laptop: no setup needed.
- **Physical phone (Expo Go)**: `localhost` is the phone itself, so point it at the laptop's LAN IP:
  ```bash
  EXPO_PUBLIC_API_URL=http://192.168.1.23:8787 npm run app
  ```
  (PowerShell: `$env:EXPO_PUBLIC_API_URL="http://192.168.1.23:8787"; npm run app`), or put it in `apps/mobile/.env`.
  The laptop firewall must allow port 8787. A tunnel URL (`npm run tunnel`) also works.

The header shows server health: whether it is connected, the call mode, and any missing keys.

## Layout

- `App.tsx` switches screens with plain state (list, intake, live).
- `src/api.ts` is the typed client; the types come from `@nova26/shared`.
- `src/screens/ErrandsList.tsx`, `Intake.tsx` (chat + `components/ErrandCard.tsx`), and `Live.tsx` (plan, call panel, sim callee, question card, result, activity feed).
- `metro.config.js` watches the monorepo root so `packages/shared` resolves.

## Checks

```bash
cd apps/mobile && npx tsc --noEmit
npx expo export --platform web
```
