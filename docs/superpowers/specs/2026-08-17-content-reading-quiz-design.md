# Browse Courses Reading Quiz + CPD — Design

**Date:** 2026-08-17
**Status:** Approved, pending plan

## Purpose

Browse Courses' "Knowledge" entries (`content` table — real in-app text
bodies, distinct from Drive-backed file/link resources) currently have no
completion signal and award no CPD hours. Supervisor wants to opt individual
entries into a reading-gate: staff reads the material, answers a quiz, earns
CPD hours. Everything not opted in stays exactly as today — plain inline
read, still usable as AI Practice's quiz-generation source (unaffected,
managers keep "Create Quiz From This" regardless of the flag).

## Scope decisions (from brainstorming)

- **Opt-in per entry, Supervisor-controlled** (`quiz_required` flag) — not
  every Knowledge entry, only ones Supervisor explicitly marks. Unmarked
  entries are untouched: same inline `<details>` expand, still available as
  AI Practice fodder via the existing "Create Quiz From This" hand-off.
- **No clash with AI Practice.** The two mechanisms stay conceptually
  separate and both keep working on the *same* Content entry if desired:
  AI Practice = ephemeral, manager-initiated, passcode-shared, any topic,
  zero pre-authored questions. This feature = permanent, staff-initiated,
  tied to one specific entry, Supervisor pre-authors a fixed question bank
  once. Marking an entry `quiz_required` does not remove or restrict a
  manager's ability to also generate an AI quiz from it.
- **Retail division only** — matches Module Quiz/Video Training's existing
  `division: 'retail'` route gate. Warehouse staff (and Browse Courses
  itself, and AI Practice) stay division-agnostic as today; only this new
  reading-quiz-CPD path is retail-gated. A warehouse staff member sees a
  `quiz_required` entry exactly as before (plain inline expand, no gate, no
  quiz, no CPD) — no regression for them.
- **Supervisor sets real hours per entry** (mirrors `video_trainings.hours`),
  not a flat rate — Content entries vary too much in length/depth for one
  number to fit all, unlike Module Quiz's genuinely-uniform standard
  questions.
