# Pharmacist Tag + Gated Pharmacist Courses — Design

**Date:** 2026-08-13
**Status:** Approved, pending plan

## Purpose

Sub-project B of the 3-part CPD initiative (A: CPD Hours Tracking, shipped
2026-08-13; C: mandatory-course compliance report, not started). Adds a
`is_pharmacist` tag on `staff_roster` (shown to users as "Pharmacist", the
column name itself is unchanged) plus a gated "Pharmacist Courses" section
only tagged staff can see. Courses can be either a YouTube video (existing
Video Training flow) or a reading-material page — both feed the same
120hr/year CPD target sub-project A already built.

## Scope decisions (from brainstorming)

- **Supervisor is the only role that can tag staff Pharmacist**, via a new
  company-wide staff directory tab in the Supervisor nav (no such
  company-wide staff list exists today — `staff_roster` reads are all
  outlet-scoped). Outlet/Warehouse Managers, who otherwise own their staff
  roster, do not get this control.
- **Pharmacist Courses reuses the existing `video_trainings` table** rather
  than a new table — a `pharmacist_only` boolean filters it into its own
  section. Same table also gains a `kind` ('video' | 'reading') and an
  optional `body` text field, so a course can be a YouTube video (existing
  flow) or a reading page (new) interchangeably, both under the same
  Supervisor add-form and the same hours-crediting mechanism.
- **Pharmacist Courses count toward the same 120hr CPD target** as everything
  else — no new accounting. This falls out for free from reusing
  `video_trainings.hours`, which sub-project A's `cpdHoursThisYear()` /
  `useCpdHours.js` already sum without caring about `pharmacist_only` or
  `kind`.
- **Retail division only** — same `division: 'retail'` route gate the
  general Video Training feature already uses. Pharmacists work in retail
  outlets.
- **Tag takes effect on next login, not mid-session.** `is_pharmacist` is
  returned by `POST /auth/staff-login` and stored in the client's `staff`
  object (same pattern as `name`/`outlet`/`division` today — built from the
  login response, not re-fetched). A staff member already logged in when
  Supervisor tags them won't see the nav item until they log back in. No
  live mid-session check on the frontend. The backend's gated list endpoint
  (`GET /video-trainings/pharmacist`) still re-verifies against the DB on
  every request regardless — the client-side flag only controls nav
  visibility, never authorization.
- **Reading-course unlock is a single "I've read this" button** — no
  scroll-tracking or timer. Matches `VideoWatchView.vue`'s ENDED-event gate
  in spirit (must acknowledge before the quiz unlocks) without the added
  complexity real watch-completion detection needs for video.

## Data model

```sql
alter table staff_roster add column if not exists is_pharmacist boolean not null default false;

alter table video_trainings alter column youtube_url drop not null;
alter table video_trainings add column if not exists kind text not null default 'video'; -- 'video' | 'reading'
alter table video_trainings add column if not exists pharmacist_only boolean not null default false;
alter table video_trainings add column if not exists body text; -- reading material; single field, not bilingual, matches content.body's existing shape
```

`youtube_url` becomes nullable because a `kind='reading'` row has no video.
`kind` is explicit rather than inferred from `youtube_url` being null, so
validation and rendering both have one unambiguous field to branch on.

## Backend

### Staff tagging (Supervisor-only, company-wide)

New routes on the existing `staffRouter` (`routes/staff.js`), alongside the
existing outlet-scoped staff routes but with `requireScope('supervisor')`
instead of `requireScope('outlet_manager', 'warehouse_manager')` and no
`checkOutletScope` call (Supervisor is company-wide, `scopeKey='ALL'`):

- `GET /staff/all` — `select id, division, outlet, name, id_note,
  is_pharmacist from staff_roster order by outlet, name`. Backs the new
  Supervisor staff-directory tab.
- `PATCH /staff/:id/pharmacist` — body `{isPharmacist: boolean}`, updates
  the row, `logAuditSafe` action `staff.pharmacist_tag`, summary includes
  outlet/name and old/new value.

### Course content (extends existing `routes/videoTraining.js`)

- `POST /video-trainings` (existing, Supervisor-only) — accepts new fields
  `kind` ('video' | 'reading', default 'video'), `pharmacistOnly` (boolean,
  default false), `body` (string, only relevant for `kind='reading'`).
  Validation: `kind='video'` requires a valid `youtubeUrl` (existing
  `extractYouTubeId` check, unchanged); `kind='reading'` requires non-empty
  `body`. `hours` stays required and validated (`Number.isFinite`, `> 0`)
  for both kinds — both credit CPD identically.
- `GET /video-trainings` (existing, all authenticated staff) — add `where
  pharmacist_only = false` to the query. This is the general Video Training
  list; pharmacist-only rows never appear here for anyone, tagged or not.
