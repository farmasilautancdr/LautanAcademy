# Video Training — Design

**Date:** 2026-08-12
**Status:** Approved, pending plan

## Purpose

Add a training format where retail staff watch an uploaded (YouTube-hosted,
in-app embedded) video and, once it ends, are routed into a timed quiz based
on that video's content. This is a new capability, not a variant of Module
Quiz's existing flow — it gets its own question bank, its own list page, and
its own per-question timer, while reusing `QuizView.vue`'s existing
quiz-taking UI, grading pattern, and anti-fraud protections rather than
forking a parallel component.

## Scope decisions (from brainstorming)

- **Video hosting: YouTube, Unlisted.** Chosen over direct file upload
  (no new storage cost/quota, no size-limit problem — videos are much larger
  than the 20MB `content-files`/resources cap) and over Google Drive links
  (Drive's preview iframe has no reliable "ended" playback event; this
  project has also already hit Drive service-account storage/sharing
  fragility on resource uploads — see [[project_lautan_academy]]). YouTube's
  IFrame Player API gives a real, reliable `ENDED` state to trigger the quiz.
  Embedded inline in `VideoWatchView.vue` — staff never navigate to
  youtube.com, the video plays inside the app page.
  - **Accepted risk, explicitly discussed and confirmed, not mitigated
    further:** "Unlisted" is not access-controlled — anyone holding the raw
    video URL/ID can watch it outside the app, and a determined leak (e.g.
    to a competitor) is possible. Alternatives considered and rejected:
    YouTube Private (per-account allowlist — unworkable, staff don't have
    individual Google accounts, only outlet/passcode logins), Google Drive
    with Workspace domain restriction (real per-person access control, but
    reintroduces the no-reliable-ended-event problem and Drive's existing
    quota/sharing fragility), Vimeo domain-restricted embedding (real
    improvement over plain Unlisted, but a recurring paid cost and a new
    vendor dependency, and still not leak-proof against someone finding the
    raw watch-page URL). Decision: stick with free YouTube Unlisted,
    knowingly accept the risk.
- **Free seeking allowed.** Staff can scrub/rewind/fast-forward the embedded
  player. The quiz is still gated on the player's real `ENDED` event, not on
  elapsed watch time, so this doesn't weaken any technical control that
  otherwise existed — it's a deliberate simplicity choice, not a compromise.
- **Separate `video_questions` table**, not a `kind` column bolted onto
  `standard_questions`. Same column shape (topic-grouped, EN/MS text,
  4 options, `correct` index, `status`), but Module Quiz's topic list and
  Video Training's topic list can never accidentally collide or mix.
  Seeded manually via the Supabase table editor for now — same as
  `standard_questions` today (no CRUD UI exists for either; see the
  existing `[PENDING] Module quiz question admin` item in this repo's
  `MEMORY.md`, which applies equally here).
- **Per-question timer: fixed 30 seconds, not configurable per video.**
  Countdown starts when a question is shown; reaching 0 with no answer
  auto-advances (counts as unanswered/wrong, same grading `POST
  /data/results` already gives any unanswered question).
- **Quiz UI: navigate to the existing `/quiz` route**, not a modal/popup
  over the video page. Reuses `QuizView.vue` as-is (extended, not forked) —
  same question-taking UI, live per-answer reveal, and Result screen Module
  Quiz already has.
- **Graded and saved like a real result.** A video-training quiz attempt
  writes to the same `results` table Module Quiz uses (topic string alone
  distinguishes it), shows up in Quiz History and the dashboard average —
  not a pass/fail-only comprehension check.
- **Anti-fraud guard extended to cover this flow.** The abandon-lock built
  for Module Quiz (`docs/superpowers/specs/2026-08-12-module-quiz-anti-fraud-design.md`)
  — confirm-on-navigate-away, best-effort save-on-tab-close, Back button
  disabled once answered — widens from `kind === 'standard'` to
  `['standard', 'video'].includes(kind)`. A graded, saved attempt deserves
  the same protection against retry-by-abandoning that Module Quiz already
  has.
