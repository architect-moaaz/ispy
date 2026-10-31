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

| GET | /v1/admin/director | → the Director agent's status: operatives watched, chief models, cadence, recent decisions |
| GET | /v1/admin/overview | → everything the console shows: world, director, push, sectors (with target/pool counts), targets (`inPlay`), operatives (position, work), live missions, chief traffic, events |
| POST | /v1/admin/areas/open | `{ lat, lng }` → `{ id, name, realTargets, final }`: open a sector here and survey it now |
| GET | /console | the owner's monitoring page (HTML) |

Admin routes require header `x-admin-key` (or `?key=`) when the server has `ADMIN_TOKEN` set.
Sectors also open automatically: a field check-in outside every area creates `sec-<lat>-<lng>` around the
operative (`sector.opened`), chiefs plan it at once, and a background survey names it and adds real public
places (`sector.settled`, retried as `sector.survey_retry` when map sources are down).

World Director agent: a resident process, not a cron. Every ledger event wakes it (deployment,
offers, accepts, verifications, declines, flagged scans, contests, accusations, fragments, bounties)
and it reacts at once through the chiefs: welcome and debrief lines, nudges after declines or idling,
replans with a stated reason, dispatches on exposures and resolutions. Between events it watches on a
heartbeat of 20 s while anyone is deployed and 5 min when the sector is empty. Housekeeping below: chief plans (hourly) → mission pool → bounties → campaign lifecycle
(Narrator proposes the fiction and parameters, Arbiter holds the win rule and resolves) → dispatches
(6 h) → audit (1 h). The Narrator uses Claude when configured and scripted text otherwise; it only
narrates facts already committed to the ledger. The Auditor never changes state; it raises flags.

World parameters (params.ts): bounded knobs the Director tunes every 10 minutes from the last hour's
signals (reward multiplier, walk scale, contests per hour, contest appetite boost, pool depth, offer
TTL, decoy rate, desk-link fallback). Each change is a `world_param.changed` ledger event; untouched
knobs drift back to default; the Auditor flags churn. Chiefs and operatives never see the Director:
chief replans arrive as "situation updates from your analysts", and no player copy names an arbiter.

Strategy room (strategy.ts): every 10 minutes the Director assesses the balance of power (tempo,
campaign standing, contest record, deployed agents; dominant mission type and busiest area per
agency) and plays the meta-game: counter-contracts against a runaway leader for the other agencies,
intelligence briefings to rival chiefs about the leader's pattern, more encounters when a campaign is
tight, sweeter rewards when it runs away, and a rally for a trailing agency. Moves are randomised so
chiefs cannot learn the rule. `/v1/admin/director` shows the latest assessment under `balance`.

Director brain (brain.ts): when a model is configured (and `ISPY_DIRECTOR` is not `rules`), the
Director's judgment is the model's. Signals of note wake it (debounced 4 s) and it also reviews the
world every 2 min while anyone is deployed, 15 min otherwise. It receives the balance of power, every
deployed operative's state, each chief's state, the campaign, the parameters and bounds, what just
happened and its own recent decisions, and returns an assessment plus up to six actions from a fixed
set: message an operative in their chief's voice, brief a chief, publish a contract, set a parameter
(bounded), publish a dispatch, refill the pool, or wait. Each thought is a `director.thought` ledger
event. Without a model, the rule-based reactions, tuning and strategy room run instead.

Chief agents (chiefAgent.ts): each chief is a resident agent notified of its own operatives' events
(recruit, deploy, verified, dropped, flagged scan, fragment, contract, cover burned) and of contests
on its targets. It responds in its own voice (model when configured, scripted otherwise), keeps a
journal (chief_memory) it plans and chats from, refills its pool the moment an operative deploys, and
checks every minute for deployed operatives with nothing to do. Dispatch is proximity-first: field
missions are built on targets near the agency's deployed agents, extraction legs are neighbours, and
the matcher weights walking distance above skill fit.

Live stream and push: `GET /v1/stream?token=…` is a server-sent events feed of the operative's own
events (chief messages, offers, verifications, desk unlocks, rewards, cases, contracts) plus public
world events; payloads carry only safe fields and the app refetches what changed, with slow polling
as a backstop. `POST /v1/push/register { token }` stores an Expo push token; the notifier sends a
few event types (chief message, new orders, site unlocked, contract closed, cover burned, promotion,
campaign start/end) through the Expo push service, never between 21:00 and 07:00 and at most six an
hour per operative. `/v1/admin/push` shows registrations, sends and open stream clients.

## Operations (chains of linked missions)

The World Director composes an *operation* for a deployed field operative: two to four linked field
missions at real sites, each reserved for that operative and offered the moment the previous link
verifies, with briefs that carry one story across the sites (model-written when a key is set, scripted
continuity otherwise). The rules path starts one after an operative's first verified field mission;
the brain can also start one with `start_operation { codename, theme }`. A link that is abandoned or
expires folds the operation. The last link pays a bonus (150 + 50 per link XP).

`MissionSummary.chain` = `{ name, step, of }` on every link. Events: `chain.started`, `chain.advanced`,
`chain.completed`, `chain.abandoned`. The console's overview lists recent operations under `operations`.

## Chaos (crises)

The World Director brews a crisis in a sector: a courier, jammers, an auction or a leak across three
real sites for 30 to 240 minutes (rules path: when operatives are in the field, nothing is live and
45 min have passed; brain action `create_crisis { kind, theme, minutes }`; owner: `POST /v1/admin/crisis`).
Each chief, in character (model or scripted), picks a stance and may propose a pact:

| Stance | Meaning | Payoff when it carries the crisis |
|---|---|---|
| intercept | take the asset for the agency | fragment for the leading agency, XP for claimers |
| sabotage | burn it so nobody has it | fragment for the leading agency, XP for claimers |
| mitigate | contain it, keep the city quiet | trust and XP for claimers; sector chaos drops |

