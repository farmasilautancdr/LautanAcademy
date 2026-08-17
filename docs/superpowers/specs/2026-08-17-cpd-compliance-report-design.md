# Mandatory-Course Compliance Report — Design

**Date:** 2026-08-17
**Status:** Approved, pending plan

## Purpose

Sub-project C of the 3-part CPD initiative (A: CPD Hours Tracking, shipped
2026-08-13; B: Pharmacist Tag + Gated Pharmacist Courses, shipped
2026-08-13). Gives every manager tier a report of which tagged Pharmacist
staff have/haven't passed each mandatory Pharmacist Course
(`video_trainings` rows where `pharmacist_only = true`), plus a pharmacist's
own downloadable training record. Bundles two changes surfaced during
brainstorming that touch the same area: a self-export button so a
pharmacist's completion history survives Annual Data Reset, and lowering
the global CPD target from 120hr/year to 60hr/year.

## Scope decisions (from brainstorming)

- **All four manager tiers see the report** (Outlet, Warehouse, Area,
  Supervisor), each scoped to their own staff exactly like the existing
  CPD Hours summaries. Pharmacist Courses are retail-division-only (sub-
  project B), so Warehouse Manager's view will in practice always be
  empty/hidden — included anyway for tier parity rather than special-cased
  out, and harmless since it costs one query that returns zero rows.
- **Compliance = best-ever attempt >= 70%**, not "any attempt" and not
  "most recent attempt." A staff member who ever cleared 70% on a course
  stays compliant even if a later retake scores lower — matches "once
  passed, stays passed."
- **Report layout is a full matrix**: rows = pharmacist staff, columns =
  mandatory courses, cell = pass/fail + best score % + date of that best
  attempt. Not a single roll-up number — a manager needs to see exactly
  which course a specific pharmacist is missing.
- **Fully live-computed off `results`, same as CPD Hours** — no new
  ledger/history table. Accepted tradeoff: Annual Data Reset (shipped, not
  pushed) purges `results` rows dated before the current calendar year, so
  a pharmacist's only passing attempt at an old course can get purged,
  reverting them to "not compliant" until they retake it. Not solved here
  by excluding rows from the reset — solved instead by giving the
  pharmacist their own permanent export before that happens (below).
- **Self-export, pharmacist-only:** a "Download My Training Record" button
  on the staff's own Quiz History page, visible only when
  `auth.staff?.isPharmacist`. Exports **all** completed training (Module
  Quiz + Video Training + AI Practice — not just the mandatory courses),
  all-time, not scoped to one year: topic, date, hours credited, running
  total. Gives every pharmacist (not just ones behind on mandatory
  courses) a personal archive that outlives Annual Data Reset.
- **Global CPD target changes from 120hr/year to 60hr/year.** Unrelated to
  the report mechanically, but bundled per explicit request. Currently a
  raw `const CPD_TARGET_HOURS = 120` duplicated across 5 frontend files
  with no shared source — this change also centralizes it into one
  constant in `useCpdHours.js`, imported everywhere else, so a future
  target change only touches one file.

## Backend

### New endpoint: `GET /pharmacist-compliance`

New file `routes/pharmacistCompliance.js`, mounted alongside the other
routers. `requireAuth`, scoped by `req.session.scopeType`/`scopeKey`
exactly like `data.js`'s `/scoped-data` (reusing that file's
`outletsForArea()` helper for `area_manager`):

| scopeType | staff filter |
|---|---|
| `outlet_manager` / `warehouse_manager` | `staff_roster.outlet = scopeKey` |
| `area_manager` | `staff_roster.outlet = ANY(outletsForArea(scopeKey))` |
| `supervisor` | no outlet filter |
| anything else (staff roles) | 403 — this is a manager-only report |

Three queries, all filtered to the scope's outlet(s) above:

