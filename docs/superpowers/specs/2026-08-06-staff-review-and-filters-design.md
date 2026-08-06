# Staff Review + Results Filters — Design

## Context

Assessment Review (staff's Quiz History) already has topic/year filters and
date badge boxes (`QuizHistoryView.vue`). This feature brings the same
pattern to the manager-side "Staff Results" pages, and adds a new page for
Outlet Managers to view the assessments Area Managers file about their
outlet's staff.

No backend changes. `outlet_manager` scoped-data already returns `reports`
filtered by outlet (`lautan-academy-backend/src/routes/data.js:39-49`) —
this data is already flowing to the frontend, just not displayed anywhere
on the Outlet Manager side yet.

## 1. Filter + date badge on Staff Results

**Files:** `OutletManagerResultsView.vue`, `WarehouseManagerResultsView.vue`,
`AreaManagerDashboard.vue`

Reuse `QuizHistoryView.vue`'s pattern exactly:
- `MONTHS` array + `dateBadge(iso)` helper → `{ month, day }`.
- Badge box markup: `w-11 shrink-0 rounded-lg bg-aqualight text-center py-1`
  with month (10px, `text-aqua`) over day (base, `font-display font-bold
  text-deepsea`) — replaces the current plain
  `{{ new Date(...).toLocaleDateString() }}` text in each row.
- Topic + year `<select>` filters (`border border-slate/30 rounded-lg py-2
  px-3 text-sm bg-white`), options built from `[...new Set(...)]` over the
  visible list(s), sorted (years descending, topics alphabetical).

**OutletManagerResultsView.vue** (Module Quiz + AI Practice, two separate
lists today): each section keeps its own topic/year filter pair, options
computed from that section's own `standardHistory`/`aiHistory` — not a
merged list, since the two histories are already treated as independent
sections with independent empty-states. Badge box swaps in for the date
text in both sections' `<summary>` rows.

**WarehouseManagerResultsView.vue**: one AI Practice list, one topic/year
filter pair, same badge treatment.

**AreaManagerDashboard.vue**: keeps its existing outlet filter, adds
topic/year filters alongside it (three filters total). Badge box replaces
the date half of the current `{{ r.Outlet }} · {{ date }}` subtitle line —
outlet text moves to sit alongside/under the name so it's not lost.

## 2. New "Staff Review" page — Outlet Manager only

Not Warehouse Manager: warehouse scoped-data never queries the `reports`
table (`data.js:51-58`) — matches GAS, which never gave warehouse staff a
Product Knowledge assessment flow. Nothing to show there.

- New file `OutletManagerStaffReviewView.vue`.
- New route `/manager/staff-review`, `meta: { requiresAuth: true, role:
  'manager', managerRole: 'outlet_manager' }` — same guard shape as
  `/manager/results`.
- New sidebar item, label "Staff Review", inside the existing "Outlet
  Performance" group in `AppSidebar.vue` — but that group is currently
  built once for `isOutletOrWarehouseManager` (shared outlet+warehouse
  block). This item is added conditionally within that block, gated on
  `managerRole.value === 'outlet_manager'`, so it doesn't appear for
  Warehouse Manager.
- Data: `api.getScopedData().reports` — already outlet-scoped server-side,
  fetched the same way `OutletManagerResultsView.vue` already fetches
  `results`/`aiResults`.
- UI: same structure as `QuizHistoryView.vue`'s Assessment Review section
  (year/topic filters, date badge, `<details>` cards with quiz score,
  competency, product knowledge comments, performance gaps,
  recommendations) — plus each card's summary also shows `r['Staff Name']`
  (this page spans every staff member at the outlet, unlike the staff-side
  version which is implicitly one person). Read-only: no submit/edit form —
  filing stays exclusive to Area Manager via `AreaManagerReviewsView.vue`.

## 3. Label fix

`AreaManagerReviewsView.vue:220` — `"Product Knowledge — comments"` →
`"Product Knowledge"`. Textarea/binding unchanged.

## Out of scope

- No staff-name filter on the new Staff Review page (only year/topic, to
  match "same logic as staff portal" exactly).
- No backend/API changes.
- No change to Area Manager's existing "Submissions" filters
  (`AreaManagerReviewsView.vue`) — those already have outlet+time-window
  filters and are a separate section from this work.