A pact forms when proposals are mutual, or one-sided with the same stance. Allies share credit for
every site and their operatives are offered each other's crisis missions (`MissionSummary.crisis.joint`).
One mission per agency per site; the first verified scan claims the site (`crisis.site_claimed`), the
others' unclaimed missions at that site vanish and active ones finish "late" at 40% XP. When all sites
are claimed or the clock runs out the Arbiter resolves it (`crisis.resolved`: intercepted, burned,
contained or fizzled) and the Director writes the epilogue. `GET /v1/world/crisis` returns the current
or latest crisis for the caller's agency: stances, pacts, sites, outcome and the sector chaos level.
`POST /v1/admin/crisis/resolve` ends the live one. Chiefs brief their operatives on brew, claims and outcome.

## Time, exclusivity and consequences

Everything is time-boxed: offers (accept window), missions (`expiresAt`, shown as "window closes"),
operations links, crises (30 to 240 min), bounties and campaigns. **First done wins the site**: when an
operative verifies a field mission, the target is held by their agency for two hours (`target_locks`,
`site.held`). Pending work at that site evaporates from every board; anyone already walking there
finishes "late" (`mission.late`: 40% XP, trust −1, outcome `late`). Exempt: collaborative work (crisis
missions, pact joint ops) and intel extraction (EXTRACTION). Consequences: `GET /v1/world` reports
`control` (sites held per agency per sector), held sites feed each agency's power in the Director's
balance assessment, chiefs plan with what they hold, and the app shows sector control on the Board and
a "site held by a rival" warning on the mission.

**Chiefs read the chaos.** On every crisis (brew, each site claimed, a new deployment) the chief reads
the pattern of past crises (what each rival tends to do with that kind, which sites fall first, how fast)
and dispatches its deployed operatives directly: nearest open site each, far from rivals, hot sites first
when rivals race, pact allies coordinated so they do not double up. Direct orders arrive as offers at the
top of the board (`mission.offered` with `direct: true`) with the chief's reasoning in HQ chat.

## Onboarding, negotiation, puzzles, console (31 Oct)

- **Desk first.** A recruit's first assignment is the intel desk (no location permission); the first field
  board is a single recon at the nearest site, presence-verified where possible (`offersFor` rookie rule).
- **Today block** on `GET /v1/chief/briefing`: sector, control, live crisis and your stance, your operation,
  the evening hot window, and `firstTimer`.
- **Evening window.** At 09:00 local the Director announces tonight's hot sector (dispatch, `hot_window`);
  at 18:00 it brews a 2-hour crisis there if none is live. The brain may still brew at other times.
- **Negotiation.** At every crisis the chiefs decide alone (round 1) and may open a back channel: a proposal
  is answered in character (model or scripted), a pact forms on acceptance, and the accepting chief may align
  its stance. Transcripts live in `chief_talks` and appear in the console overview (`crises[].talks`).
- **Real puzzles.** Desk ciphers are classical systems named in the prompt (Caesar, Atbash, Vigenère with the
  key, Morse, Polybius, keyword substitution with a crib, 3-rail fence); analysis puzzles are three-person,
  three-site deductions generated with a solver so the answer is unique. `puzzle.system` names the system.
- **Console.** Chaos panel (stances, pacts, sites, verdict, talks), Operations table, fuller Director decision
  log (assessment and actions), onboarding funnel (registered → assessed → recruited → first desk → first field
  → returned, active today, sector-hours today).
- **Art.** Mission cards and the desk show painted art per template (`assets/art/mission-*.jpg`).

## The ambient field layer (map-first play)

The map is the home screen once a recruit has their first desk win: the app deploys you to the field on
open. Around you, always, without orders:

| Thing | What | How |
|---|---|---|
| Caches | real public places (the targets) | inside 40 m, `POST /v1/caches/:id/spin` once per 5 min per cache: cipher fragments, decoys, sometimes a jammer or lens, +15 XP, a few credits |
| Signals | short-lived spawns near deployed operatives (courier, leaked page, planted bug, broker, sleeper asset, jammer) with rarity common/uncommon/rare/legendary and 6–20 min lifetimes | the Director keeps 4 within 450 m of every field operative (`field.spawnAround` each heartbeat); `POST /v1/signals/:id/capture { hold, flick }` inside 40 m rolls the catch from rarity and hold quality; three misses and it flees from you; captures go to your collection (`GET /v1/collection`) and pay XP by rarity; chiefs comment on rare ones |
| Order pins | the chief's offers, drawn where they are | `pins` in `GET /v1/map?lat&lng`; accept or decline from the map card |
| Stronghold | the sector's landmark | owned by the agency holding the most sites there; shown as a ring in the holder's colour |

`GET /v1/map?lat=&lng=` returns caches, signals, pins and the stronghold around a point. The app shows a
nearby tracker (nearest first, footprints for distance), a card for whatever you tap with the one action
that fits (spin, capture, navigate, accept), a spin sheet, and the capture ritual (hold the drifting
signal to build a lock, flick up to take it). The Missions tab keeps the mission log and the desk.

## Public ground only

Every objective is on public ground by construction. A new sector gets no arbitrary points: eight
waypoints are snapped onto public footpaths and streets (OSRM nearest, named after the street), then the
survey replaces them with real public places (parks, gardens, monuments, artwork, viewpoints, fountains,
libraries, markets, squares, bus stops, stations). Signals spawn only at an active site, within a few
steps of its centre. Legacy ring checkpoints are retired on boot and their signals expired
(`sector.checkpoints_retired`, `sector.waypoints`). While a sector has no sites yet the board says so.
