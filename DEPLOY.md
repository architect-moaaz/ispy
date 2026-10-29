# Deploying iSpy a Spy for testing

The server is one persistent Node process (resident World Director, chief agents, SSE streams,
SQLite on disk), so it needs a host that keeps a process and a volume alive: Fly.io below.
Railway or Render work the same way with the same Dockerfile. Vercel does not fit: serverless
functions would kill the Director between requests and lose the database.

## 1. Server on Fly.io (once)

```bash
brew install flyctl
fly auth login
cd ispy
fly launch --no-deploy --copy-config --name ispy-server --region sin
fly volumes create ispy_data --region sin --size 1
fly secrets set ANTHROPIC_API_KEY=sk-ant-...        # omit to run the scripted fallback
fly deploy
curl https://ispy-server.fly.dev/v1/world
```

Notes
- `fly.toml` sets `DEV_SIM=0`: real GPS only, no dev panel. Local `.claude/launch.json` keeps `DEV_SIM=1`.
- Database seeds itself on first boot. To reset: `fly ssh console -C "sh -c 'rm /data/ispy.db*'"` then `fly apps restart ispy-server`.
- Logs: `fly logs`. **Monitoring console:** `https://ispy-server.fly.dev/console` (satellite map of sectors,
  targets and operatives; Director thoughts and balance; live missions; chief traffic; event feed; pause,
  force tick, dispatch, open a sector by clicking the map). It polls `/v1/admin/overview` every 5 s.
- Admin routes and the console are protected by `ADMIN_TOKEN` when it is set (`fly secrets set ADMIN_TOKEN=...`);
  the console asks for the key once and keeps it in the browser. Unset, they are open (local dev).
- Later: `fly deploy` again after each server change.

## 2. Android APK with EAS (once per build)

```bash
cd ispy/app
eas login
eas init                       # writes the real projectId into app.json
eas build -p android --profile preview
```

The `preview` profile produces an installable `.apk` (not an AAB) pointed at
`https://ispy-server.fly.dev` via `EXPO_PUBLIC_API_URL` in `eas.json`. EAS prints a download link
and QR code; install on the phone (allow "unknown sources"). Push notifications work in this build;
the first launch asks for notification and location permissions.

For the AI chiefs' voices and the Director's brain, the server needs the `ANTHROPIC_API_KEY`
secret; otherwise everything runs on the scripted fallback.

## 2b. Over-the-air updates
`eas update --branch preview --environment preview --message "..."` publishes the JS bundle; Expo Go
opens it from the QR on the dashboard, and APKs built after expo-updates was added pick it up on launch.
A change to native modules (a new library) still needs a new `eas build`.

## 3. Checklist before handing the APK to testers
- `fly.toml` region `sin`; app reachable over HTTPS.
- Decide `DEV_SIM`: on for office testing, off for walking tests in Cubbon Park.
- Safe hours: field targets are open 06:00–21:00 server local time (UTC on Fly: set `TZ=Asia/Kolkata`
  in `[env]` so quiet hours and safe hours follow Bengaluru time).
- Targets' coordinates are approximate; site-check them once on foot.

## 4. Walking tests anywhere
With `DEV_SIM=0` the app uses the phone's real GPS and the dev panel disappears. Nobody has to be near
Cubbon Park: when an operative deploys outside every sector, the World Director opens one around them
on the spot (1.2 km radius, virtual checkpoints 180–450 m out so orders land within seconds), then in
the background names it after the real neighbourhood (Nominatim) and surveys real public places
(parks, monuments, fountains, bus stops... from OpenStreetMap via Overpass, falling back to Nominatim
search, retrying for up to 40 min if the map sources are down). Real places replace the checkpoints
that are not already in play, and a dispatch announces the sector. Daylight hours only (06–21) for
every auto-opened target. These are public-tagged places, not vetted ones; use judgment on foot.

To open a sector by hand (owner action) click the map in the console, or:

```bash
curl -X POST https://ispy-server.fly.dev/v1/admin/areas/open \
  -H 'content-type: application/json' -H 'x-admin-key: <ADMIN_TOKEN>' \
  -d '{"lat":12.9716,"lng":77.5946}'
```
