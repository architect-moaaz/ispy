# iSpy a Spy — API contract (M1 alpha)

Server: `http://localhost:4000`. Types in `shared/src/types.ts`. All bodies JSON.
Auth: `Authorization: Bearer <token>` (from register). Errors: `{ error: string }` with 4xx/5xx.

| Method | Path | Body → Response |
|---|---|---|
| GET | /v1/world | → `WorldStatus & { devSim: boolean }` (public) |
| POST | /v1/auth/register | `{ codename }` → `{ token, player: Player }` |
| GET | /v1/me | → `{ player, faction: Faction \| null, presence: Presence \| null }` |
| GET | /v1/assessment | → `{ questions: AssessmentQuestion[] }` |
| POST | /v1/assessment | `AssessmentSubmit` → `AssessmentResult` |
| POST | /v1/recruitment/accept | `{ factionId }` → `{ player }` |
| POST | /v1/presence/check-in | `CheckInRequest` → `Presence` |
| POST | /v1/presence/heartbeat | `{ lat?, lng?, sim? }` → `Presence` |
| POST | /v1/presence/check-out | → `{ ok: true }` |
| GET | /v1/offers | → `{ offers: OfferCard[] }` (empty until checked in) |
| POST | /v1/offers/:id/accept | → `{ mission: MissionSummary }` |
| POST | /v1/offers/:id/decline | → `{ ok: true }` |
| GET | /v1/missions/active | → `{ mission: MissionSummary \| null }` (field) |
| GET | /v1/missions/:id/navigate | → `NavigateResponse` |
| POST | /v1/missions/:id/scan | `ScanRequest` → `ScanResponse` |
| POST | /v1/missions/:id/abandon | → `{ ok: true }` |
| GET | /v1/desk/active | → `DeskMissionDetail \| { mission: null }` |
| POST | /v1/desk/:id/submit | `DeskSubmitRequest` → `DeskSubmitResponse` |
| GET | /v1/chief/briefing | → `Briefing` |
| GET | /v1/chief/messages | → `{ messages: ChatMessage[] }` |
| POST | /v1/chief/messages | `{ text }` → `{ reply: ChatMessage }` |
| GET | /v1/profile/history | → `{ events: { at, text }[] }` |
| GET | /v1/dev/targets | → `{ targets: { id, name, lat, lng }[] }` (only when `devSim`) |
| GET | /v1/admin/events | → `{ events: WorldEvent[] }` |
| POST | /v1/admin/pause | `{ paused }` → `{ paused }` |
| POST | /v1/admin/tick | → `{ ok }` (force strategy + pool refresh) |

Flow: register → assessment → accept offer → check-in (field: needs a location fix; desk: none)
→ poll /v1/offers every ~5 s while on duty → accept → navigate (radar to target)
→ scan on arrival (may ask for an on-site code) → reward → next offer.
Desk: check-in desk → /v1/desk/active → submit answer → unlocks a linked field mission.

Dev simulation: when `devSim` is true the app may send `sim: true` with any lat/lng
(check-in, heartbeat, scan). Real devices send `expo-location` fixes with `mock` from
`Location.LocationObject.mocked`.