1. `select id, outlet, division, name from staff_roster where is_pharmacist = true and outlet = ...`
2. `select id, title, topic, hours from video_trainings where pharmacist_only = true order by created_at` (not outlet-scoped — courses are global)
3. `select outlet, name, topic, percentage, created_at from results where topic = ANY($courseTopics) and outlet = ...`

Everything else happens in JS, not SQL — `percentage` is stored as text
like `"83%"` (existing convention throughout `results`), so it's parsed
with `parseInt` server-side same as the frontend already does elsewhere.
For each `(outlet|name, topic)` pair, keep the row with the highest parsed
percentage; that becomes the cell's `percentage`/`createdAt`, with
`passed = percentage >= 70`. This is still server-computed compliance
(principle: never trust a client-asserted score) — the parsing location
is Node, not Postgres, purely because every other percentage comparison
in this codebase (`ResultView.vue`, `QuizHistoryView.vue`) already does it
in JS and `results.percentage`'s text-with-`%` shape makes a SQL cast
more fragile than a `parseInt`.

Response shape:

```json
{
  "courses": [{ "id": 1, "title": "...", "topic": "...", "hours": 1 }],
  "staff": [{ "outlet": "R1-001", "name": "..." }],
  "cells": {
    "R1-001|JOHN": {
      "Topic A": { "attempted": true, "percentage": 83, "passed": true, "date": "2026-08-01T..." },
      "Topic B": { "attempted": false }
    }
  }
}
```

A staff/topic pair with no `results` row at all is `{ attempted: false }`
— never silently shown as failed at 0%, which would misrepresent "never
took it" as "took it and failed."

### No changes to existing routes

`video_trainings`, `results`, `staff_roster` — all read-only from this
endpoint's perspective. No schema migration needed anywhere in this
sub-project.

## Frontend

### Compliance matrix

New `PharmacistComplianceMatrix.vue` — self-fetches
`GET /pharmacist-compliance` on mount (same self-contained pattern
`SupervisorPharmacistTagView.vue` already uses), renders nothing
(`v-if` guard, no heading either) when `staff.length === 0` or
`courses.length === 0` — matches the product principle of not showing UI
for data that doesn't exist. Otherwise: a table, staff rows × course
columns, each cell a badge:

- Not attempted: muted dash, no color.
- Attempted, `passed`: green check + `percentage`% + relative date.
- Attempted, not `passed`: coral/red mark + `percentage`% + relative date.

Added as a new section to the four existing per-tier results/comparison
views, next to their existing CPD Hours summary section:
`OutletManagerResultsView.vue`, `WarehouseManagerResultsView.vue`,
`AreaManagerDashboard.vue`, `SupervisorStaffComparisonView.vue`. These
views are not behind the `auth.impersonating` gate (that gate only covers
staff-facing nav/pages) — the matrix ships live for managers immediately,
independent of whether Video Training/Pharmacist Courses nav has been
flipped live for real staff yet. It will simply show "not attempted"
everywhere until that happens, which is honest, not broken.

### Self-export (`QuizHistoryView.vue`)

New "Download My Training Record" button, added inside the existing
`v-if="auth.impersonating"` branch of the CPD Hours section (the one
showing real numbers, not the "Coming Soon" placeholder) — same gate
boundary as the CPD data it's built from, so it can't leak real
completion data ahead of that flag. Additionally `v-if="auth.staff?.isPharmacist"`.

Reuses the `csvEscape`/`Blob`/`URL.createObjectURL` pattern already
written in `SupervisorReportsView.vue::downloadCsv()` — small enough that
duplicating it locally matches this codebase's existing convention (no
shared CSV composable exists yet, not introduced here either, YAGNI for
one more call site).

