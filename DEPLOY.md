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
- `fly.toml` keeps `DEV_SIM=1` for the playtest so testers can teleport from the dev panel.
  Set it to `0` (`fly secrets set DEV_SIM=0` or edit fly.toml) before anyone outside the team plays.
- Database seeds itself on first boot. To reset: `fly ssh console -C "sh -c 'rm /data/ispy.db*'"` then `fly apps restart ispy-server`.
- Logs: `fly logs`. Director status: `https://ispy-server.fly.dev/v1/admin/director`
  (admin routes are unauthenticated in this alpha; put them behind a secret or Fly's private network before a public test).
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

## 3. Checklist before handing the APK to testers
- `fly.toml` region `sin`; app reachable over HTTPS.
- Decide `DEV_SIM`: on for office testing, off for walking tests in Cubbon Park.
- Safe hours: field targets are open 06:00–21:00 server local time (UTC on Fly: set `TZ=Asia/Kolkata`
  in `[env]` so quiet hours and safe hours follow Bengaluru time).
- Targets' coordinates are approximate; site-check them once on foot.

## 4. Walking tests anywhere
With `DEV_SIM=0` the app uses the phone's real GPS and the dev panel disappears. Only Cubbon Park is
seeded, so to test from somewhere else create a temporary sector around your position (owner action,
targets are virtual checkpoints 150–450 m out, not vetted places; use judgment on foot):

```bash
curl -X POST https://ispy-server.fly.dev/v1/admin/areas/test \
  -H 'content-type: application/json' \
  -d '{"name":"Home test","lat":12.9716,"lng":77.5946}'
```
Deploy in the app and the sector is found; each checkpoint shows its code on arrival.
