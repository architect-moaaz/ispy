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
| GET | /v1/world/contacts | → `ContactsResponse` (coarse sightings of other field agents in your area) |
| GET | /v1/investigations | → `{ cases: CaseSummary[] }` |
| GET | /v1/investigations/:id | → `CaseDetail` (alignment, evidence, confidence, reveal after a confirmed accusation) |
| POST | /v1/investigations/:id/clue | → `{ evidence }` (3/day, may be a decoy) |
| POST | /v1/investigations/:id/wire | → `{ evidence, credits }` (costs 10 intel credits, never a decoy) |
| POST | /v1/investigations/:id/accuse | `{ factionId }` → `AccuseResponse` (needs confidence ≥ 0.8; wrong = −5 trust + 1 h cooldown) |
| GET | /v1/bounties | → `BoardResponse` (global event, contracts with your claim status, credits, inventory) |
| POST | /v1/bounties/:id/claim | → `{ ok }` (max 3 active) |
| GET | /v1/world/event | → `{ event: GlobalEvent \| null }` |

Evidence is created by the authority when a field mission verifies while a rival is in the sector
(the contested rival if any); analyst (desk) completions expose one decoy. Bounties progress on
verified missions matching their criteria; the Director seeds OPERATION ECLIPSE (24 h, five
fragments from dead drops and extractions) and the Arbiter resolves it on a fixed rule.
| GET | /v1/world/dispatches | → `{ dispatches: Dispatch[] }` (Narrator's world news, every 6 h) |
| GET | /v1/admin/audit | → `{ audits }` (Auditor reports: per-faction metrics and flags, hourly) |
| POST | /v1/admin/audit | → run an audit now |
| POST | /v1/admin/dispatch | → force a dispatch now |

World Director loop (every 5 min): chief plans (hourly) → mission pool → bounties → campaign lifecycle
(Narrator proposes the fiction and parameters, Arbiter holds the win rule and resolves) → dispatches
(6 h) → audit (1 h). The Narrator uses Claude when configured and scripted text otherwise; it only
narrates facts already committed to the ledger. The Auditor never changes state; it raises flags.