- **CPD-capped to first attempt per topic per year** — same rule just
  shipped for Module Quiz (2026-08-17, `data.js`'s `cpdHoursThisYear()` /
  `useCpdHours.js`'s `hoursByStaff()`), *not* Video Training's
  stacks-every-attempt behavior. A staff member re-reading the same entry
  next year (new calendar year) is credited again — matches the existing
  per-year reset every other CPD source already uses.
- **New table for the question bank** (`content_questions`), not a
  bolt-on to `video_questions` — keeps `video_trainings`'s topic namespace
  and `content`'s topic namespace independently checkable, and exactly
  mirrors the CRUD pattern/route shape already shipped for `video_questions`
  (2026-08-17) rather than inventing a new one.
- **Attempts land in the existing `results` table**, same pattern Module
  Quiz and Video Training already share — topic membership in `content`
  (where `quiz_required`) is the third discriminator alongside
  `video_trainings` membership. No new results table.
- **Reading gate is a single "I've read this" button** — no scroll-tracking
  or timer, matches `ReadingView.vue`'s existing Pharmacist Courses pattern
  exactly (self-attested, not enforced).
- **No edit endpoint for `content`** — matches `video_trainings`'s existing
  create+delete-only convention. Changing an entry's `quiz_required`/`hours`
  after creation means delete and re-add; the question bank survives this
  since it's keyed by `topic` text, not the content row's id (same as
  `video_questions`/`video_trainings` today).

## Data model

```sql
alter table content add column if not exists quiz_required boolean not null default false;
alter table content add column if not exists hours numeric not null default 1;

create table if not exists content_questions (
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

`content_questions` is a field-for-field copy of `video_questions`'s shape
— same MCQ (4 options, `correct` 0-3) / True-False (2 options, `correct`
0-1, opt3/opt4 forced `''` server-side) support, same `status` column that
in practice never leaves `'active'`.

## Backend

### Content entries (extends existing `routes/content.js`)

- `POST /content` (existing, Supervisor-only) — accepts new optional
  `quizRequired` (boolean, default false) and `hours` (number, default 1,
  validated `Number.isFinite` + `> 0` — reuses the exact check
  `POST /video-trainings` already applies to its own `hours` field). Only
  relevant/required when `quizRequired` is true; a non-quiz entry ignores
  `hours` (stored as the default 1, never read).
- `GET /content` (existing) — response gains `QuizRequired`/`Hours` fields
  (`c.quiz_required`, `c.hours`), same casing convention as every other
  field this endpoint returns.
- `DELETE /content/:id` (existing) — unchanged, already flag-agnostic.

### Content quiz bank (new `routes/content.js` additions or a sibling
`contentQuestionsRouter`, mounted at `/content-questions`)

Direct copy of `video_questions`' three admin routes
(`videoQuestionsRouter.post/patch/delete` in `routes/videoTraining.js`,
lines ~259-346), s/video_questions/content_questions/ and s/video_trainings/
content/ throughout:

- `POST /content-questions` — validates `topic` against a real `content`
  row (not just non-empty — same orphan-prevention reasoning as
  `video_questions`' `topicExists()`), same MCQ/TF validation.
- `PATCH /content-questions/:id` — full-row overwrite, same as
  `video_questions`.
- `DELETE /content-questions/:id` — blocks deleting a topic's last question
  (`GET /content` should only surface a `quiz_required` entry as
  quiz-ready if its topic has >=1 active question — see Edge cases).
- `GET /content-questions?topic=` (new, mirrors the existing
  `videoQuestionsRouter` list-by-topic GET used both for quiz-taking and
  for the admin view) + `POST /content-questions/:id/check` (mirrors the
  existing per-question check endpoint, same rate limit
  `hitRateLimit('check_content_${scopeKey}', 80, 10*60*1000)`).

### Grading (extends `routes/data.js`)

- New `POST /data/content-results` — direct copy of `POST /data/video-results`
  (server-authoritative grading against `content_questions`, same-day
  dedup via `isSameCalendarDay`, same `wrong_answers` write, `staff_retail`
  scope check only). Writes into the same `results` table, discriminated by
  topic membership in `content` where `quiz_required = true`.

### CPD hours (`cpdHoursThisYear()` becomes a 3-way split)

```sql
-- Video Training: real hours, every attempt stacks (unchanged).
select coalesce(sum(coalesce(vt.hours, 1)), 0) as hours
from results r join video_trainings vt on vt.topic = r.topic
where r.outlet=$1 and r.name=$2 and extract(year from r.created_at) = extract(year from now())

-- Content quiz: real hours, capped to first attempt per topic per year (new).
select coalesce(sum(first_attempts.hours), 0) as hours
from (
  select distinct on (r.topic) r.topic, c.hours
  from results r
  join content c on c.topic = r.topic and c.quiz_required
  where r.outlet=$1 and r.name=$2 and extract(year from r.created_at) = extract(year from now())
  order by r.topic, r.created_at asc
) first_attempts

-- Module Quiz: flat 1hr, capped to first attempt per topic per year (unchanged from the 2026-08-17 fix).
select count(distinct r.topic) as topics
from results r
where r.outlet=$1 and r.name=$2 and extract(year from r.created_at) = extract(year from now())
  and not exists (select 1 from video_trainings vt where vt.topic = r.topic)
  and not exists (select 1 from content c where c.topic = r.topic and c.quiz_required)
```

The Content-quiz branch needs `distinct on` (pick the earliest row per
topic, then sum *that* row's hours) rather than Module Quiz's plain
`count(distinct topic)` — because unlike Module Quiz's uniform 1hr, each
Content topic can carry a *different* Supervisor-set rate, so which
specific topic got attempted first actually matters for the sum, not just
how many distinct topics did.

Module Quiz's `not exists` condition gains a second clause so a
`quiz_required` Content topic is never double-counted as a Module Quiz
attempt too (topic collision safety net, on top of the existing "topic
namespaces don't collide by design" convention).

### `useCpdHours.js` (client-side mirror)

`hoursByStaff()` takes a third `contentHoursByTopic` map (parallel to the
existing `hoursByTopic` for Video Training) and applies the same
per-(staff,topic) `Set`-based dedup the Module Quiz branch just gained,
but adds the topic's real hours instead of the flat `MODULE_QUIZ_HOURS`
constant. Precedence when a topic could theoretically match more than one
map: Video Training first, then Content quiz, then Module Quiz fallback —
matches the backend's `not exists`/`not exists` layering order exactly.

## Frontend

**Supervisor:**
- `SupervisorAddResourcesView.vue`'s (or wherever the Knowledge-entry add
  form lives today) Content form gains a "Quiz required" checkbox + Hours
  field (shown only when checked, same required/positive-number validation
  UX as Video Training's Hours field).
- New management view for `content_questions`, or `SupervisorManageQuiz
  QuestionsView.vue` generalized with a source-type selector (Video/Reading
  Course vs Content) — implementation detail for the plan, but the CRUD
  form itself (MCQ/TF toggle, 4-option fields, topic dropdown sourced from
  real `quiz_required` Content entries only) is a straight reuse of the
  existing component's shape.

**Staff (retail only):**
- `ResourcesView.vue` — a `quiz_required` Content entry, shown to retail
  staff only, renders a "Take Quiz" action instead of the inline `<details>`
  expand, routing to a new dedicated page rather than expanding in place
  (an explicit completion action needs a place to live that inline expand
  doesn't have). Warehouse staff and all manager tiers see the entry
  exactly as today regardless of the flag.
- New `ContentReadingView.vue` — same shape as `ReadingView.vue`: shows the
  entry's `body`, an "I've read this" button. On click: fetch
  `GET /content-questions?topic=`, hand off to `QuizView.vue` via the same
  `sessionStorage` envelope pattern Video Training/Pharmacist Courses use.
  Submits to the new `POST /data/content-results` (needs its own `kind` in
  the envelope, e.g. `'content'`, distinct from `'video'` — unlike the
  Pharmacist Courses reading flow, which reuses `kind:'video'` because it
  shares `video_questions`/`POST /video-results`, this feature has its own
  bank/endpoint and needs `QuizView.vue` to route accordingly).
- EN/MS strings for every new piece (Supervisor's new form fields + question
  admin, staff's Take Quiz button, new reading page), per the existing
  bilingual convention.

## Edge cases

- A `quiz_required` Content entry with zero questions authored yet — same
  treatment as `GET /video-trainings` only listing a course once it has
  >=1 active question: `GET /content` should not present the entry as
  quiz-ready (retail staff) until a question exists, to avoid an unlockable
  "Take Quiz" button. Falls out of the same join `GET /video-trainings`
  already does; implementation detail for the plan.
- Retail staff hitting `POST /data/content-results` for a topic that isn't
  actually `quiz_required` (stale client state, direct API call) — 404,
  same "no questions found" shape `POST /video-results` already returns for
  an unknown topic.
- A topic string reused across `content` and `video_trainings` (or
  `standard_questions`) — not newly possible (this risk already exists
  today between Module Quiz and Video Training, accepted as "topic
  namespaces don't collide by design," enforced by discipline not by DB
  constraint). This feature adds a third participant in the same convention,
  not a new category of risk.
- Warehouse staff, or a manager, viewing a `quiz_required` entry — no gate
  shown, identical to viewing any other Content entry today (explicit
  non-regression, see Scope decisions).
- Deleting/recreating a `content` row to change `quizRequired`/`hours` (no
  edit endpoint) — the `content_questions` bank survives since it's keyed
  by topic text, same relationship `video_questions` has to `video_trainings`.

## Out of scope / explicitly not fixed here

- AI Practice itself — completely untouched, keeps generating from any
  Content topic (marked or not) exactly as today.
- Video Training's stacking-every-attempt CPD behavior — unchanged,
  confirmed deliberately different from this feature's capped behavior.
- Warehouse-staff access to this feature — confirmed retail-only.
- Editing an existing `content` row's `quizRequired`/`hours` in place — no
  new endpoint, matches the existing create+delete-only convention.
- Area Manager's assessment form picking up Content-quiz topics in its
  topic dropdown — `results` rows from this feature will appear there the
  same (imperfect, pre-existing, not addressed) way Video Training topics
  already do; not a new problem introduced here, not fixed here either.

## Testing / verification plan

- `curl`: `POST /content` with `quizRequired=true` and no `hours` → defaults
  to 1 and succeeds (matches optional-with-default, not required); with
  `hours=0` or non-numeric → 400.
- `curl`: `POST /content-questions` with an unknown `topic` → 400; with a
  real `quiz_required` topic → 200.
- `curl`: `DELETE /content-questions/:id` on a topic's last question → 400.
- `curl`: `POST /data/content-results` — same-day dedup returns the cached
  score without a second insert; a second calendar day inserts a new row
  but does not double the CPD credit (verify via `GET /data/scoped-data`'s
  `cpdHoursThisYear` before/after, disposable test staff, same pattern the
  Module Quiz CPD cap fix already used).
- `curl`: warehouse-division staff token hitting `POST /data/content-results`
  → 403 (retail-only), mirrors the existing Module Quiz scope check.
- Disposable-data live test: 2 attempts same Content topic (different
  simulated days) plus 1 different quiz_required topic plus 1 Video
  Training topic in the same year — confirm `cpdHoursThisYear` sums
  correctly per the 3-way split (Content topics capped at first-attempt's
  hours each, Video Training stacks), same methodology as the Module Quiz
  cap fix's verification.
- `npm run build` clean (frontend), EN/MS key-parity script clean.
- Live browser click-through (flagged as a recurring gap in every recent
  subsystem — no Playwright/browser tool has been available in-session
  recently): Supervisor marks a Content entry quiz-required + sets hours +
  authors questions; retail staff sees "Take Quiz" on that entry only;
  reads, clicks "I've read this," completes the quiz; CPD number updates
  by the entry's real hours; retaking the same entry same year doesn't
  double-credit; a warehouse-staff login sees the entry with no gate at
  all.
