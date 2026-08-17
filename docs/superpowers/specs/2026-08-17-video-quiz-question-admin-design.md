# Video/Reading Quiz Question Admin — Design

**Date:** 2026-08-17
**Status:** Approved, pending plan

## Purpose

`video_questions` (the quiz bank behind Video Training and Pharmacist
Courses) has no in-app CRUD — only GET (list by topic) and POST /:id/check
(grade) exist. Supervisor currently has no way to add/edit/delete these
questions except manual Supabase table-editor inserts. This gives
Supervisor a real in-app path: insert, modify, delete, zero DB touch after.

Scoped to `video_questions` only (not `standard_questions`/Module Quiz —
deferred, see [[pending_module_quiz_question_admin]]; standard_questions
has real prod data across 10 topics, video_questions is currently empty).

## Scope decisions (from brainstorming)

- **Supervisor-only**, not Master. Matches the closest sibling features —
  `content.js` and `video_trainings` CRUD are both Supervisor-gated, since
  Supervisor already owns the course/topic content these questions belong
  to. (The `areas`/`store_outlets` CRUD pattern referenced in the original
  pending-task memory note is Master-gated for an unrelated reason —
  outlet/region structure — not a fit here.)
- **Standalone new page**, not folded into `SupervisorAddResourcesView.vue`
  (where courses are added). Kept separate rather than nested under each
  course row.
- **Hard delete**, matching `content.js`/`video_trainings`'s own DELETE
  pattern. No soft-delete: the `status` column exists in the schema but has
  only ever held `'active'` in real data (no admin path has ever written
  anything else) — introducing a new status value here would be new
  behavior, not reuse of an existing convention.
- **Both question types supported**: MCQ (4 options, `correct` 0-3) and
  True/False (2 options, `correct` 0-1, opt3/opt4 stored as `''` not
  `null` — matches the existing row shape already confirmed live in
  `standard_questions`, see [[pending_module_quiz_question_admin]]).
