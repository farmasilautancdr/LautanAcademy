# CPD Hours Tracking — Revision: Module Quiz + AI Practice Count Too

**Date:** 2026-08-13
**Status:** Approved, pending plan
**Supersedes:** the hours-source scope of `docs/superpowers/specs/2026-08-12-cpd-hours-design.md` (that spec's data model, calendar-year/no-ledger decisions, and staff/manager UI placement decisions are unchanged and still apply — only which activities count toward the 120hr target changes).

## Purpose

Original CPD Hours spec (2026-08-12) counted only Video Training toward the
120hr/year target. User confirmed 2026-08-13: Module Quiz and AI Practice
attempts should count too. Neither has a fixed per-entry admin row like
`video_trainings.hours` to attach an hours value to (Module Quiz's
`standard_questions` bank has no hours field; AI Practice quizzes are
generated on the fly per passcode, no catalog at all), so this revision
defines a flat-rate model for both instead of extending the per-entry
pattern.

**Still depends on Video Training shipping first** — same hard dependency
the original spec stated, unchanged.

## Scope decisions (from brainstorming, 2026-08-13)

- **Three sources, three rate models, chosen after presenting the
  trade-off and confirming with the user:**
  - **Video Training** — unchanged from the 2026-08-12 spec. Supervisor
    sets `hours` manually per video (`video_trainings.hours`).
  - **Module Quiz — flat 1 hour per graded attempt.** A `results` table row
    whose `topic` is *not* a Video Training topic. Chosen over adding a
    per-topic hours column to `standard_questions` (would need a new
    Supervisor-facing admin UI — `standard_questions` has no CRUD today,
    see the repo's `[PENDING] Module quiz question admin` item — and would
    be inconsistent with AI Practice, which has no fixed topic catalog to
    attach a per-topic value to at all).
  - **AI Practice — flat 0.25 hour per graded attempt.** An `ai_results`
    table row. AI Practice is a separate table from `results`, exclusively
    AI-generated quizzes — every row counts, no topic check needed.
  - Rejected: time-based (actual elapsed watch/quiz time) — no reliable
    elapsed-time tracking exists for Module Quiz or AI Practice today, and
    it breaks from Video Training's already-established "manually set, not
    derived from real duration" convention.
- **Distinguishing Module Quiz rows from Video Training rows within the
  shared `results` table:** both write into `results` with only a `topic`
  string, no `kind` column (per the original Video Training spec's data
  model). The two specs already guarantee Video Training's and Module
  Quiz's topic namespaces never collide — so topic membership in
  `video_trainings` is sufficient to tell them apart: if a `results` row's
  topic matches a `video_trainings` topic, it's Video Training (use that
  video's `hours`); otherwise it's Module Quiz (flat 1hr).
- **No new dedup logic needed.** Both `POST /data/results` (Module
  Quiz + Video Training) and `POST /data/ai-results` (AI Practice) already
  no-op a same-calendar-day duplicate submission for the same
  topic/passcode (confirmed by reading `lautan-academy-backend/src/routes/data.js`
  directly) — flat-rate-per-row is safe from the same double-submit case
  the original spec's per-video-hours model already relied on this
  protection for.
- **Real gap found during brainstorming, confirmed in scope: Area Manager
  currently gets zero AI Practice data.** `GET /data/scoped-data`'s
  `area_manager` branch hardcodes `aiResults: []` — an existing gap
  unrelated to this feature (Area Manager's dashboard never showed AI
  Practice history either). For Area Manager's CPD summary (this spec's
  Task 7, from the original plan) to count AI Practice hours at all, the
  backend needs a new `ai_results` query in that branch, scoped by the
  manager's region's outlets (`outletsForArea(scopeKey)`, same helper the
  branch's `results`/`wrong_answers` queries already use). This is a
  genuine backend addition beyond the original spec's "no backend changes
  for the manager side" — confirmed with user as in-scope for this
  revision.
- **UI: no new shape.** User confirmed a single total (not a
  video/module/AI breakdown) — the original spec's Dashboard hero line and
  three manager summary lists (Tasks 5-8 of the 2026-08-12 plan) are
  unchanged in layout; only what feeds the number underneath widens.
  Impeccable polish applies when those UI tasks are actually built, per
  this repo's CLAUDE.md "Automatic Workflow on UI Tasks" — not a separate
  design pass now.
- **Field naming:** the original plan's `videoHoursThisYear` response field
  (`GET /data/scoped-data`, staff branches) is renamed `cpdHoursThisYear` —
  it's no longer video-only, the old name would be actively misleading.

## Data model

No new tables/columns beyond what the 2026-08-12 spec already defined
(`video_trainings.hours`). This revision only changes computation.

## Backend

**`routes/data.js`, `videoHoursThisYear()` helper (staff branches)** —
renamed `cpdHoursThisYear()`, reworked to sum both sources:

```sql
-- Video Training (real per-video hours) + Module Quiz (flat 1hr for any
-- results row whose topic isn't a video-training topic)
select coalesce(sum(coalesce(vt.hours, 1)), 0) as hours
from results r
left join video_trainings vt on vt.topic = r.topic
where r.outlet = $1 and r.name = $2
  and extract(year from r.created_at) = extract(year from now())
```

```sql
-- AI Practice: flat 0.25hr per graded attempt, every row counts
select count(*) * 0.25 as hours
from ai_results
where outlet = $1 and name = $2
  and extract(year from created_at) = extract(year from now())
```

Sum the two query results into one `cpdHoursThisYear` number. Applies to
both `staff_retail` and `staff_warehouse` branches, same as the original
spec (warehouse staff only ever produce `ai_results` rows in practice, so
their number is AI-Practice-only in effect, but the query is identical —
no special-casing).

**`routes/data.js`, `area_manager` branch of `GET /scoped-data`** — add an
`ai_results` query scoped by the manager's region outlets, alongside the
existing `results`/`wrong_answers`/`reports` queries:

```js
pool.query('select * from ai_results where outlet = ANY($1) order by created_at desc', [outlets]),
```

Passed into `toResponse()`'s `aiResults` parameter (currently hardcoded
`[]` for this branch) — this also means Area Manager's `GET /scoped-data`
response gains real AI Practice data generally, not just for the CPD
calculation, since `toResponse()` shapes it identically to every other
role. No new `ai_wrong_answers` query — not needed for CPD hours, and nothing
on the Area Manager page today reads AI Practice wrong-answer detail (out
of scope to add a UI for that here — this fix is scoped to unblocking the
CPD summary, not a general AI Practice feature parity fix for Area
Manager).

