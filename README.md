# iSpy a Spy — M1 core loop (alpha)

A location-based spy game: unseen chiefs dispatch field agents to walk to vetted public targets,
desk agents crack the codes that unlock them. See `../iSpy` design docs for the full design.

## Layout
- `shared/` — API types shared by server and app (`src/types.ts`); contract in `API.md`.
- `server/` — Fastify + SQLite (`node:sqlite`) modular monolith: catalogue, presence, chief strategy,
  mission pool, matcher, contest allocator, desk links, location verifier, game authority, chief chat.
- `app/` — Expo / React Native mobile app (iOS, Android, web for testing).

## Run
```bash
npm install
DEV_SIM=1 ISPY_LLM=off npm run server      # http://localhost:4000, simulated locations allowed
npm run app                                # Expo web on :8081 (or use .claude/launch.json entries)
```
On a phone: `cd app && EXPO_PUBLIC_API_URL=http://<your-lan-ip>:4000 npx expo start`, open in Expo Go.

- `DEV_SIM=1` lets the app teleport (dev panel) and ignores target safe hours. Never set in production.
- Chiefs use Claude (`claude-opus-5-5`) for hourly area strategy and chat when `ANTHROPIC_API_KEY`
  is set; `ISPY_LLM=off` forces the deterministic persona fallback.
- `npm run seed` resets the database and reseeds the Cubbon Park (Bengaluru) pilot area.

## Smoke test
`server/` exposes the whole loop over HTTP; `POST /v1/admin/tick` forces a strategy + pool refresh.