- New `GET /video-trainings/pharmacist` — `requireAuth`. Looks up the
  caller's `staff_roster` row by `(division, outlet, name)` parsed from
  `req.session.scopeKey` (same pattern `checkOutletScope` and
  `masterImpersonate.js`'s staff lookup already use), 403s if no matching
  row or `is_pharmacist = false`. Returns `pharmacist_only = true` rows
  (still filtered to the same "has an active question bank for its topic"
  join `GET /video-trainings` already applies, via a shared query fragment
  or a `pharmacistOnly` query param on the existing handler — implementation
  detail for the plan). This is the live authorization check; the client
  flag is advisory only.
- `DELETE /video-trainings/:id` (existing) — unchanged, already
  kind/flag-agnostic.

### Login response

`POST /auth/staff-login` — select `is_pharmacist` alongside `pin_hash` in
the existing query, return `isPharmacist` in the JSON response alongside
`authorized`/`token`.

## Frontend

**Supervisor:**
- New nav tab "Pharmacist" → `SupervisorPharmacistTagView.vue`. Table of
  every staff member (outlet, division, name, ID/Note), a toggle per row
  calling `PATCH /staff/:id/pharmacist`. Added to Supervisor's existing tab
  array, same pattern as its other tabs.
- `SupervisorAddResourcesView.vue`'s existing add-video-training block gets
  a kind selector (Video / Reading) and a "Pharmacist only" checkbox.
  YouTube URL field shows for Video, a body textarea shows for Reading;
  Hours stays required for both.

**Staff:**
- New sidebar nav item "Pharmacist Courses", `v-if="auth.staff?.isPharmacist"`,
  same `division: 'retail'` route meta as Video Training.
- New `PharmacistCoursesListView.vue` — mirrors `VideoTrainingListView.vue`
  exactly but fetches `GET /video-trainings/pharmacist`; each row routes by
  `kind`: `video` → existing `/video-watch/:id` (`VideoWatchView.vue`,
  unmodified — it's already generic over any `video_trainings` row);
  `reading` → new `/reading-view/:id` (`ReadingView.vue`).
- `ReadingView.vue` — shows the course's `body` text, an "I've read this"
  button. On click: fetch that topic's `video_questions` bank (same
  `api.getVideoQuestions(topic)` call `VideoWatchView.vue` already makes),
  hand off to `QuizView.vue` via the same `sessionStorage` envelope
  (`{kind: 'video', topic, questions}` — deliberately still `kind: 'video'`
  in the quiz envelope regardless of the course's own `kind`, since grading
  (`POST /data/video-results`) and CPD-hours crediting only key off `topic`,
  not whether the source was a video or a reading page).
- `store/auth.js`'s `login()` action — add `isPharmacist: data.isPharmacist`
  to the constructed `staff` object it stores.
- EN/MS strings for every new piece of UI (nav label, list view, reading
  view, Supervisor tag panel, add-course form's new fields), per the
  existing bilingual convention.

## Edge cases

- Non-pharmacist staff calling `GET /video-trainings/pharmacist` directly
  (bypassing the hidden nav) → 403, enforced by the backend's live DB
  check, not client-side hiding alone.
- Staff tagged mid-session sees no change until next login — documented
  behavior, not a bug (see Scope decisions).
- Tagging a warehouse-division staff member Pharmacist is not blocked at
  the tag-toggle level (no validation added) — it's simply a no-op, since
  the Pharmacist Courses route itself is retail-only. Not worth a special
  error for an action that already has no effect.
- `DELETE /video-trainings/:id` on a `pharmacist_only` row — unchanged
  existing behavior, works the same as any other row.
- Empty Pharmacist Courses list for a tagged staff member with no courses
  yet — same "no videos yet" empty state `VideoTrainingListView.vue`
  already has.

## Out of scope / explicitly not fixed here

- Sub-project C (mandatory-course compliance report) — separate spec/plan,
  builds on this sub-project's tag and course data but isn't designed here.
- No mid-session live tag refresh (see Scope decisions).
- No edit/rename endpoint for existing `video_trainings` rows — matches the
  existing create+delete-only pattern; changing a course's kind, flag, or
  body after creation means delete and re-add.
- No per-role visibility of the Pharmacist tag outside Supervisor's new tab
  (e.g. Outlet Manager's own Manage Staff list does not show it) — not
  requested.

## Testing / verification plan

- `curl`: `PATCH /staff/:id/pharmacist` without a Supervisor token →
  401/403; with one → 200, row updated, `audit_log` entry written.
- `curl`: `POST /video-trainings` with `kind=reading` and empty `body` →
  400; with `kind=video` and no `youtubeUrl` → 400 (existing check).
- `curl`: `GET /video-trainings` (general) never returns a
  `pharmacist_only=true` row, even authenticated as a tagged staff member.
- `curl`: `GET /video-trainings/pharmacist` as a non-tagged staff member →
  403; as a tagged staff member → 200, only `pharmacist_only=true` rows.
- `curl`: `POST /auth/staff-login` response includes `isPharmacist` matching
  the DB row.
- `npm run build` clean (frontend).
- EN/MS key-parity script clean.
- Live browser click-through: Supervisor tags a staff member via the new
  directory tab; that staff logs out and back in; "Pharmacist Courses" nav
  item appears; opens a reading course, "I've read this" unlocks the quiz,
  completes it, hours reflected in the same 120hr CPD number already shown
  on Dashboard. Confirm a non-tagged staff member never sees the nav item
  or can reach the gated list via a direct URL.