## Frontend

**`useCpdHours.js`** — `hoursByStaff()` signature changes from
`(results, hoursByTopic, year)` to `(results, aiResults, hoursByTopic,
year)`:

```js
const MODULE_QUIZ_HOURS = 1
const AI_PRACTICE_HOURS = 0.25

export function hoursByStaff(results, aiResults, hoursByTopic, year = new Date().getFullYear()) {
  const byStaff = new Map()
  function add(name, outlet, hours) {
    const key = `${name}|${outlet}`
    if (!byStaff.has(key)) byStaff.set(key, { name, outlet, hours: 0 })
    byStaff.get(key).hours += hours
  }
  for (const r of results) {
    if (new Date(r.Timestamp).getFullYear() !== year) continue
    add(r.Name, r.Outlet, hoursByTopic.has(r.Topic) ? hoursByTopic.get(r.Topic) : MODULE_QUIZ_HOURS)
  }
  for (const r of aiResults) {
    if (new Date(r.Timestamp).getFullYear() !== year) continue
    add(r.Name, r.Outlet, AI_PRACTICE_HOURS)
  }
  return [...byStaff.values()].sort((a, b) => a.hours - b.hours)
}
```

`videoHoursByTopic(videoTrainings)` (the topic→hours lookup builder) is
unchanged.

**Call sites** (`OutletManagerResultsView.vue`, `AreaManagerDashboard.vue`,
`SupervisorStaffComparisonView.vue`) — each already fetches (or, for Area
Manager, will now fetch via the backend fix above) both `results` and
`aiResults` from the same `GET /data/scoped-data` call; pass both into the
reworked `hoursByStaff()` instead of just `results`. No new fetches beyond
what the original plan already added (`GET /video-trainings`).

**`DashboardView.vue`** — reads `data.cpdHoursThisYear` (renamed field)
instead of `data.videoHoursThisYear`. Display copy/i18n keys unchanged
(the strings never said "video" — "{hours} / {target} training hours this
year" already read correctly for the broadened meaning).

## Out of scope / explicitly not fixed here

- Breakdown by source (Video / Module Quiz / AI Practice) in any CPD
  summary UI — single total only, per user confirmation.
- Per-topic hours for Module Quiz (would need new `standard_questions`
  admin UI — separate pending item, not bundled here).
- General AI Practice feature parity for Area Manager (e.g. surfacing
  `aiWrongAnswers` or an AI Practice section on `AreaManagerDashboard.vue`)
  — only the data fetch needed to unblock the CPD hours calculation is
  added.
- Configurable flat-rate values (1hr Module Quiz, 0.25hr AI Practice) —
  hardcoded constants, matches the original spec's "no configurable
  target" simplicity decision for the 120hr figure itself.