Row source: `standardHistory` (Module Quiz + Video Training, already
fetched by this view) + `aiHistory` (AI Practice, already fetched) —
**all-time, not filtered by `cpdYear`** (the point is a permanent record,
not a snapshot of one year). Per row: `Topic`, `Date` (`Timestamp`),
`Hours` (`videoHoursByTopic` lookup if the topic is a video-training
topic, else `MODULE_QUIZ_HOURS`; `AI_PRACTICE_HOURS` flat for
`aiHistory` rows — same rate logic `hoursByStaff()` already encodes, just
applied per-row instead of summed). Sorted oldest→newest. Footer row:
`Total,,<sum of all Hours>`. Filename:
`cpd-record-${auth.staff.name}-${new Date().toISOString().slice(0,10)}.csv`.

### 120hr → 60hr

- `useCpdHours.js` gains `export const CPD_TARGET_HOURS = 60`.
- `DashboardView.vue`, `AreaManagerDashboard.vue`,
  `OutletManagerResultsView.vue`, `QuizHistoryView.vue`,
  `SupervisorStaffComparisonView.vue` — delete their own local
  `const CPD_TARGET_HOURS = 120` and import the shared one instead.
  (`ResultView.vue`'s unrelated `:size="120"` on `ProgressRing` is a pixel
  dimension, not touched.)
- `en.json`/`ms.json` `videoHoursHelper` string ("...toward the
  120hr/year target...") updated to say 60hr.
- `PRODUCT.md`'s two "120-hour/calendar-year" / "120hr/year" mentions
  updated to 60hr, since it's meant to reflect confirmed product truth.

## Edge cases

- A staff member tagged Pharmacist but in the `warehouse` division (sub-
  project B's documented no-op edge case) shows up in the matrix with
  every mandatory course "not attempted" forever, since Pharmacist
  Courses are retail-only — correctly surfaces a mistagging rather than
  hiding it.
- A course created after a staff member's only passing attempt at a
  *different* course — unaffected, matrix is per (staff, course) pair,
  independent columns.
- Supervisor adds a new mandatory course — it appears as a new column
  with every pharmacist "not attempted" immediately, no backfill needed
  (matches "compute on read").
- Deleting a `video_trainings` row (existing `DELETE /video-trainings/:id`,
  unchanged) removes that course's column next load; any `results` rows
  under its old topic are simply no longer joined — same "orphaned
  history" behavior every other course-delete in this app already has.
- Zero mandatory courses exist yet, or zero pharmacist staff in scope —
  component renders nothing (see above), not an empty table.
- `GET /pharmacist-compliance` called by a staff-role token — 403, this
  is manager-only, same convention as other manager-only endpoints.

## Out of scope / explicitly not fixed here

- Not un-gating Video Training/Pharmacist Courses nav from
  `auth.impersonating` for real staff — separate, pre-existing decision,
  not part of this sub-project.
- No notification/alerting for managers when a pharmacist falls out of
  compliance — the matrix is pull (viewed on demand), not push.
- No backend-generated export for managers (e.g. a company-wide
  compliance CSV) — only the pharmacist's own personal record export was
  requested.
- Not excluding mandatory-course results from Annual Data Reset's purge —
  explicitly decided against; the export is the mitigation instead.

## Testing / verification plan

- `curl`: `GET /pharmacist-compliance` as each of the 4 manager scope
  types → 200, staff/courses/cells correctly scoped to that tier's own
  outlet(s)/region/company-wide; as a staff-role token → 403.
- `curl`: verify a staff member with two attempts at the same course (one
  60%, one later 80%) shows `passed: true, percentage: 80` — best-ever,
  not most-recent.
- `curl`: verify a staff/course pair with zero `results` rows returns
  `{ attempted: false }`, not a 0%/failed cell.
- `npm run build` clean (frontend).
- EN/MS key-parity script clean.
- Live browser click-through: each manager tier's view shows the matrix
  (or correctly shows nothing when empty); a pharmacist-tagged staff
  member (via impersonation, since real nav isn't flipped live) sees the
  Download button and gets a CSV with correct topic/date/hours/total rows;
  Dashboard/Quiz History/manager CPD summaries all read 60hr as the target
  everywhere, no stray 120 left (grep-confirmed).
