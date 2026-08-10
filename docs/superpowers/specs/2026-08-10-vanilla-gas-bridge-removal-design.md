# Close vanilla's last GAS bridge (staff roster + Standard Quiz)

Date: 2026-08-10
Status: Approved design, not yet implemented

## Problem

`index.html` (vanilla) still hits GAS directly for one thing:
`fetchData()`'s pre-login bulk fetch of the staff roster and the full
Standard Quiz question bank (`GAS_URL`). Everything else in vanilla —
login, quiz saving, results, reports, resources, content, manage staff —
already goes through `BACKEND_URL` (see the vanilla section of
`SCOPE_TRACKER.md`). This bulk fetch was deliberately deferred at the
time because the new backend's staff-roster equivalent is shaped
differently (per-outlet, not one bulk list).

Investigating it surfaced a real, live issue beyond architecture
cleanliness: GAS's `doGet()` returns the raw `Questions` sheet — including
the `correct` answer column — to anyone, unauthenticated, before login.
Vanilla's Standard Quiz grades client-side straight off that leaked field
(`parseInt(q.correct)`). This is the exact class of bug already found and
fixed on the new backend/Vue side earlier this session (`GET /questions`
strips `correct`, grading happens server-side) — vanilla never got that
fix because it bypasses the backend for this one path entirely.