- **Retail staff only**, same audience as Module Quiz (warehouse staff only
  have AI Practice today — this doesn't change that).
- **Supervisor manages video training entries** (add/list/delete: title,
  topic, YouTube link) — same role already trusted with Content management,
  same gating pattern (`requireScope('supervisor')`), same audit-log
  convention.
- **Dead-end prevention:** the video list only shows a video if its topic
  currently has ≥1 active row in `video_questions` — a staff member can
  never finish watching a video and then hit "no questions found."

## Data model

New tables, `sql/schema.sql`:

```sql
create table if not exists video_trainings (
  id bigserial primary key,
  title text not null,
  topic text not null,
  youtube_url text not null,
  created_at timestamptz not null default now()
);

create table if not exists video_questions (
  id bigserial primary key,
  topic text not null,
  question_en text not null,
  question_ms text not null,
  opt1_en text, opt2_en text, opt3_en text, opt4_en text,
  opt1_ms text, opt2_ms text, opt3_ms text, opt4_ms text,
  correct int not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
```

`video_trainings.topic` and `video_questions.topic` are matched by plain
text, same loose-coupling convention `standard_questions.topic` already
uses with Module Quiz — no foreign key, a video's topic just needs to match
one used in `video_questions`.

## Backend

New `routes/videoTraining.js`:

- `GET /video-trainings` (auth, any staff) — lists `{id, title, topic,
  youtubeUrl}`, filtered to topics with ≥1 active `video_questions` row
  (a join/exists check, not a client-side filter — keeps the dead-end
  guarantee server-authoritative).
- `GET /video-questions?topic=` (auth) — mirrors `GET /questions`, scoped to
  one topic (the video page already knows which topic it needs after the
  video ends; no reason to ship the whole bank).
- `POST /video-questions/:id/check` (auth, rate-limited via
  `hitRateLimit('check_video_...', 80, 10min)`, same shape as the existing
  `check_std_` limiter) — mirrors `POST /questions/:id/check`, live
  per-answer reveal against `video_questions`.
- `POST /video-trainings` (auth, `requireScope('supervisor')`) — validates
  `youtube_url` matches `youtube.com/watch?v=` or `youtu.be/` (regex),
  extracts/normalizes the video ID, rejects anything else. Audit-logged
  (`video_training.add`), mirrors `content.js`'s add handler.
- `DELETE /video-trainings/:id` (auth, `requireScope('supervisor')`) —
  audit-logged (`video_training.delete`), mirrors `content.js`'s delete.

`routes/data.js`: new `POST /data/video-results`, structurally identical to
`POST /data/results` (name/outlet/topic/answers in, same-day no-op via
`isSameCalendarDay`, server re-derives the real question count/answer key
from `video_questions` rather than trusting the client) except it queries
`video_questions` instead of `standard_questions`. Writes to the same
`results` table — no new results table, no new column, `topic` alone is
enough to identify it.

## Frontend

**Navigation:** `AppSidebar.vue` gets a new "Video Training" item, gated
`auth.staff?.division === 'retail'` — identical condition to the existing
Module Quiz item.

**`VideoTrainingListView.vue`** (`/video-training`) — mirrors
`ModuleQuizView.vue`'s structure: fetch `GET /video-trainings` on mount,
render a list (title + topic), click navigates to `/video-watch/:id`.

**`VideoWatchView.vue`** (`/video-watch/:id`) — loads the YouTube IFrame
Player API script once (guarded against double-injection if the user
navigates back to this route type more than once in a session), embeds the
video for the given id's `youtubeUrl`. On the player's `onStateChange`
firing `YT.PlayerState.ENDED`: fetch `GET /video-questions?topic=<that
video's topic>`, store `{kind: 'video', topic, questions}` into
`sessionStorage['lautan_active_quiz']` — the exact same envelope shape
`QuizView.vue` already reads for `'standard'`/`'ai'` — then
`router.push('/quiz')`.
- If the IFrame API script fails to load (network hiccup, blocked
  script): show an inline "Couldn't load the video player — refresh and
  try again" message. No manual bypass into the quiz — the `ENDED` event is
  the only completion signal this design has; a bypass button would defeat
  it entirely.

**`QuizView.vue`** — extended, not forked. `kind` (already
`'standard' | 'ai'`) gains `'video'`:
- New per-question countdown (30s, `setInterval`/`setTimeout` reset on
  `currentIndex` change), rendered only when `kind === 'video'`. Reaching
  0 with the current question unanswered behaves exactly like clicking
  "Next" (or "Submit", if it's the last question) with that question
  blank — no special-cased grading path, it flows through the same
  `gradeAndSave()` unanswered-question handling `'standard'` already has.
- `selectAnswer()`: branches to `api.checkVideoAnswer(id, chosen)` when
  `kind === 'video'` (new client method hitting `POST
  /video-questions/:id/check`), same pattern as the existing
  `checkStandardAnswer`/`checkAiAnswer` branch.
- `gradeAndSave()`: branches to `api.saveVideoResult(...)` (new client
  method hitting `POST /data/video-results`) when `kind === 'video'`.
- Anti-fraud guard (`onBeforeRouteLeave`, `pagehide` listener) and the
  Back-button-disabled-once-answered rule: condition widens from
  `kind !== 'standard'` / `kind === 'standard'` to checking membership in
  `['standard', 'video']`.

**Supervisor management:** extend `SupervisorAddResourcesView.vue` with a
second list+form block (title / topic / YouTube link fields), same shape as
the existing Content add/list/delete form on that page. New `api/client.js`
methods: `addVideoTraining`, `deleteVideoTraining`, alongside
`getVideoTrainings`, `getVideoQuestions`, `checkVideoAnswer`,
`saveVideoResult`.

**i18n:** new keys under a `videoTrainingListView` / `videoWatchView`
namespace (list/watch pages) plus additions to `quizView`/
`supervisorAddResourcesView` for the extended pieces — bilingual (EN/MS),
per project convention.

## Data flow

```
Staff opens "Video Training" (retail only)
  -> GET /video-trainings (only topics with an active question bank)
  -> picks one -> /video-watch/:id

VideoWatchView: loads YouTube IFrame Player, staff watches (free seek ok)
  -> onStateChange ENDED
  -> GET /video-questions?topic=X
  -> sessionStorage['lautan_active_quiz'] = {kind:'video', topic, questions}
  -> router.push('/quiz')

QuizView (kind === 'video'):
  -> per-question 30s timer, same anti-fraud guard as Module Quiz
  -> answer picked -> POST /video-questions/:id/check (live reveal)
  -> Submit (or auto-submit via guard/timeout)
     -> POST /data/video-results (server re-grades from video_questions,
        same-day no-op, writes to `results`)
  -> /result (existing ResultView.vue, unchanged)
```

## Out of scope / explicitly not fixed here

- No in-app CRUD/authoring UI for `video_questions` rows (manual Supabase
  editor entry, matching `standard_questions`'s current state).
- No configurable per-video timer duration — fixed 30s everywhere.
- No video upload/hosting inside this app's own infrastructure.
- No true per-staff-identity access control on the video content — the
  accepted-risk YouTube Unlisted approach described above.
- No changes to Module Quiz's or AI Practice's own behavior beyond the
  anti-fraud guard's widened `kind` check (which was already going to
  include future non-`'standard'` graded kinds per that spec's own
  reasoning).