- **Delete is blocked on a topic's last remaining question.**
  `videoTraining.js`'s existing list queries only show a course to staff if
  its topic has >=1 row in `video_questions` (an `exists` join). Deleting
  the last one would silently vanish the course from staff view with no
  warning. Matches the existing protective pattern `masterOutlets.js` uses
  (can't deactivate an area with active outlets still assigned).
- **Topic picked from a dropdown**, not free text. `video_questions.topic`
  is a plain string match against `video_trainings.topic` — no FK, no
  case/whitespace normalization anywhere in the existing code. A typo in a
  free-text field would silently orphan the question (it would never
  appear in any quiz, with no error anywhere). The dropdown is populated
  from `GET /video-trainings` + `GET /video-trainings/pharmacist`'s real
  topic values, so a question can only be attached to a topic that already
  has a real course.

## Data model

No schema changes. Reuses `video_questions` exactly as it exists today:
`id, topic, question_en, question_ms, opt1-4_en, opt1-4_ms, correct
(integer), status (text), created_at`.

## Backend

Extends the existing `videoQuestionsRouter` in `routes/videoTraining.js`
(currently GET `/` and POST `/:id/check` only). All three new routes:
`requireAuth, requireScope('supervisor')`.

- **`POST /video-questions`** — body `{topic, type: 'mcq' | 'tf',
  question_en, question_ms, opt1_en, opt2_en, opt3_en, opt4_en, opt1_ms,
  opt2_ms, opt3_ms, opt4_ms, correct}`.
  - `topic` required, must match an existing row in `video_trainings`
    (either the general or pharmacist-only list) — 400 otherwise.
  - `type='mcq'`: `question_en`/`question_ms`/all 4 `opt*_en`/all 4
    `opt*_ms` required non-empty; `correct` must be an integer 0-3.
  - `type='tf'`: `question_en`/`question_ms`/`opt1_en`/`opt2_en`/
    `opt1_ms`/`opt2_ms` required non-empty; `opt3_en`/`opt4_en`/`opt3_ms`/
    `opt4_ms` forced to `''` regardless of what's sent; `correct` must be
    an integer 0-1.
  - Inserts, `logAuditSafe` action `video_question.add`, summary includes
    topic + truncated question text.
- **`PATCH /video-questions/:id`** — same body shape and validation as
  POST, full-row overwrite (no partial-field semantics — matches
  `masterOutlets.js`'s `PATCH /areas/:id` in spirit but this endpoint
  always expects every field, since a question's fields are all
  interdependent on `type`). 404 if id doesn't exist. `logAuditSafe` action
  `video_question.update`.
- **`DELETE /video-questions/:id`** — looks up the row's `topic` first
  (404 if missing), counts other rows sharing that topic
  (`select count(*) from video_questions where topic = $1 and id != $2`).
  If zero, 400 `"Can't delete: this is the only question left for
  <topic> — the course would disappear from staff view."` Otherwise
  deletes. `logAuditSafe` action `video_question.delete`.

No changes to the existing GET `/` (list by topic) or POST `/:id/check` —
GET already doubles as the admin list view (no status filtering to add
since hard-delete means every row is always "live").

## Frontend

New `SupervisorManageQuizQuestionsView.vue`, new Supervisor-only sidebar
nav item (alongside Add Resources / Pharmacist Tag), added to Supervisor's
existing tab/nav array following the same pattern as its siblings.

- **Topic dropdown**: merged + deduped topics from `GET /video-trainings`
  and `GET /video-trainings/pharmacist` (both already-authenticated calls
  Supervisor can make — `/pharmacist` explicitly allows the supervisor
  scope unconditionally, per the existing Pharmacist Tag design). Only
  topics with a real course appear — can't create an orphaned question.
- **Question list**: on topic selection, `GET /video-questions?topic=X`
  (existing endpoint). Each row shows the EN question text, correct answer
  highlighted, Edit and Delete buttons — same list-row visual pattern as
  `SupervisorAddResourcesView.vue`'s existing course list.
- **Add/Edit form**: MCQ / True-False toggle switches the option-field
  count shown (2 vs 4). Bilingual EN/MS text inputs for the question and
  each visible option. Correct-answer picker (radio or select) scoped to
  only the currently-visible options. Edit pre-fills from the selected
  row's existing data (type inferred from whether opt3/opt4 are empty).
- **Delete**: `confirm()` dialog (existing pattern, e.g.
  `ManageStaffPanel.vue`'s remove-staff confirm). On the backend's 400
  last-question block, surface that exact error message in place of a
  generic failure toast.
- **i18n**: new keys in both `en.json`/`ms.json` for this view's UI chrome
  (nav label, form labels, buttons, the delete-block error message).
  Question content itself is already bilingual per-row data, not UI
  string translation.

## Edge cases

- Deleting the last question for a topic → 400, blocked (see Scope
  decisions). Deleting a topic's second-to-last question is allowed even
  though it leaves exactly one — only zero is blocked.
- Editing a question's `type` from MCQ to True/False (or back) via PATCH —
  allowed, same validation as create; switching to `tf` blanks opt3/opt4
  server-side regardless of what the client sends, so a stale MCQ opt3/4
  value can't survive a type change by accident.
- A topic appearing in both the general and pharmacist-only course lists
  is not possible today (a topic belongs to exactly one `video_trainings`
  row), so the merged dropdown never needs de-duplication logic beyond a
  plain array unique — noted for completeness, not a real risk currently.
- Deleting a `video_trainings` course itself (existing `DELETE
  /video-trainings/:id`, unchanged by this work) does **not** cascade-
  delete its `video_questions` rows — matches today's behavior (no FK, no
  cascade anywhere in this schema). Orphaned questions for a deleted
  course are inert (never matched by any join) but not cleaned up
  automatically. Not addressed here — same gap exists today, out of scope
  for this subsystem.

## Out of scope / explicitly not fixed here

- `standard_questions` (Module Quiz) CRUD — separate future subsystem, see
  [[pending_module_quiz_question_admin]].
- No bulk import/export.
- No reordering of questions within a topic (list order is `order by id`,
  i.e. creation order — matches the existing GET `/` behavior).
- No cleanup of orphaned `video_questions` rows when their parent
  `video_trainings` course is deleted (see Edge cases).

## Testing / verification plan

- `curl`, disposable test topic/rows (same throwaway-and-cleanup pattern
  already used this session to confirm 0-indexed grading):
  - `POST /video-questions` without a Supervisor token → 401/403.
  - `POST /video-questions` with unknown `topic` → 400.
  - `POST /video-questions` `type='mcq'` missing an option → 400;
    `correct=4` → 400.
  - `POST /video-questions` `type='tf'` → 200, row has `opt3_en=''`/
    `opt4_en=''` regardless of what was sent for them; `correct=2` → 400.
  - `PATCH /video-questions/:id` happy path → 200, row updated, audit row
    written; unknown id → 404.
  - `DELETE /video-questions/:id` on a topic with 2+ questions → 200,
    audit row written; on a topic's last question → 400, row NOT deleted
    (verify with a follow-up GET).
- `npm run build` clean (frontend).
- EN/MS key-parity script clean.
- Live browser click-through: add an MCQ question, add a True/False
  question, edit one, delete one (non-last), attempt delete on a topic's
  last question and confirm the block message renders, confirm the nav
  item/page is invisible to non-Supervisor roles.