A related, already-live bug (vanilla's AI Practice reveal always showing
wrong, because `/quiz/redeem` already strips `correct` but vanilla's
`handleChoice()` didn't know that) was found during this same
investigation and fixed separately, immediately, ahead of this spec (see
commit `98fd393`) — it didn't depend on anything below and was actively
wrong for real users.

## Goals

- Vanilla never talks to GAS for anything, period — `GAS_URL` removed
  entirely, not just unused.
- Standard Quiz's answer key is never sent to the browser before it's
  needed, closing the leak — same guarantee `GET /questions` already
  gives the Vue app.
- Staff-roster lookups become per-outlet, matching the new backend's
  actual shape (no bulk list exists there by design).
- No behavior regression for real users — including fixing a smaller gap
  found along the way (see Decisions).

## Non-goals

- Any change to the Vue app's Standard Quiz flow — `QuizView.vue` already
  does this correctly; vanilla is being brought up to match it, not the
  other way round.
- Any change to how AI Practice questions are sourced (Gemini-generated,
  stored server-side) — unaffected by this work.
- The full GAS→new-stack production cutover — GAS still stays
  authoritative for now per CLAUDE.md; this closes vanilla's dependency
  on it, not the decision to stop using it as source of truth.

## Decisions made during brainstorming

**`GET /auth/staff-roster` gets extended to include `idNote`.** The
endpoint currently returns bare name strings — vanilla's current dropdown
shows an `IDNote` suffix to disambiguate duplicate names at the same
outlet (e.g. two people both named "AHMAD"), which would silently
regress if left as-is. Vue's `LoginView.vue` already has this same gap
(never had `IDNote` support at all). Fixing the endpoint once fixes both
call sites instead of shipping vanilla with a regression that matches an
existing Vue gap.

**Standard Quiz reveal mirrors AI Practice's already-fixed pattern
exactly** (`POST /questions/:id/check` per answer, live, same shape as
`POST /quiz/:outlet/check`) — proven pattern, same session, no new
design needed for it.

**Outlet Manager's Staff Review roster is fetched once per view-entry,
not per filter change.** `renderStaffReviewSummary()` is called both on
first entering the Staff Review section and every time one of its 3
topic filters changes (`onchange`, no roster dependency in a filter
change). Re-fetching staff roster on every filter tweak would be
wasteful; instead the roster is fetched once into a small cache
(`staffReviewRoster`) right before the first render, and the render
function itself stays synchronous, reading that cache — same shape as
today, no network call added to the filter-change path.

## Data model

No new tables or columns needed — `staff_roster.id_note` already exists
(added in an earlier session, per `SCOPE_TRACKER.md`).

## Backend changes (`lautan-academy-backend`)

### `GET /auth/staff-roster` (modified response shape)

`src/routes/auth.js`. Current:
```js
const { rows } = await pool.query(
  'select name from staff_roster where division = $1 and outlet = $2 order by name',
  [division, outlet]
);
res.json({ staff: rows.map(r => r.name) });
```
Becomes:
```js
const { rows } = await pool.query(
  'select name, id_note from staff_roster where division = $1 and outlet = $2 order by name',
  [division, outlet]
);
res.json({ staff: rows.map(r => ({ name: r.name, idNote: r.id_note || null })) });
```
Still public, no auth — unchanged from today. Request shape (`division`,
`outlet` query params) unchanged.

### `GET /questions`, `POST /questions/:id/check`

No changes — already correct, already stripping `correct`, already used
by Vue. Vanilla starts consuming these as-is.

## Frontend changes — vanilla (`index.html`)

### `fetchData()` (rewritten)

Drops the GAS call entirely. Becomes a `GET /questions` call against
`BACKEND_URL`, same response handling shape as today
(`allQuestions = data.questions || []`) minus the staff-roster line
(that moves to on-demand, below). `allStaffRoster` global and its
declaration are removed.

### `GAS_URL` constant — removed

No longer referenced anywhere once `fetchData()` is rewritten.

### `populateStaffNameOptions(division)` (rewritten, now async)

Currently filters the preloaded `allStaffRoster` array synchronously.
Becomes an `async` function that calls
`BACKEND_URL + '/auth/staff-roster?division=...&outlet=...'` on
division/outlet selection (mirrors `LoginView.vue`'s existing `watch`
pattern), and renders `${r.name}${r.idNote ? ' (' + r.idNote + ')' : ''}`
per option — same display format as today, just sourced from the new
response shape.

### `renderStaffReviewSummary()` and its caller (line ~1263)

A `staffReviewRoster` array is introduced, fetched once (`GET
/auth/staff-roster?division=retail&outlet=<mgr's outlet>`) right before
the existing call to `renderStaffReviewSummary()` at line ~1263 (that
enclosing function becomes `async` at the point of this one added
`await`). `renderStaffReviewSummary()` itself keeps its current
synchronous shape, reading `staffReviewRoster` instead of filtering
`allStaffRoster`.

### `handleChoice(idx, btn, q)` (Standard Quiz branch)

The AI Practice branch (already fixed, commit `98fd393`) stays as-is.
The `else` branch (`correctIdx = parseInt(q.correct)`, currently used for
Standard Quiz) is replaced with the same live-check shape as the AI
branch, calling `POST /questions/:id/check` with `q.id` and the chosen
index, reading `correctIndex` from the response. After this change,
`isAIQuiz` no longer needs to gate which branch runs — both paths call a
live check endpoint, differing only in URL/body — the function can
collapse to one shared shape branching only on which endpoint to call.

### `exitQuizWithAutosave()` (early-exit summary)

The `isAIQuiz ? null : parseInt(q.correct)` line added in the AI Practice
fix collapses to always `null` — no quiz type has a local `correct`
field anymore. Simplified to one path, `correctText` always
`'(not shown)'` for any unanswered question at early exit, both quiz
types.

## Frontend changes — Vue (`lautan-academy-frontend`)

### `LoginView.vue` (staff name dropdown)

Currently: `staffNames.value = data.staff || []`, rendered as
`<option v-for="n in staffNames" :key="n" :value="n">{{ n }}</option>`.
Response shape is now `[{name, idNote}]` instead of `[name]` — updates to
`:key="n.name" :value="n.name"`, display text
`{{ n.name }}{{ n.idNote ? ' (' + n.idNote + ')' : '' }}`. New capability
for Vue, not a fix to an existing bug — Vue never had `IDNote` support.

### `api/client.js`

No signature change — `getStaffNames(division, outlet)` still calls the
same endpoint the same way. Only the shape of what it resolves to
changes, handled at the `LoginView.vue` call site above.

## Testing plan

- Backend: curl `GET /auth/staff-roster?division=retail&outlet=<real
  outlet>` before/after, confirm response shape changes from bare
  strings to `{name, idNote}` objects, `idNote` is `null` for staff
  without one (not an error, not omitted).
- Vanilla: `npm`-free syntax check (extract the inline `<script>` block,
  `node --check`, same approach already used earlier this session).
  Browser: full Standard Quiz run end-to-end (topic pick → answer
  reveal, both correct and wrong, matches the DB's real `correct` value →
  submit → confirm saved result matches what was shown during the quiz);
  staff login dropdown shows `IDNote` again for outlets known to have a
  duplicate name; Outlet Manager's Staff Review section renders with the
  real roster, filters still work without extra network calls per
  filter change (visually confirm via browser devtools network tab —
  one roster fetch, not one per filter click).
- Vue: `npm run build` clean; browser check `LoginView.vue`'s dropdown
  now shows `IDNote` where applicable (new capability, confirm it
  doesn't break the case where `idNote` is `null`).
- Confirm `GAS_URL` no longer appears anywhere in `index.html`
  (`grep -c GAS_URL index.html` → `0`).
- Security check: confirm the GAS Apps Script URL, if hit directly in a
  browser, is now irrelevant to the running app (vanilla no longer reads
  its response) — the underlying GAS deployment itself still exists and
  could still be independently secured/retired later, out of scope here
  (this spec closes vanilla's *dependency* on it, not the GAS deployment
  itself).
