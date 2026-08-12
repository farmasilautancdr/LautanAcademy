# Results Filters & Source-Split Sections — Design

**Date:** 2026-08-13
**Status:** Approved, pending write-up into an implementation plan.

## Goal

Four views currently mix Video Training and Module Quiz results together (same
`results` table, distinguished only by topic membership in `video_trainings`),
and lack consistent filtering as staff/attempt counts grow. This spec:

1. Splits every merged "Module Quiz" list into two real sections — **Video
   Training** and **Module Quiz** — wherever they're currently combined.
2. Adds AI Practice as its own section in Area Manager (data has been
   available since the CPD Hours backend fix, but was never rendered).
3. Standardizes filtering (year, topic, and — where relevant — outlet/staff
   name) across Outlet Manager, Area Manager, Supervisor Staff Comparison,
   and the staff-facing Quiz History.
4. Makes each CPD Hours summary (added in the prior CPD Hours Tracking
   feature) filterable by year, instead of being hardcoded to the current
   calendar year.

No backend changes. Every change here is client-side filtering/rendering of
data already being fetched by these views.

## Shared composable addition

`useCpdHours.js` gains one new export:

```js
// Splits a `results` array (Video Training + Module Quiz, same table) into
// the two sources by topic membership — the same check hoursByStaff already
// does internally, now exposed standalone so views can render them as
// separate sections instead of just summing them together.
export function splitByVideoTopic(results, hoursByTopic) {
  const video = []
  const moduleQuiz = []
  for (const r of results) {
    (hoursByTopic.has(r.Topic) ? video : moduleQuiz).push(r)
  }
  return { video, moduleQuiz }
}
```

`hoursByStaff(results, aiResults, hoursByTopic, year)` is unchanged — every
CPD section already calls it with a `year` argument slot; today's callers all
omit it (falling back to the current calendar year). This feature just wires
each CPD section's new year dropdown to pass a picked value instead.

## Filter semantics (applies consistently across all four views)

- **Outlet** (Area Manager, Supervisor only — Outlet Manager and staff are
  already single-outlet): global, scopes the underlying dataset before any
  section-level filtering. Unchanged from today.
- **Region** (Supervisor only): global, unchanged from today.
- **windowMonths** (Supervisor only): global, unchanged — still bounds the
  backend fetch (`getScopedData(windowMonths)`). The new **year** filter
  below further narrows *within* whatever that fetch already returned, on
  the client.
- **Year**: independent per section (Video Training / Module Quiz / AI
  Practice / CPD each get their own year dropdown) — matches the existing
  Outlet Manager pattern (its Module Quiz and AI Practice sections already
  have fully independent year/topic state). No page has a "global year"
  concept; introducing one would be a bigger change than this ask needs.
- **Topic**: independent per quiz section, options scoped to that section's
  own rows (a Video Training topic list is never the same set as a Module
  Quiz or AI Practice one). CPD sections do **not** get a topic filter — CPD
  is a summed total across all three sources, and a single topic only ever
  exists in one of them, so "filter this sum by topic" isn't a coherent
  operation.
- **Staff name** (Outlet Manager quiz sections only, per explicit ask):
  independent per section, options scoped to that section's own rows.
  Not added to Area Manager/Supervisor, or to any CPD section, in this pass.

## Per-view changes

### Outlet Manager (`OutletManagerResultsView.vue`)

- Existing single "Module Quiz" section (secretly includes Video Training
  rows) splits into two: **Video Training** (new) and **Module Quiz**
  (existing, now module-only). Each gets its own year + topic + **staff
  name** dropdowns.
- Existing AI Practice section: unchanged behavior, gains a **staff name**
  dropdown alongside its existing year/topic.
- CPD section: gains its own year dropdown. No outlet/staff filter (role is
  single-outlet; the section already lists one row per staff, so a
  staff-name filter would just hide all other rows — not useful here).

### Area Manager (`AreaManagerDashboard.vue`)

- Existing global outlet dropdown stays, continues to scope everything
  below it (all sections + CPD).
