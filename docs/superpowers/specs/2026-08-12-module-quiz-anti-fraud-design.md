# Module Quiz Anti-Fraud (Abandon Lock) — Design

**Date:** 2026-08-12
**Status:** Approved, pending plan

## Purpose

Standard/Module Quiz (`ModuleQuizView.vue` → `QuizView.vue`, `kind === 'standard'`)
is the quiz type Area Manager Assessment scores against ([[project_lautan_academy]]).
Today, a staff member can answer question 1, see the live per-question
correct/wrong reveal, and abandon (navigate elsewhere in-app, or close the
tab/app) without ever hitting Submit. Because `results` rows are only
written from `submit()`, no attempt is recorded — the "already attempted
today" gate (`ModuleQuizView.vue`'s `alreadyAttemptedToday`, and the
backend's same-day no-op in `POST /data/results`) never triggers, so they
can retry indefinitely until they land a good score. This closes that gap:
once ≥1 question is answered, the attempt is locked in and gets recorded
as finished (unanswered questions graded wrong) even if the staff member
never presses Submit.

## Scope decisions (from brainstorming)

- **Module/Standard Quiz only** (`kind === 'standard'`). AI Practice
  (`kind === 'ai'`, passcode-based, `ai_results` table) is explicitly
  framed as practice, not assessed — left untouched, staff can still
  freely abandon/retry it.
- **In-app navigation away** (clicking another nav link/sidebar item while
  `answeredCount >= 1`): a `confirm()` dialog warns the user leaving will
  submit their current answers as final; confirming grades-and-saves via
  the existing endpoint, then allows navigation; cancelling blocks it and
  keeps them on the quiz.
- **Real tab/app close**: best-effort only, no dialog possible. A
  `pagehide`/`visibilitychange` listener fires a `fetch(..., {keepalive:
  true})` call to the same grading endpoint. Explicitly accepted
  limitation: a hard force-kill or total connectivity loss at that exact
  instant can still result in no row being saved — no fully reliable
  client-side solution exists for that case without a heavier
  server-side session/heartbeat architecture, which is out of scope here.
- **Back button** is disabled once `answeredCount >= 1` (on top of its
  existing `currentIndex === 0` disabled state) — forward-only from the
  first answer onward. Answers were already locked/uneditable once given
  (`isRevealed`), so this only removes the ability to *view* a prior
  question, not to change one.
- **No new "abandoned" marker.** An auto-submitted attempt is written as
  an ordinary `results` row, identical in shape to a manually-submitted
  one — matches the request that it be "recorded like other finished
  quiz." Area Manager Assessment, Staff Results, and Quiz History all
  read it exactly as they read any other result, no changes needed there.
- **No backend/schema changes.** `POST /data/results` already grades a
  `chosen === undefined` answer as wrong and already no-ops a same-day
  duplicate — reused as-is, just invoked automatically instead of only
  from the Submit button.

## Data flow

```
Staff answers Q1 (kind === 'standard')
  -> answeredCount >= 1
  -> Back button disabled from here on

Path A: staff clicks Submit (last question, all answered)
  -> submitQuiz() [existing behavior, unchanged]

Path B: staff clicks another nav link mid-quiz
  -> onBeforeRouteLeave guard fires
  -> confirm() dialog
     -> OK: await submitQuiz() (partial answers graded, unanswered = wrong) -> allow nav
     -> Cancel: block nav, stay on quiz

Path C: staff closes tab / backgrounds the app
  -> pagehide / visibilitychange(hidden) listener
  -> fetch(POST /data/results, {keepalive: true, Authorization header, partial answers})
  -> best-effort, no UI feedback (page is gone)
```

`submitQuiz()` is `submit()` extracted into a reusable function, guarded by
a `hasSubmitted` flag so Path A/B/C can never double-fire against the same
attempt (the backend's same-day no-op is a second, redundant backstop).

## Implementation surface

- `QuizView.vue`: extract `submitQuiz()`, add `hasSubmitted` flag, add
  `onBeforeRouteLeave` guard (vue-router), add `pagehide`/`visibilitychange`
  listener using `fetch(..., {keepalive: true})` (not `navigator.sendBeacon`
  — beacon can't carry the `Authorization: Bearer` header this API
  requires), disable Back button once `answeredCount >= 1`. All new logic
  gated on `kind === 'standard'`.
- `api/client.js`: optional small helper alongside the existing
  `saveResult` for the keepalive variant, kept consistent with how every
  other request goes through this module.
- `i18n/locales/{en,ms}.json`: new `quizView.confirmLeaveAutoSubmit` key
  (bilingual, per project convention).
- No backend, schema, or other view changes.

## Out of scope / explicitly not fixed here

- AI Practice quiz retains today's fully-abandonable behavior.
- No new UI marker distinguishing an auto-submitted attempt from a
  manually-submitted one.
- No heartbeat/server-reserved-attempt mechanism for the force-kill edge
  case — accepted as a known, unclosed gap per the brainstorm discussion.
