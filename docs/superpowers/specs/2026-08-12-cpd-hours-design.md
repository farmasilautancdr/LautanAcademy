# CPD Hours Tracking (120hr/year) — Design

**Date:** 2026-08-12
**Status:** Approved, pending plan

## Purpose

Add a calendar-year training-hours target (120 hours) that every staff
member accumulates by completing Video Training videos (`kind: 'video'` in
`QuizView.vue`, see `docs/superpowers/specs/2026-08-12-video-training-design.md`).
This is the first of three related sub-projects discussed together
(brainstormed 2026-08-12): this one (A) builds the core hours mechanism;
(B) a `is_pharmacist` staff tag plus a gated "Pharmacist Courses" section;
(C) a mandatory-course compliance report for pharmacists — both deferred,
each gets its own brainstorm/spec/plan cycle once this one ships, since B
and C both build on the `video_trainings.hours` field this spec adds.

**Hard dependency:** Video Training itself (spec/plan already written,
**not yet executed** as of this spec's date) must ship first — this spec
adds one column to a table Video Training's own plan creates, and reads
from the `results` rows that flow only exist once staff can actually
complete a video-training quiz.

## Scope decisions (from brainstorming)

- **Points and hours are two separate things**, not one converted into the
  other. Points-per-answered-question (mentioned in the original request as
  something the user has seen in a reference app) is a gamification
  concept, explicitly out of scope for this spec — only the hours/120hr
  target is built here.
- **Hours are set manually by Supervisor per video**, not derived from the
  YouTube video's real duration. A new `video_trainings.hours` column
  (numeric, e.g. `1.5`), filled in on the same add-video form Video
  Training's plan already builds (`SupervisorAddResourcesView.vue`'s new
  video block).
- **Hours credit at the same moment grading already happens** — `POST
  /data/video-results` succeeding (Video Training's own endpoint,
  unchanged) is the only trigger. No new event, no separate "mark as
  watched" step — completing the quiz already implies the video was
  watched (Video Training's own `ENDED`-gated flow guarantees that).
- **No new ledger/rollup table.** Hours-this-year is computed on read by
  joining `results` (already has `topic`, `outlet`, `name`, `created_at`)
  to `video_trainings` (by `topic`, now carrying `hours`), filtered to the
  current calendar year. Consistent with how this app already treats
  `topic` as the join key everywhere (Module Quiz, AI Practice, reports).
- **Calendar year, resets 1 January**, same cycle for every staff member —
  not an individual join-date anniversary.
- **Staff-facing display: the existing Dashboard** (`DashboardView.vue`),
  not a new page. A new element sits alongside the existing AI-Practice-
  average hero card.
- **Manager-facing display: existing Staff Results pages**
  (`OutletManagerResultsView.vue` — own outlet; `AreaManagerDashboard.vue`
  — own region; `SupervisorStaffComparisonView.vue` — company-wide), not a
  new page. All three already receive the `results` array from `GET
  /data/scoped-data`; adding an hours summary is a frontend-only addition
  that also fetches `GET /video-trainings` (already public-to-any-
  authenticated-session, existing endpoint) to build the topic→hours
  lookup, and computes each visible staff member's hours-this-year from
  data already on the page. **No backend changes for the manager side.**
- **No backend changes for the staff side either**, beyond one field:
  `GET /data/scoped-data`'s `staff_retail`/`staff_warehouse` branches gain
  a server-computed `videoHoursThisYear` number in the response — simplest
  place to compute it once, server-side, rather than duplicating the same
  join+filter logic in the frontend a fourth time for the one case
  (Dashboard) that only ever needs its own single number.
- **Shared calculation reused, not duplicated four times.** A new
  composable `useCpdHours.js` (this project's second composable, after
  `useOutlets.js`) exports a pure function computing hours-by-staff from a
  `results` array + a topic→hours lookup — used by the three manager views
  identically. The Dashboard's single-number case uses the backend's
  `videoHoursThisYear` field directly, no client-side computation needed
  there.

## Data model

One column added to the `video_trainings` table Video Training's own plan
creates (`sql/schema.sql`):

```sql
alter table video_trainings add column if not exists hours numeric not null default 1;
```

(`add column if not exists` rather than baking it into `video_trainings`'s
original `create table` statement — this spec is a separate, later change
on top of Video Training's own schema task, applied the same
directly-against-the-live-DB way every schema change in this project is.)

## Backend

`routes/data.js`'s `GET /scoped-data`, `staff_retail`/`staff_warehouse`
branches only: after fetching `results` (already happening), compute

```sql
select coalesce(sum(vt.hours), 0) as hours
from results r
join video_trainings vt on vt.topic = r.topic
where r.outlet = $1 and r.name = $2
  and extract(year from r.created_at) = extract(year from now())
```

and add `videoHoursThisYear: <number>` to that branch's JSON response,
alongside the existing `results`/`wrongAnswers`/`aiResults`/`aiWrongAnswers`
fields. Every other `scopeType` branch (`outlet_manager`, `warehouse_manager`,
`area_manager`, `supervisor`) is untouched — those roles compute their
hours summaries client-side instead (see Frontend below), since they're
already receiving the full `results` array for their scope and adding a
second server-side aggregation per role would duplicate the same join four
different ways for no real benefit (their pages need a per-staff
breakdown, not one number).

## Frontend

**`useCpdHours.js`** (new composable, `src/composables/`): exports
`hoursByStaff(results, videoTrainingsByTopic, year = new
Date().getFullYear())` — filters `results` to rows whose `Topic` exists in
the topic→hours lookup and whose `Timestamp` falls in `year`, sums `hours`
grouped by `${Outlet}|${Name}`, returns an array of `{ outlet, name, hours
}`. Pure function, no reactive state — used identically by all three
manager views, each of which already fetches `GET /video-trainings` once
on mount to build the `topic -> hours` lookup this function needs.

**`DashboardView.vue`**: new small stat element next to the existing hero
card, reading `data.videoHoursThisYear` (already in the `GET /data/scoped-
data` response per the backend section above) against the fixed `120`
target — e.g. "84 / 120 hours this year".

**`OutletManagerResultsView.vue` / `AreaManagerDashboard.vue` /
`SupervisorStaffComparisonView.vue`**: each fetches `GET /video-trainings`
once alongside their existing `GET /data/scoped-data` call, feeds both into
`hoursByStaff()`, and renders a new small summary section (staff name,
hours this year, simple progress bar against 120) above their existing
per-attempt history list. Sorted by hours ascending, so staff furthest
behind the target surface first — the actual point of a manager-facing
view like this.

## Out of scope / explicitly not fixed here

- Points-per-answer gamification (mentioned as a reference-app feature in
  the original request, not part of this spec).
- Sub-project B (pharmacist tag + gated Pharmacist Courses section) and C
  (mandatory-course compliance report) — separate specs, separate plans,
  both build on `video_trainings.hours` added here but neither is designed
  in detail yet.
- No configurable target (fixed `120`, not a `system_settings` row or
  per-role value) — matches the "keep it simple until asked otherwise"
  instruction this session.
- No historical-year view (e.g. "last year's 120hr progress") — only the
  current calendar year is ever computed, past years aren't queryable
  through this feature (the underlying `results` rows still exist and
  aren't deleted, just not surfaced through this particular view).