- Existing single combined list splits into three: **Video Training** /
  **Module Quiz** / **AI Practice**. Each gets its own year + topic
  dropdowns. Video Training and Module Quiz keep the existing wrong-answer
  expand/review (same `wrongsFor()` AttemptID matching, just applied to the
  split subsets). **AI Practice does not get wrong-answer expand** — this
  role's `GET /scoped-data` branch was deliberately not extended to fetch
  `ai_wrong_answers` when Task 4 added `aiResults` (documented as
  out-of-scope then); adding it is a small backend addition this spec
  intentionally does not include. AI Practice rows show name/topic/score
  only, matching what data is actually available today.
- CPD section: gains its own year dropdown (outlet already covered by the
  existing global dropdown).

### Supervisor Staff Comparison (`SupervisorStaffComparisonView.vue`)

- Existing global windowMonths + region + outlet dropdowns stay exactly as
  today.
- Existing single combined leaderboard (per-staff avg score across both
  results+aiResults) splits into three independent leaderboards: **Video
  Training** / **Module Quiz** / **AI Practice**. Each is its own
  aggregate-by-staff computation (same `{name, outlet, attempts, avg}` shape
  and math the current `rows` computed already does, just scoped to one
  source's rows), with its own year + topic + sort dropdowns. This is a
  leaderboard view (aggregate, not per-attempt), so no wrong-answer detail
  here, matching today's behavior.
- CPD section: gains its own year dropdown. Continues to use the existing
  always-full-year separate fetch (`getScopedData(0)`) — the year dropdown
  picks which year's totals to show instead of hardcoding the current one;
  outlet/region filters (already global) apply to this fetch's data too
  (today the CPD summary ignores them entirely — this closes that gap).

### Staff Quiz History (`QuizHistoryView.vue`)

- Existing "Module Quiz" section (secretly includes Video Training) splits
  into two: **Video Training** (new) and **Module Quiz** (module-only).
  Each gets its own year dropdown only — no topic filter (a single staff's
  own topic list per source is short enough not to need one).
- Existing AI Practice section: gains a year dropdown only (no topic).
- New **CPD Hours** section (this view didn't show CPD before — only the
  Dashboard did). Same Coming-Soon/`auth.impersonating` gate as every other
  CPD section. Own year dropdown. No outlet/staff filter needed — single
  staff, single outlet, both already known from the logged-in session.
- Assessment section: unchanged, already has year + topic.

## Non-goals

- No new backend routes, columns, or queries.
- No wrong-answer detail for Area Manager's new AI Practice section (see
  above — accepted gap, not silently different from today's AI Practice
  behavior everywhere else on this page, since Area Manager never had it).
- No staff-name filter outside Outlet Manager's three quiz sections.
- No topic filter on any CPD section.
- No "last N attempts" cap or pagination — filtering (not truncation) is the
  mechanism for keeping long lists manageable, per the existing codebase
  convention.

## i18n

Every new section heading, filter label, and "no results for this filter"
string needs EN + MS keys, following the exact existing naming pattern in
each view's i18n namespace (e.g. `videoTrainingHeading`, matching the
already-established `moduleQuizHeading`/`aiPracticeHeading` siblings;
`staffFilterLabel`, `allStaff`; `noAttemptsFiltered` reused where the string
is already generic enough, new one added only where it isn't). Full key
list will be finalized during the implementation plan, following this
project's standing rule: bilingual EN/MS for all user-facing text, checked
for parity before commit.

## Verification approach

Same as every prior feature in this project: `npm run build` clean after
each task, EN/MS key-parity script clean, curl/DB-level check not needed
(no backend changes), live Playwright browser verification of each new
filter combination (including the "switching one section's filter doesn't
affect another section's data" independence check, and the CPD
Coming-Soon/impersonation gate) using minted JWTs injected into
`localStorage` — the same technique used for the CPD Hours Tracking
feature's own verification, since real manager/supervisor PINs aren't
available this session.
