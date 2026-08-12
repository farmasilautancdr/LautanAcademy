# Video Training Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retail staff watch a YouTube-embedded training video inside the app; when it ends, they're routed into a timed quiz (30s/question) drawn from a new, separate question bank, graded and saved exactly like Module Quiz.

**Architecture:** Two new backend-repo tables (`video_trainings`, `video_questions` — same shape as `standard_questions`, kept fully separate). New backend routes mirror the existing Module Quiz endpoints one-for-one (`GET /questions` → `GET /video-questions`, `POST /questions/:id/check` → `POST /video-questions/:id/check`, `POST /data/results` → `POST /data/video-results`) plus Supervisor CRUD mirroring `content.js`. Frontend adds two new views (a video list, a video-watch page using the YouTube IFrame Player API) and extends `QuizView.vue` in place — `kind` gains a third value `'video'` alongside the existing `'standard'`/`'ai'` — rather than forking a new quiz-taking component. The existing Module Quiz anti-fraud guard (`onBeforeRouteLeave` + `pagehide`) widens to also cover `kind === 'video'`.

**Tech Stack:** Node.js/Express/Postgres (backend repo), Vue 3 `<script setup>`/Vue Router 4/vue-i18n (frontend repo). New: YouTube IFrame Player API (loaded via a `<script>` tag at runtime, no npm package). No other new dependencies.

## Global Constraints

- Bilingual EN/MS: every new user-facing string needs both `en.json` and `ms.json` entries, same key, same nesting (per `CLAUDE.md`).
- No new frameworks/libraries without asking first — this plan introduces none (YouTube's IFrame API is a runtime `<script>` tag, not an npm dependency).
- No test framework in either repo (no vitest/jest/pytest) — verification is `npm run build` (frontend, must stay clean), curl round-trips against the live dev backend (backend), and manual browser click-through, per this project's documented convention.
- Match existing file conventions over textbook best practice (e.g. reuse `QuizView.vue` by extending `kind`, not a new component; mirror `content.js`'s exact CRUD/audit-log shape for the new Supervisor management routes).
- Frontend repo: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend`. Backend repo: `C:\Users\Hafiz\projects\lautan-academy-backend` — separate git repos, separate commits, `master`/`main` respectively, direct commits (no feature-branch workflow).
- Never touch the real `manager_pins` Supervisor PIN row for verification purposes — this project has a documented incident (`MEMORY.md`) where a curl test overwrote the live Supervisor PIN. Any Supervisor- or staff-scoped JWT needed for curl verification in this plan is minted directly via `issueToken()` in a one-off `node -e` script (bypasses `/auth/*` login entirely, touches no PIN).
- Any throwaway DB rows inserted purely for verification (test `video_trainings`/`video_questions`/`results` rows) are deleted again at the end of the same task's verification step — no test data left behind in the shared production Supabase DB.

---

### Task 1: Schema — `video_trainings` + `video_questions` tables

**Files:**
- Modify: `lautan-academy-backend/sql/schema.sql` (append at end)

**Interfaces:**
- Produces: Postgres tables `video_trainings(id, title, topic, youtube_url, created_at)` and `video_questions(id, topic, question_en, question_ms, opt1_en..opt4_en, opt1_ms..opt4_ms, correct, status, created_at)`, consumed by every later task.

- [ ] **Step 1: Append the new tables to `schema.sql`**

Add this at the end of `lautan-academy-backend/sql/schema.sql`:

```sql
-- Video Training. Separate from standard_questions/Module Quiz by design —
-- same choice as store_outlets vs the unrelated pre-existing `outlets`
-- table: two topic-grouped question banks that must never accidentally
-- mix. video_trainings.topic is matched by plain text against
-- video_questions.topic, same loose-coupling convention standard_questions
-- already uses with Module Quiz — no foreign key. See
-- docs/superpowers/specs/2026-08-12-video-training-design.md.
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
create index if not exists idx_video_questions_topic on video_questions (topic);
```

- [ ] **Step 2: Apply the schema change to the live database**

This project has no migration runner — schema changes are applied directly
against the DB. Run from `lautan-academy-backend`:

```bash
node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  await pool.query(\`create table if not exists video_trainings (
    id bigserial primary key,
    title text not null,
    topic text not null,
    youtube_url text not null,
    created_at timestamptz not null default now()
  )\`);
  await pool.query(\`create table if not exists video_questions (
    id bigserial primary key,
    topic text not null,
    question_en text not null,
    question_ms text not null,
    opt1_en text, opt2_en text, opt3_en text, opt4_en text,
    opt1_ms text, opt2_ms text, opt3_ms text, opt4_ms text,
    correct int not null,
    status text not null default 'active',
    created_at timestamptz not null default now()
  )\`);
  await pool.query('create index if not exists idx_video_questions_topic on video_questions (topic)');
  console.log('done');
  process.exit(0);
});
"
```

- [ ] **Step 3: Verify both tables exist**

```bash
node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  const { rows } = await pool.query(\`select table_name from information_schema.tables where table_schema='public' and table_name in ('video_trainings','video_questions')\`);
  console.log(rows.map(r => r.table_name));
  process.exit(0);
});
"
```

Expected: `['video_trainings', 'video_questions']` (order may vary).

- [ ] **Step 4: Commit**

```bash
cd lautan-academy-backend
git add sql/schema.sql
git commit -m "Add video_trainings and video_questions tables

Separate question bank from standard_questions, same shape, backing
the new Video Training feature. Applied directly to the live DB (no
migration runner in this project)."
```

---

### Task 2: Backend — list/read routes (`GET /video-trainings`, `GET /video-questions`, `POST /video-questions/:id/check`)

**Files:**
- Create: `lautan-academy-backend/src/routes/videoTraining.js`
- Modify: `lautan-academy-backend/src/index.js:11` (import), `:35` (mount)

**Interfaces:**
- Produces: `videoTrainingsRouter` (Express Router, exported) handling `GET /` (mounted at `/video-trainings`); `videoQuestionsRouter` (Express Router, exported) handling `GET /` and `POST /:id/check` (mounted at `/video-questions`). Both consumed by Task 3 (same file, extended) and by `index.js`.
- Consumes: `pool` (`config/db.js`), `requireAuth` (`middleware/auth.js`), `hitRateLimit` (`middleware/rateLimit.js`) — all existing.

- [ ] **Step 1: Create `routes/videoTraining.js` with the two read-only routers**

```js
import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth, requireScope } from '../middleware/auth.js';
import { hitRateLimit } from '../middleware/rateLimit.js';
import { logAuditSafe } from '../services/auditLog.js';

export const videoTrainingsRouter = Router();
export const videoQuestionsRouter = Router();

// Only lists a video if its topic currently has >=1 active question in
// video_questions — a staff member can never finish watching a video and
// then hit "no questions found" on the quiz that follows it. Server-
// authoritative (a join/exists check), not a client-side filter.
videoTrainingsRouter.get('/', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    select vt.id, vt.title, vt.topic, vt.youtube_url
    from video_trainings vt
    where exists (
      select 1 from video_questions vq
      where vq.topic = vt.topic and vq.status = 'active'
    )
    order by vt.title
  `);
  res.json({
    videoTrainings: rows.map(v => ({ id: v.id, title: v.title, topic: v.topic, youtubeUrl: v.youtube_url })),
  });
});

// Scoped to one topic (the watch page already knows which topic it needs
// once the video ends) — mirrors GET /questions but doesn't ship the whole
// bank for every request.
videoQuestionsRouter.get('/', requireAuth, async (req, res) => {
  const topic = (req.query.topic || '').toString().trim();
  if (!topic) return res.json({ questions: [] });
  const { rows } = await pool.query(
    "select * from video_questions where topic = $1 and status = 'active' order by id",
    [topic]
  );
  res.json({
    questions: rows.map((q) => ({
      id: q.id,
      topic: q.topic,
      question_en: q.question_en,
      question_ms: q.question_ms,
      opt1_en: q.opt1_en, opt2_en: q.opt2_en, opt3_en: q.opt3_en, opt4_en: q.opt4_en,
      opt1_ms: q.opt1_ms, opt2_ms: q.opt2_ms, opt3_ms: q.opt3_ms, opt4_ms: q.opt4_ms,
      status: q.status,
    })),
  });
});

// Live per-question reveal while taking a video-training quiz — mirrors
// POST /questions/:id/check exactly, against video_questions instead of
// standard_questions. Not authoritative on its own: POST /data/video-
// results re-grades the full submitted answer set independently.
videoQuestionsRouter.post('/:id/check', requireAuth, async (req, res) => {
  if (await hitRateLimit(`check_video_${req.session.scopeKey}`, 80, 10 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many checks — slow down and try again shortly.' });
  }
  const id = parseInt(req.params.id);
  const chosen = parseInt(req.body.chosen);
  const { rows } = await pool.query('select correct from video_questions where id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Question not found.' });
  const correctIndex = rows[0].correct;
  res.json({ correct: chosen === correctIndex, correctIndex });
});
```

- [ ] **Step 2: Mount the new routers in `index.js`**

Change the import block (after line 11's `questionsRouter` import):

```js
import { questionsRouter } from './routes/questions.js';
```

to:

```js
import { questionsRouter } from './routes/questions.js';
import { videoTrainingsRouter, videoQuestionsRouter } from './routes/videoTraining.js';
```

Change the mount block (after line 35's `/questions` mount):

```js
app.use('/questions', checkMaintenance, questionsRouter);
```

to:

```js
app.use('/questions', checkMaintenance, questionsRouter);
app.use('/video-trainings', checkMaintenance, videoTrainingsRouter);
app.use('/video-questions', checkMaintenance, videoQuestionsRouter);
```

- [ ] **Step 3: Insert temporary test data**

From `lautan-academy-backend`:

```bash
node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  await pool.query(\`insert into video_trainings (title, topic, youtube_url)
    values ('PLAN_TEST Video', 'PLAN_TEST_TOPIC', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')\`);
  await pool.query(\`insert into video_questions (topic, question_en, question_ms, opt1_en, opt2_en, opt3_en, opt4_en, opt1_ms, opt2_ms, opt3_ms, opt4_ms, correct)
    values ('PLAN_TEST_TOPIC', 'Test question?', 'Soalan ujian?', 'A', 'B', 'C', 'D', 'A', 'B', 'C', 'D', 0)\`);
  console.log('inserted');
  process.exit(0);
});
"
```

- [ ] **Step 4: Restart the backend dev server and mint a test staff JWT**

Restart `npm run dev` in `lautan-academy-backend` (picks up the new routes).
Then mint a token for the real CDR/MOHD HAFIZ staff account (bypasses login,
touches no PIN):

```bash
node -e "
import('./src/middleware/auth.js').then(async ({ issueToken }) => {
  const token = await issueToken('staff_retail', 'CDR|MOHD HAFIZ');
  console.log(token);
  process.exit(0);
});
"
```

Save the printed token as `$TOKEN` for the next step (e.g. `export
TOKEN=<printed value>`).

- [ ] **Step 5: curl-verify all three routes**

```bash
curl -s http://localhost:3000/video-trainings -H "Authorization: Bearer $TOKEN"
```

Expected: `{"videoTrainings":[{"id":<n>,"title":"PLAN_TEST Video","topic":"PLAN_TEST_TOPIC","youtubeUrl":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}]}`

```bash
curl -s "http://localhost:3000/video-questions?topic=PLAN_TEST_TOPIC" -H "Authorization: Bearer $TOKEN"
```

Expected: one question, `"question_en":"Test question?"`, no `correct` field
exposed.

```bash
curl -s -X POST http://localhost:3000/video-questions/<question id from above>/check -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"chosen":0}'
```

Expected: `{"correct":true,"correctIndex":0}`.

- [ ] **Step 6: Clean up the test rows**

```bash
node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  await pool.query(\"delete from video_questions where topic = 'PLAN_TEST_TOPIC'\");
  await pool.query(\"delete from video_trainings where topic = 'PLAN_TEST_TOPIC'\");
  console.log('cleaned up');
  process.exit(0);
});
"
```

- [ ] **Step 7: Commit**

```bash
cd lautan-academy-backend
git add src/routes/videoTraining.js src/index.js
git commit -m "Add GET /video-trainings, GET /video-questions, POST /video-questions/:id/check

Read-only routes for the Video Training feature, mirroring the
existing Module Quiz endpoints one-for-one against the new separate
video_questions bank. Video list only surfaces topics that currently
have an active question bank, so a staff member can never finish a
video and hit a dead end."
```

---

### Task 3: Backend — Supervisor CRUD (`POST /video-trainings`, `DELETE /video-trainings/:id`)

**Files:**
- Modify: `lautan-academy-backend/src/routes/videoTraining.js` (append to `videoTrainingsRouter`)

**Interfaces:**
- Consumes: `videoTrainingsRouter` (Task 2), `requireScope` (`middleware/auth.js`), `logAuditSafe` (`services/auditLog.js`).

- [ ] **Step 1: Add the YouTube URL validator + POST/DELETE routes**

Append to `lautan-academy-backend/src/routes/videoTraining.js` (after the
existing `videoTrainingsRouter.get('/', ...)` block, before
`videoQuestionsRouter.get('/', ...)`):

```js
// Accepts youtube.com/watch?v=<id> or youtu.be/<id> (optionally with extra
// query params/timestamps after the id) — rejects anything else so a
// Supervisor can't get an arbitrary iframe embedded via this field.
function extractYouTubeId(url) {
  const watchMatch = url.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  return null;
}

// Matches content.js's Supervisor-only add/delete gating and audit-log
// convention exactly.
videoTrainingsRouter.post('/', requireAuth, requireScope('supervisor'), async (req, res) => {
  const title = (req.body.title || '').toString().trim();
  const topic = (req.body.topic || '').toString().trim();
  const youtubeUrl = (req.body.youtubeUrl || '').toString().trim();
  if (!title || !topic || !youtubeUrl) {
    return res.status(400).json({ status: 'error', error: 'Title, topic, and YouTube link are required.' });
  }
  if (!extractYouTubeId(youtubeUrl)) {
    return res.status(400).json({ status: 'error', error: 'Not a recognized YouTube link (expected a youtube.com/watch?v=... or youtu.be/... URL).' });
  }
  const { rows } = await pool.query(
    'insert into video_trainings (title, topic, youtube_url) values ($1,$2,$3) returning id',
    [title, topic, youtubeUrl]
  );
  logAuditSafe({
    actorType: req.session.scopeType,
    actorKey: req.session.scopeKey,
    action: 'video_training.add',
    summary: `Added video training "${title}" (${topic})`,
  });
  res.json({ status: 'ok', id: rows[0].id });
});

videoTrainingsRouter.delete('/:id', requireAuth, requireScope('supervisor'), async (req, res) => {
  await pool.query('delete from video_trainings where id = $1', [req.params.id]);
  logAuditSafe({
    actorType: req.session.scopeType,
    actorKey: req.session.scopeKey,
    action: 'video_training.delete',
    summary: `Deleted video training id ${req.params.id}`,
  });
  res.json({ status: 'ok' });
});
```

- [ ] **Step 2: Restart the backend dev server, mint a test supervisor JWT**

```bash
node -e "
import('./src/middleware/auth.js').then(async ({ issueToken }) => {
  const token = await issueToken('supervisor', 'ALL');
  console.log(token);
  process.exit(0);
});
"
```

Save as `$SUP_TOKEN`.

- [ ] **Step 3: curl-verify add → list → reject-bad-url → delete → gone**

```bash
curl -s -X POST http://localhost:3000/video-trainings -H "Authorization: Bearer $SUP_TOKEN" -H "Content-Type: application/json" -d '{"title":"PLAN_TEST Video","topic":"PLAN_TEST_TOPIC","youtubeUrl":"https://youtu.be/dQw4w9WgXcQ"}'
```

Expected: `{"status":"ok","id":<n>}` — note the returned `id`.

```bash
curl -s http://localhost:3000/video-trainings -H "Authorization: Bearer $TOKEN"
```

Expected: this time the list comes back **empty** (`{"videoTrainings":[]}`) —
`PLAN_TEST_TOPIC` has no `video_questions` rows yet, confirming Task 2's
dead-end guard still holds even for a freshly-added video.

```bash
curl -s -X POST http://localhost:3000/video-trainings -H "Authorization: Bearer $SUP_TOKEN" -H "Content-Type: application/json" -d '{"title":"Bad","topic":"X","youtubeUrl":"https://example.com/not-youtube"}'
```

Expected: `{"status":"error","error":"Not a recognized YouTube link..."}`, HTTP 400.

```bash
curl -s -X DELETE http://localhost:3000/video-trainings/<id from above> -H "Authorization: Bearer $SUP_TOKEN"
```

Expected: `{"status":"ok"}`.

```bash
curl -s -X POST http://localhost:3000/video-trainings -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
```

Expected: HTTP 403 (`requireScope('supervisor')` rejects the staff-scoped
`$TOKEN`) — confirms the gate actually gates.

- [ ] **Step 4: Commit**

```bash
cd lautan-academy-backend
git add src/routes/videoTraining.js
git commit -m "Add Supervisor CRUD for video_trainings

POST validates the YouTube link (youtube.com/watch or youtu.be only,
video id extracted), DELETE removes an entry. Both audit-logged,
mirrors content.js's existing add/delete gating and shape exactly."
```

---

### Task 4: Backend — `POST /data/video-results`

**Files:**
- Modify: `lautan-academy-backend/src/routes/data.js` (append, after the existing `POST /ai-results` handler)

**Interfaces:**
- Consumes: `pool`, `requireAuth`, `isSameCalendarDay` (all already in this file).
- Produces: `POST /data/video-results` — same request/response shape as `POST /data/results` (`{name, outlet, topic, answers}` in, `{status, score, total, percentage}` out), consumed by Task 9 (`QuizView.vue`'s `gradeAndSave()`).

- [ ] **Step 1: Add the route**

Append to `lautan-academy-backend/src/routes/data.js`, after the existing
`dataRouter.post('/ai-results', ...)` handler's closing `});`:

```js
// Staff-triggered: save a completed video-training quiz attempt. Mirrors
// POST /results exactly (server-authoritative grading against the real
// question bank, same-day no-op, same wrong_answers write) except it reads
// from video_questions instead of standard_questions, and writes into the
// same `results` table Module Quiz uses — topic alone distinguishes a
// video-training attempt in Quiz History/the dashboard average, no new
// table or column needed.
dataRouter.post('/video-results', requireAuth, async (req, res) => {
  const name = (req.body.name || '').toString().trim().toUpperCase();
  const outlet = (req.body.outlet || '').toString().trim().toUpperCase();
  const topic = (req.body.topic || 'N/A').toString().trim();
  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];

  if (req.session.scopeType !== 'staff_retail' || req.session.scopeKey !== `${outlet}|${name}`) {
    return res.status(403).json({ status: 'unauthorized' });
  }

  const { rows } = await pool.query(
    'select created_at from results where name=$1 and outlet=$2 and topic=$3 order by created_at desc limit 1',
    [name, outlet, topic]
  );
  const alreadyToday = rows[0] && isSameCalendarDay(new Date(rows[0].created_at), new Date());
  if (alreadyToday) return res.json({ status: 'ok' });

  const { rows: questions } = await pool.query("select * from video_questions where topic = $1 and status = 'active' order by id", [topic]);
  if (!questions.length) return res.status(404).json({ status: 'error', error: 'No questions found for this video.' });

  const chosenById = new Map();
  for (const a of answers) chosenById.set(parseInt(a.id), parseInt(a.chosen));

  let score = 0;
  const wrongRows = [];
  for (const q of questions) {
    const chosen = chosenById.get(parseInt(q.id));
    if (chosen === q.correct) {
      score++;
    } else {
      const opts = [q.opt1_en, q.opt2_en, q.opt3_en, q.opt4_en];
      wrongRows.push({ question: q.question_en, chosen: opts[chosen] ?? '(no answer)', correct: opts[q.correct] ?? '' });
    }
  }
  const total = questions.length;
  const percentage = Math.round((score / total) * 100);
  const attemptId = `VID${Date.now()}`;

  await pool.query(
    'insert into results (attempt_id, outlet, name, topic, score, percentage) values ($1,$2,$3,$4,$5,$6)',
    [attemptId, outlet, name, topic, `${score}/${total}`, `${percentage}%`]
  );
  for (const w of wrongRows) {
    await pool.query(
      'insert into wrong_answers (attempt_id, outlet, staff_name, topic, question, chosen, correct) values ($1,$2,$3,$4,$5,$6,$7)',
      [attemptId, outlet, name, topic, w.question, w.chosen, w.correct]
    );
  }
  res.json({ status: 'ok', score, total, percentage });
});
```

- [ ] **Step 2: Insert temporary test data, restart dev server**

```bash
node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  const { rows } = await pool.query(\`insert into video_questions (topic, question_en, question_ms, opt1_en, opt2_en, opt3_en, opt4_en, opt1_ms, opt2_ms, opt3_ms, opt4_ms, correct)
    values ('PLAN_TEST_TOPIC2', 'Q?', 'S?', 'A', 'B', 'C', 'D', 'A', 'B', 'C', 'D', 1) returning id\`);
  console.log('question id:', rows[0].id);
  process.exit(0);
});
"
```

Restart `npm run dev`. Reuse the `$TOKEN` (staff CDR/MOHD HAFIZ) minted in
Task 2 Step 4 if the dev server process is the same session, otherwise
re-mint it the same way.

- [ ] **Step 3: curl-verify grading, then same-day no-op**

```bash
curl -s -X POST http://localhost:3000/data/video-results -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"MOHD HAFIZ","outlet":"CDR","topic":"PLAN_TEST_TOPIC2","answers":[{"id":<question id>,"chosen":1}]}'
```

Expected: `{"status":"ok","score":1,"total":1,"percentage":100}`.

```bash
curl -s -X POST http://localhost:3000/data/video-results -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"MOHD HAFIZ","outlet":"CDR","topic":"PLAN_TEST_TOPIC2","answers":[{"id":<question id>,"chosen":0}]}'
```

Expected: `{"status":"ok"}` with no `score`/`total` fields — the same-day
no-op fired (matches `POST /results`'s exact behavior), confirming a second
attempt today can't silently overwrite/retry the first.

- [ ] **Step 4: Clean up test rows**

```bash
node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  await pool.query(\"delete from video_questions where topic = 'PLAN_TEST_TOPIC2'\");
  await pool.query(\"delete from results where topic = 'PLAN_TEST_TOPIC2'\");
  console.log('cleaned up');
  process.exit(0);
});
"
```

- [ ] **Step 5: Commit**

```bash
cd lautan-academy-backend
git add src/routes/data.js
git commit -m "Add POST /data/video-results

Grades and saves a video-training quiz attempt, structurally identical
to POST /results (server-authoritative against the real question bank,
same-day no-op) but reading from video_questions instead of
standard_questions. Writes into the same results table — topic alone
identifies it in Quiz History/the dashboard average."
```

---

### Task 5: Frontend — `api/client.js` new methods

**Files:**
- Modify: `lautan-academy-frontend/src/api/client.js` (append to the `export const api = { ... }` object)

**Interfaces:**
- Produces: `api.getVideoTrainings()`, `api.getVideoQuestions(topic)`, `api.checkVideoAnswer(id, chosen)`, `api.saveVideoResult(payload)`, `api.addVideoTraining(payload)`, `api.deleteVideoTraining(id)` — consumed by Tasks 7, 8, 9, 10.

- [ ] **Step 1: Add the six methods**

In `lautan-academy-frontend/src/api/client.js`, add these inside the
`export const api = { ... }` object, near the existing `getQuestions`/
`checkStandardAnswer` methods:

```js
  getVideoTrainings: () => request('/video-trainings'),
  getVideoQuestions: (topic) => request(`/video-questions?topic=${encodeURIComponent(topic)}`),
  checkVideoAnswer: (id, chosen) => request(`/video-questions/${id}/check`, { method: 'POST', body: JSON.stringify({ chosen }) }),
  saveVideoResult: (payload) => request('/data/video-results', { method: 'POST', body: JSON.stringify(payload) }),
  addVideoTraining: (payload) => request('/video-trainings', { method: 'POST', body: JSON.stringify(payload) }),
  deleteVideoTraining: (id) => request(`/video-trainings/${encodeURIComponent(id)}`, { method: 'DELETE' }),
```

- [ ] **Step 2: Verify build is clean**

Run: `cd lautan-academy-frontend && npm run build`
Expected: builds clean, same as before this change (this task adds no
template/logic, just data methods — nothing should even touch runtime
behavior yet).

- [ ] **Step 3: Commit**

```bash
cd lautan-academy
git add lautan-academy-frontend/src/api/client.js
git commit -m "Add api/client.js methods for Video Training endpoints"
```

---

### Task 6: Frontend — router, sidebar nav item, icon

**Files:**
- Create: `lautan-academy-frontend/src/views/VideoTrainingListView.vue` (stub — full implementation is Task 7; this task just needs the file to exist so the router import resolves)
- Create: `lautan-academy-frontend/src/views/VideoWatchView.vue` (stub — full implementation is Task 8)
- Modify: `lautan-academy-frontend/src/router/index.js:13` (import), `:51` (route)
- Modify: `lautan-academy-frontend/src/components/AppSidebar.vue:65` (nav item), `:165` (new icon)

**Interfaces:**
- Consumes: nothing new.
- Produces: routes `video-training` (`/video-training`) and `video-watch` (`/video-watch/:id`), both `{ requiresAuth: true, role: 'staff', division: 'retail' }` — same gating as `module-quiz`.

- [ ] **Step 1: Create minimal stub components**

`lautan-academy-frontend/src/views/VideoTrainingListView.vue`:

```vue
<script setup>
</script>

<template>
  <div class="min-h-screen bg-seafoam" />
</template>
```

`lautan-academy-frontend/src/views/VideoWatchView.vue`:

```vue
<script setup>
</script>

<template>
  <div class="min-h-screen bg-seafoam" />
</template>
```

(Task 7 and Task 8 replace these bodies — this task is purely wiring
navigation, kept separate so it has its own clean commit and build-verify
checkpoint before either view grows real logic.)

- [ ] **Step 2: Register the routes**

In `lautan-academy-frontend/src/router/index.js`, change:

```js
import ResourcesView from '../views/ResourcesView.vue'
```

to:

```js
import ResourcesView from '../views/ResourcesView.vue'
import VideoTrainingListView from '../views/VideoTrainingListView.vue'
import VideoWatchView from '../views/VideoWatchView.vue'
```

Change:

```js
    { path: '/resources', name: 'resources', component: ResourcesView, meta: { requiresAuth: true, role: 'staff' } },
```

to:

```js
    { path: '/resources', name: 'resources', component: ResourcesView, meta: { requiresAuth: true, role: 'staff' } },
    // Same retail-only gating as Module Quiz — warehouse staff don't get
    // this today either.
    { path: '/video-training', name: 'video-training', component: VideoTrainingListView, meta: { requiresAuth: true, role: 'staff', division: 'retail' } },
    { path: '/video-watch/:id', name: 'video-watch', component: VideoWatchView, meta: { requiresAuth: true, role: 'staff', division: 'retail' } },
```

- [ ] **Step 3: Add the sidebar nav item and icon**

In `lautan-academy-frontend/src/components/AppSidebar.vue`, add a new icon
to the `ICONS` object (after the existing `clipboard` entry):

```js
  clipboard: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 12h6M9 16h6',
  video: 'M23 7l-7 5 7 5V7zM1 5h15v14H1z',
```

Change the quiz group items block:

```js
    const quizItems = []
    if (auth.staff?.division === 'retail') quizItems.push({ label: t('sidebar.moduleQuiz'), to: '/module-quiz', icon: 'clipboard' })
    quizItems.push({ label: t('sidebar.quizHistory'), to: '/history', icon: 'history' })
    groups.push({ label: t('sidebar.groupQuizzes'), items: quizItems })
```

to:

```js
    const quizItems = []
    if (auth.staff?.division === 'retail') quizItems.push({ label: t('sidebar.moduleQuiz'), to: '/module-quiz', icon: 'clipboard' })
    if (auth.staff?.division === 'retail') quizItems.push({ label: t('sidebar.videoTraining'), to: '/video-training', icon: 'video' })
    quizItems.push({ label: t('sidebar.quizHistory'), to: '/history', icon: 'history' })
    groups.push({ label: t('sidebar.groupQuizzes'), items: quizItems })
```

- [ ] **Step 4: Add the `sidebar.videoTraining` i18n key**

In `lautan-academy-frontend/src/i18n/locales/en.json`, change:

```json
    "moduleQuiz": "Module Quiz",
    "quizHistory": "Quiz History",
```

to:

```json
    "moduleQuiz": "Module Quiz",
    "videoTraining": "Video Training",
    "quizHistory": "Quiz History",
```

In `lautan-academy-frontend/src/i18n/locales/ms.json`, change:

```json
    "moduleQuiz": "Kuiz Modul",
    "quizHistory": "Sejarah Kuiz",
```

to:

```json
    "moduleQuiz": "Kuiz Modul",
    "videoTraining": "Latihan Video",
    "quizHistory": "Sejarah Kuiz",
```

- [ ] **Step 5: Verify build is clean**

Run: `cd lautan-academy-frontend && npm run build`
Expected: clean.

- [ ] **Step 6: Manual verification**

In the browser (dev server), log in as CDR/MOHD HAFIZ (retail). Confirm
"Video Training" now appears in the sidebar under the Quizzes group,
between Module Quiz and Quiz History. Click it — confirm it navigates to
`/video-training` and renders (empty seafoam page, expected — Task 7 fills
it in). Log in as a warehouse staff member (if one exists) or check
`auth.staff.division !== 'retail'` in devtools — confirm the nav item does
not appear for warehouse.

- [ ] **Step 7: Commit**

```bash
cd lautan-academy
git add lautan-academy-frontend/src/views/VideoTrainingListView.vue lautan-academy-frontend/src/views/VideoWatchView.vue lautan-academy-frontend/src/router/index.js lautan-academy-frontend/src/components/AppSidebar.vue lautan-academy-frontend/src/i18n/locales/en.json lautan-academy-frontend/src/i18n/locales/ms.json
git commit -m "Wire up Video Training navigation (routes, sidebar, stub views)

Retail-only, same gating pattern as Module Quiz. VideoTrainingListView
and VideoWatchView are empty stubs here — real implementation is the
next two tasks, kept separate so navigation wiring gets its own clean
build-verified commit."
```

---

### Task 7: Frontend — `VideoTrainingListView.vue`

**Files:**
- Modify: `lautan-academy-frontend/src/views/VideoTrainingListView.vue` (replace stub body)
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`, `ms.json` (new `videoTrainingListView` namespace)

**Interfaces:**
- Consumes: `api.getVideoTrainings()` (Task 5).

- [ ] **Step 1: Implement the list view**

Replace the full contents of
`lautan-academy-frontend/src/views/VideoTrainingListView.vue` with:

```vue
<script setup>
// Video Training list — mirrors ModuleQuizView.vue's structure: fetch on
// mount, staff picks one, navigate to the watch page. No sessionStorage
// handoff here (unlike Module Quiz's topic->questions handoff) — the watch
// page only needs the video's own id, and fetches its question bank itself
// once the video actually ends (see VideoWatchView.vue).
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'

const router = useRouter()
const auth = useAuthStore()
const { t } = useI18n()

const videos = ref([])
const loading = ref(true)

onMounted(async () => {
  try {
    const data = await api.getVideoTrainings()
    videos.value = data.videoTrainings || []
  } catch (e) { /* leave empty */ }
  loading.value = false
})

function watch(video) {
  router.push(`/video-watch/${video.id}`)
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ auth.staff?.outlet }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('videoTrainingListView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div v-if="loading" class="text-slate text-sm">{{ t('videoTrainingListView.loading') }}</div>
      <div v-else-if="videos.length === 0" class="text-slate text-sm">{{ t('videoTrainingListView.noVideosYet') }}</div>
      <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
        <button
          v-for="v in videos"
          :key="v.id"
          @click="watch(v)"
          class="w-full text-left px-5 py-4 flex items-center justify-between gap-3 hover:bg-seafoam/50"
        >
          <div class="min-w-0">
            <p class="text-sm font-medium text-ink truncate">{{ v.title }}</p>
            <p class="text-xs text-slate">{{ v.topic }}</p>
          </div>
          <span class="text-aqua text-sm font-medium shrink-0">{{ t('videoTrainingListView.watch') }}</span>
        </button>
      </div>
    </main>
  </div>
</template>
```

- [ ] **Step 2: Add the `videoTrainingListView` i18n namespace**

In `lautan-academy-frontend/src/i18n/locales/en.json`, add this new
top-level key right after the closing `},` of `moduleQuizView` (i.e. after
the line containing `"impersonatingNotice": "Quiz-taking is hidden while
viewing as someone else."` that belongs to `moduleQuizView`, before
`"quizView": {`):

```json
  "videoTrainingListView": {
    "title": "Video Training",
    "loading": "Loading...",
    "noVideosYet": "No training videos available yet.",
    "watch": "Watch →"
  },
```

In `lautan-academy-frontend/src/i18n/locales/ms.json`, add at the same
position:

```json
  "videoTrainingListView": {
    "title": "Latihan Video",
    "loading": "Memuatkan...",
    "noVideosYet": "Belum ada video latihan tersedia.",
    "watch": "Tonton →"
  },
```

- [ ] **Step 3: Verify build is clean**

Run: `cd lautan-academy-frontend && npm run build`
Expected: clean.

- [ ] **Step 4: Manual verification with real test data**

Insert a temporary video via the backend (reuse the Task 3 curl pattern
against a real, non-empty topic — or, simpler, temporarily add a real
`video_questions` row for an existing Module Quiz topic name via the
Task 2-style `node -e` insert against `video_questions`, then POST a
`video_trainings` row with that same topic via curl using a freshly-minted
supervisor token). In the browser, navigate to `/video-training` as
CDR/MOHD HAFIZ — confirm the video appears with its title and topic, and
clicking it navigates to `/video-watch/<id>`. Clean up the temporary rows
afterward (`delete from video_trainings ...` / `delete from
video_questions ...` for the test topic) the same way Task 2/3 did.

- [ ] **Step 5: Commit**

```bash
cd lautan-academy
git add lautan-academy-frontend/src/views/VideoTrainingListView.vue lautan-academy-frontend/src/i18n/locales/en.json lautan-academy-frontend/src/i18n/locales/ms.json
git commit -m "Implement VideoTrainingListView

Lists videos from GET /video-trainings, click navigates to the watch
page. Mirrors ModuleQuizView.vue's fetch-on-mount/pick-one structure."
```

---

### Task 8: Frontend — `VideoWatchView.vue` (YouTube IFrame Player)

**Files:**
- Modify: `lautan-academy-frontend/src/views/VideoWatchView.vue` (replace stub body)
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`, `ms.json` (new `videoWatchView` namespace)

**Interfaces:**
- Consumes: `api.getVideoTrainings()` (to find this video's title/topic/youtubeUrl by id — no single-video GET exists, so this fetches the list and finds the matching id; acceptable, the list is small and already cached-free), `api.getVideoQuestions(topic)` (Task 5).
- Produces: writes `sessionStorage['lautan_active_quiz'] = {kind:'video', topic, questions}` — the exact envelope `QuizView.vue` (Task 9) reads.

- [ ] **Step 1: Implement the watch view**

Replace the full contents of
`lautan-academy-frontend/src/views/VideoWatchView.vue` with:

```vue
<script setup>
// Embeds the YouTube IFrame Player API inline — staff never leave the app,
// no navigation to youtube.com. Free seeking allowed (no custom control
// restrictions); the quiz is gated on the player's real ENDED state, not
// on elapsed watch time, so seeking doesn't bypass any technical control.
// On ENDED: fetch that video's topic's question bank and hand off to
// QuizView.vue via the same sessionStorage envelope Module Quiz already
// uses (kind/topic/questions), just with kind: 'video'.
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const video = ref(null)
const loadError = ref('')
const playerReady = ref(false)

function extractYouTubeId(url) {
  const watchMatch = url.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/)
  if (watchMatch) return watchMatch[1]
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/)
  return shortMatch ? shortMatch[1] : null
}

let player = null

function loadIframeApi() {
  return new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) { resolve(); return }
    const existing = document.getElementById('youtube-iframe-api')
    if (existing) {
      window.onYouTubeIframeAPIReady = resolve
      return
    }
    const script = document.createElement('script')
    script.id = 'youtube-iframe-api'
    script.src = 'https://www.youtube.com/iframe_api'
    script.onerror = reject
    window.onYouTubeIframeAPIReady = resolve
    document.head.appendChild(script)
  })
}

async function onVideoEnded() {
  try {
    const data = await api.getVideoQuestions(video.value.topic)
    const questions = data.questions || []
    if (!questions.length) {
      loadError.value = t('videoWatchView.errorNoQuestions')
      return
    }
    sessionStorage.setItem('lautan_active_quiz', JSON.stringify({ kind: 'video', topic: video.value.topic, questions }))
    router.push('/quiz')
  } catch (e) {
    loadError.value = t('videoWatchView.errorNoQuestions')
  }
}

onMounted(async () => {
  try {
    const data = await api.getVideoTrainings()
    video.value = (data.videoTrainings || []).find(v => String(v.id) === route.params.id)
    if (!video.value) {
      loadError.value = t('videoWatchView.errorNotFound')
      return
    }
    const videoId = extractYouTubeId(video.value.youtubeUrl)
    if (!videoId) {
      loadError.value = t('videoWatchView.errorPlayerLoad')
      return
    }
    await loadIframeApi()
    player = new window.YT.Player('youtube-player', {
      videoId,
      playerVars: { rel: 0 },
      events: {
        onReady: () => { playerReady.value = true },
        onStateChange: (event) => {
          if (event.data === window.YT.PlayerState.ENDED) onVideoEnded()
        },
      },
    })
  } catch (e) {
    loadError.value = t('videoWatchView.errorPlayerLoad')
  }
})
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <h1 class="font-display text-xl font-semibold text-white">{{ video?.title || t('videoWatchView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <p v-if="loadError" class="text-coral text-sm mb-4">{{ loadError }}</p>
      <div v-if="video" class="bg-white rounded-xl2 p-4 shadow-sm">
        <div class="aspect-video w-full">
          <div id="youtube-player" class="w-full h-full" />
        </div>
        <p class="text-slate text-xs mt-3">{{ t('videoWatchView.watchToContinue') }}</p>
      </div>
    </main>
  </div>
</template>
```

- [ ] **Step 2: Add the `videoWatchView` i18n namespace**

In `lautan-academy-frontend/src/i18n/locales/en.json`, add right after the
new `videoTrainingListView` block from Task 7 (before `"quizView": {`):

```json
  "videoWatchView": {
    "title": "Video Training",
    "watchToContinue": "Finish watching to unlock the quiz.",
    "errorNotFound": "This video could not be found.",
    "errorPlayerLoad": "Couldn't load the video player — refresh and try again.",
    "errorNoQuestions": "Couldn't load the quiz for this video — refresh and try again."
  },
```

In `lautan-academy-frontend/src/i18n/locales/ms.json`, add at the same
position:

```json
  "videoWatchView": {
    "title": "Latihan Video",
    "watchToContinue": "Habiskan tontonan untuk membuka kuiz.",
    "errorNotFound": "Video ini tidak ditemui.",
    "errorPlayerLoad": "Tidak dapat memuatkan pemain video — muat semula dan cuba lagi.",
    "errorNoQuestions": "Tidak dapat memuatkan kuiz untuk video ini — muat semula dan cuba lagi."
  },
```

- [ ] **Step 3: Verify build is clean**

Run: `cd lautan-academy-frontend && npm run build`
Expected: clean.

- [ ] **Step 4: Manual verification**

Using the same temporary video+question setup as Task 7 Step 4 (a
`video_trainings` row + matching `video_questions` row(s)), navigate to
`/video-training`, click the test video. Confirm the YouTube player embeds
and plays inline (pick a short real YouTube video URL for this test, or let
`dQw4w9WgXcQ` play/seek to near the end). Let it reach the end (or seek to
the last few seconds and let it finish) — confirm it auto-navigates to
`/quiz` with the test question loaded (Task 9 must be done for `/quiz` to
render `kind: 'video'` correctly; until then this step will show
`quizView.noActiveQuiz` is false but the timer/check calls will fail —
acceptable, full end-to-end verification happens at the end of Task 9).
Clean up the temporary DB rows afterward.

- [ ] **Step 5: Commit**

```bash
cd lautan-academy
git add lautan-academy-frontend/src/views/VideoWatchView.vue lautan-academy-frontend/src/i18n/locales/en.json lautan-academy-frontend/src/i18n/locales/ms.json
git commit -m "Implement VideoWatchView with YouTube IFrame Player

Embeds the video inline (no navigation to youtube.com), free seeking
allowed. On the player's real ENDED event, fetches that video's
question bank and hands off to QuizView.vue via the same
sessionStorage envelope Module Quiz uses, kind: 'video'."
```

---

### Task 9: Frontend — extend `QuizView.vue` for `kind === 'video'`

**Files:**
- Modify: `lautan-academy-frontend/src/views/QuizView.vue` (multiple locations, detailed below)
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`, `ms.json` (new `quizView.timeRemaining` key)

**Interfaces:**
- Consumes: `api.checkVideoAnswer`, `api.saveVideoResult` (Task 5), `sessionStorage['lautan_active_quiz']` with `kind: 'video'` (Task 8's output).
- Produces: `QuizView.vue` now handles a third `kind` value with a per-question 30s timer and the same anti-fraud guard `'standard'` already has.

- [ ] **Step 1: Add the per-question timer state and logic**

In `QuizView.vue`, change the top-of-script refs block:

```js
const currentIndex = ref(0)
const answers = ref({}) // { questionIndex: { chosen, correct, correctIndex } }
const checking = ref(false)
```

to:

```js
const currentIndex = ref(0)
const answers = ref({}) // { questionIndex: { chosen, correct, correctIndex } }
const checking = ref(false)
const QUESTION_TIMER_SECONDS = 30
const timeRemaining = ref(QUESTION_TIMER_SECONDS)
let timerInterval = null

// kind === 'video' only. Counts down from 30s each time the question
// changes; reaching 0 with the question still unanswered behaves exactly
// like clicking Next (or Submit, if last) with it blank — no separate
// grading path, it flows through the same unanswered-question handling
// 'standard' already has in gradeAndSave().
function startQuestionTimer() {
  clearInterval(timerInterval)
  timeRemaining.value = QUESTION_TIMER_SECONDS
  timerInterval = setInterval(() => {
    timeRemaining.value--
    if (timeRemaining.value <= 0) {
      clearInterval(timerInterval)
      if (isLastQuestion.value) submitQuiz()
      else next()
    }
  }, 1000)
}
```

- [ ] **Step 2: Wire the timer to start/reset on question change and on mount**

Change the imports line:

```js
import { ref, computed, onMounted, onUnmounted } from 'vue'
```

(this import already exists from the Module Quiz anti-fraud plan — no
change needed here, just confirming it's already present before the next
edit references `onMounted`).

Find the existing `onMounted(() => { window.addEventListener('pagehide',
handlePageHide) })` block and change it to also start the timer when
`kind === 'video'`:

```js
onMounted(() => {
  window.addEventListener('pagehide', handlePageHide)
  if (kind === 'video') startQuestionTimer()
})
onUnmounted(() => {
  window.removeEventListener('pagehide', handlePageHide)
  clearInterval(timerInterval)
})
```

Change `function next() { if (!isLastQuestion.value) currentIndex.value++
}` to also restart the timer:

```js
function next() {
  if (!isLastQuestion.value) {
    currentIndex.value++
    if (kind === 'video') startQuestionTimer()
  }
}
```

- [ ] **Step 3: Branch `selectAnswer()` and `gradeAndSave()` on `kind === 'video'`**

Change:

```js
async function selectAnswer(optIndex) {
  if (isRevealed.value || checking.value) return
  checkError.value = ''
  checking.value = true
  try {
    const result = kind === 'standard'
      ? await api.checkStandardAnswer(currentQuestion.value.id, optIndex)
      : await api.checkAiAnswer(auth.staff.outlet, passcode, currentIndex.value, optIndex)
    answers.value[currentIndex.value] = { chosen: optIndex, correct: result.correct, correctIndex: result.correctIndex }
  } catch (err) {
    checkError.value = t('quizView.errorCheckFailed')
  } finally {
    checking.value = false
  }
}
```

to:

```js
async function selectAnswer(optIndex) {
  if (isRevealed.value || checking.value) return
  checkError.value = ''
  checking.value = true
  try {
    let result
    if (kind === 'standard') result = await api.checkStandardAnswer(currentQuestion.value.id, optIndex)
    else if (kind === 'video') result = await api.checkVideoAnswer(currentQuestion.value.id, optIndex)
    else result = await api.checkAiAnswer(auth.staff.outlet, passcode, currentIndex.value, optIndex)
    answers.value[currentIndex.value] = { chosen: optIndex, correct: result.correct, correctIndex: result.correctIndex }
  } catch (err) {
    checkError.value = t('quizView.errorCheckFailed')
  } finally {
    checking.value = false
  }
}
```

Change:

```js
async function gradeAndSave() {
  if (hasSubmitted.value) return null
  hasSubmitted.value = true

  const payloadAnswers = questions.value.map((q, i) => {
    const a = answers.value[i]
    return kind === 'standard' ? { id: q.id, chosen: a?.chosen } : { index: i, chosen: a?.chosen }
  })

  return kind === 'standard'
    ? api.saveResult({ name: auth.staff.name, outlet: auth.staff.outlet, topic, answers: payloadAnswers })
    : api.saveAiResult({ attemptId: 'AI' + Date.now(), name: auth.staff.name, outlet: auth.staff.outlet, topic, passcode, answers: payloadAnswers })
}
```

to:

```js
async function gradeAndSave() {
  if (hasSubmitted.value) return null
  hasSubmitted.value = true
  clearInterval(timerInterval)

  const payloadAnswers = questions.value.map((q, i) => {
    const a = answers.value[i]
    return kind === 'ai' ? { index: i, chosen: a?.chosen } : { id: q.id, chosen: a?.chosen }
  })

  if (kind === 'standard') return api.saveResult({ name: auth.staff.name, outlet: auth.staff.outlet, topic, answers: payloadAnswers })
  if (kind === 'video') return api.saveVideoResult({ name: auth.staff.name, outlet: auth.staff.outlet, topic, answers: payloadAnswers })
  return api.saveAiResult({ attemptId: 'AI' + Date.now(), name: auth.staff.name, outlet: auth.staff.outlet, topic, passcode, answers: payloadAnswers })
}
```

(Note: the `payloadAnswers` mapping condition flips from `kind ===
'standard' ? {id,...} : {index,...}` to `kind === 'ai' ? {index,...} :
{id,...}` — both `'standard'` and `'video'` now use `{id, chosen}`, since
`video_questions` rows have real `id`s just like `standard_questions`; only
`'ai'` uses positional `{index, chosen}` against its ephemeral
`questions_json`.)

- [ ] **Step 4: Widen the anti-fraud guard and Back-button-disabled condition**

Change:

```js
onBeforeRouteLeave(async (to, from, next) => {
  if (kind !== 'standard' || answeredCount.value === 0 || hasSubmitted.value) {
```

to:

```js
onBeforeRouteLeave(async (to, from, next) => {
  if (!['standard', 'video'].includes(kind) || answeredCount.value === 0 || hasSubmitted.value) {
```

Change:

```js
function handlePageHide() {
  if (kind !== 'standard' || answeredCount.value === 0 || hasSubmitted.value) return
```

to:

```js
function handlePageHide() {
  if (!['standard', 'video'].includes(kind) || answeredCount.value === 0 || hasSubmitted.value) return
```

In the template, change:

```html
        <button
          @click="back"
          :disabled="currentIndex === 0 || (kind === 'standard' && answeredCount >= 1)"
          class="text-slate text-sm disabled:opacity-30"
        >
```

to:

```html
        <button
          @click="back"
          :disabled="currentIndex === 0 || (['standard', 'video'].includes(kind) && answeredCount >= 1)"
          class="text-slate text-sm disabled:opacity-30"
        >
```

- [ ] **Step 5: Show the countdown in the template**

Change the progress header:

```html
      <div class="flex items-center justify-between mb-4">
        <span class="text-slate text-xs">{{ t('quizView.questionProgress', { current: currentIndex + 1, total: questions.length }) }}</span>
        <LanguageSwitcher />
      </div>
```

to:

```html
      <div class="flex items-center justify-between mb-4">
        <span class="text-slate text-xs">{{ t('quizView.questionProgress', { current: currentIndex + 1, total: questions.length }) }}</span>
        <span v-if="kind === 'video'" class="text-coral text-xs font-medium">{{ t('quizView.timeRemaining', { seconds: timeRemaining }) }}</span>
        <LanguageSwitcher />
      </div>
```

- [ ] **Step 6: Add the `quizView.timeRemaining` i18n key**

In `lautan-academy-frontend/src/i18n/locales/en.json`, inside the existing
`quizView` block, change:

```json
    "confirmLeaveAutoSubmit": "Leaving now will submit your quiz with the answers you've given so far — unanswered questions count as wrong. This can't be undone. Leave and submit?"
  },
```

to:

```json
    "confirmLeaveAutoSubmit": "Leaving now will submit your quiz with the answers you've given so far — unanswered questions count as wrong. This can't be undone. Leave and submit?",
    "timeRemaining": "{seconds}s left"
  },
```

In `lautan-academy-frontend/src/i18n/locales/ms.json`, change:

```json
    "confirmLeaveAutoSubmit": "Keluar sekarang akan menghantar kuiz anda dengan jawapan yang telah diberikan setakat ini — soalan yang tidak dijawab akan dikira salah. Ini tidak boleh dibuat asal. Keluar dan hantar?"
  },
```

to:

```json
    "confirmLeaveAutoSubmit": "Keluar sekarang akan menghantar kuiz anda dengan jawapan yang telah diberikan setakat ini — soalan yang tidak dijawab akan dikira salah. Ini tidak boleh dibuat asal. Keluar dan hantar?",
    "timeRemaining": "{seconds}s berbaki"
  },
```

- [ ] **Step 7: Verify build is clean**

Run: `cd lautan-academy-frontend && npm run build`
Expected: clean.

- [ ] **Step 8: Full end-to-end manual verification**

Set up temporary test data again (one `video_trainings` row + 2-3
`video_questions` rows for its topic, via the same `node -e`/curl pattern
as earlier tasks). In the browser as CDR/MOHD HAFIZ: go to Video Training,
open the test video, let it play to the end (seeking to near the end is
fine — free seeking is allowed by design). Confirm:
- The quiz page shows the countdown (`"30s left"` counting down).
- Answering a question shows the live reveal (✓ on the correct option),
  same as Module Quiz.
- Letting the timer hit 0 on an unanswered question auto-advances to the
  next one.
- Reaching the last question and either submitting normally or letting the
  timer expire lands on the Result screen with a real score.
- That topic now shows up in Quiz History.
- Back button is disabled once the first question is answered (same as
  Module Quiz).
- Starting a fresh attempt, answering question 1, then clicking a sidebar
  nav link triggers the same "leaving will submit" confirm dialog Module
  Quiz has, and confirming it records the attempt.

Clean up the temporary `video_trainings`/`video_questions` rows and the
resulting `results`/`wrong_answers` test rows afterward.

- [ ] **Step 9: Commit**

```bash
cd lautan-academy
git add lautan-academy-frontend/src/views/QuizView.vue lautan-academy-frontend/src/i18n/locales/en.json lautan-academy-frontend/src/i18n/locales/ms.json
git commit -m "Extend QuizView.vue to support kind: 'video'

Adds a 30s-per-question countdown (video-training only), branches
answer-check/grade-save to the new video-questions/video-results
endpoints, and widens the existing Module Quiz anti-fraud guard
(abandon-lock, Back button disabled once answered) to also cover this
kind — a graded, saved attempt deserves the same protection Module
Quiz already has. Standard/AI Practice behavior unchanged."
```

---

### Task 10: Frontend — Supervisor video training management

**Files:**
- Modify: `lautan-academy-frontend/src/views/SupervisorAddResourcesView.vue` (add a second list+form block)
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`, `ms.json` (new `supervisorAddResourcesView` keys, prefixed `video*` to avoid colliding with the existing Content-form keys)

**Interfaces:**
- Consumes: `api.getVideoTrainings`, `api.addVideoTraining`, `api.deleteVideoTraining` (Task 5).

- [ ] **Step 1: Add video training state and handlers to the script**

In `lautan-academy-frontend/src/views/SupervisorAddResourcesView.vue`,
change the top of the `<script setup>` block:

```js
const content = ref([])
const loadingContent = ref(true)
```

to:

```js
const content = ref([])
const loadingContent = ref(true)
const videoTrainings = ref([])
const loadingVideos = ref(true)
const vTitle = ref('')
const vTopic = ref('')
const vYoutubeUrl = ref('')
const vError = ref('')
const vSaving = ref(false)
```

Change `loadContent()`'s definition and its call site:

```js
async function loadContent() {
  loadingContent.value = true
  const [contentResult, resourcesResult] = await Promise.allSettled([api.getContent(), api.getResources()])
  if (contentResult.status === 'fulfilled') content.value = contentResult.value.content || []
  if (resourcesResult.status === 'fulfilled') driveCategories.value = [...new Set((resourcesResult.value.referenceDocs || []).map(r => r.Category))].filter(Boolean)
  loadingContent.value = false
}
loadContent()
```

to:

```js
async function loadContent() {
  loadingContent.value = true
  const [contentResult, resourcesResult] = await Promise.allSettled([api.getContent(), api.getResources()])
  if (contentResult.status === 'fulfilled') content.value = contentResult.value.content || []
  if (resourcesResult.status === 'fulfilled') driveCategories.value = [...new Set((resourcesResult.value.referenceDocs || []).map(r => r.Category))].filter(Boolean)
  loadingContent.value = false
}
loadContent()

async function loadVideoTrainings() {
  loadingVideos.value = true
  try {
    const data = await api.getVideoTrainings()
    videoTrainings.value = data.videoTrainings || []
  } catch (e) { /* leave empty */ }
  loadingVideos.value = false
}
loadVideoTrainings()

async function addVideoTraining() {
  vError.value = ''
  if (!vTitle.value.trim() || !vTopic.value.trim() || !vYoutubeUrl.value.trim()) {
    vError.value = t('supervisorAddResourcesView.videoErrorRequiredFields')
    return
  }
  vSaving.value = true
  try {
    await api.addVideoTraining({ title: vTitle.value.trim(), topic: vTopic.value.trim(), youtubeUrl: vYoutubeUrl.value.trim() })
    vTitle.value = ''
    vTopic.value = ''
    vYoutubeUrl.value = ''
    await loadVideoTrainings()
  } catch (err) {
    vError.value = err.message || t('supervisorAddResourcesView.videoErrorSaveFailed')
  } finally {
    vSaving.value = false
  }
}

async function removeVideoTraining(video) {
  if (!confirm(t('supervisorAddResourcesView.videoConfirmRemove', { title: video.title }))) return
  try {
    await api.deleteVideoTraining(video.id)
    await loadVideoTrainings()
  } catch (e) { /* best-effort */ }
}
```

- [ ] **Step 2: Add the video training list+form to the template**

In the template, after the existing Content `<form>`'s closing `</form>`
tag and before `</main>`, add:

```html
      <h2 class="font-display text-lg font-semibold text-ink mt-8 mb-3">{{ t('supervisorAddResourcesView.videoSectionTitle') }}</h2>

      <div v-if="loadingVideos" class="text-slate text-sm">{{ t('supervisorAddResourcesView.loading') }}</div>
      <div v-else-if="videoTrainings.length === 0" class="text-slate text-sm mb-4">{{ t('supervisorAddResourcesView.videoNoEntriesYet') }}</div>
      <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam mb-4">
        <div v-for="video in videoTrainings" :key="video.id" class="px-5 py-3 flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-medium text-ink truncate">{{ video.title }}</p>
            <p class="text-xs text-slate">{{ video.topic }}</p>
          </div>
          <button @click="removeVideoTraining(video)" class="text-coral text-xs font-medium underline shrink-0">{{ t('supervisorAddResourcesView.remove') }}</button>
        </div>
      </div>

      <form @submit.prevent="addVideoTraining" class="bg-white rounded-xl2 p-5 shadow-sm space-y-3">
        <div>
          <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorAddResourcesView.titleLabel') }}</label>
          <input v-model="vTitle" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
        </div>
        <div>
          <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorAddResourcesView.videoTopicLabel') }}</label>
          <input v-model="vTopic" type="text" :placeholder="t('supervisorAddResourcesView.topicPlaceholder')" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
          <p class="text-xs text-slate mt-1">{{ t('supervisorAddResourcesView.videoTopicHelper') }}</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorAddResourcesView.videoLinkLabel') }}</label>
          <input v-model="vYoutubeUrl" type="text" placeholder="https://www.youtube.com/watch?v=..." class="w-full border border-slate/30 rounded-lg py-2 px-3" />
        </div>
        <p v-if="vError" class="text-coral text-sm">{{ vError }}</p>
        <button type="submit" :disabled="vSaving" class="bg-aqua text-white font-medium px-5 py-2.5 rounded-lg disabled:opacity-60">
          {{ vSaving ? t('supervisorAddResourcesView.saving') : t('supervisorAddResourcesView.videoAddEntry') }}
        </button>
      </form>
```

- [ ] **Step 3: Add the new i18n keys**

In `lautan-academy-frontend/src/i18n/locales/en.json`, inside the existing
`supervisorAddResourcesView` block, change:

```json
    "saving": "Saving...",
    "addEntry": "Add entry"
  },
```

to:

```json
    "saving": "Saving...",
    "addEntry": "Add entry",
    "videoSectionTitle": "Video Training",
    "videoNoEntriesYet": "No video trainings yet — add one below.",
    "videoTopicLabel": "Topic",
    "videoTopicHelper": "Must match a topic with questions already added to the video_questions bank (Supabase table editor for now).",
    "videoLinkLabel": "YouTube link",
    "videoErrorRequiredFields": "Title, topic, and YouTube link are required.",
    "videoErrorSaveFailed": "Could not save.",
    "videoConfirmRemove": "Remove \"{title}\"?",
    "videoAddEntry": "Add video training"
  },
```

In `lautan-academy-frontend/src/i18n/locales/ms.json`, change:

```json
    "saving": "Menyimpan...",
    "addEntry": "Tambah entri"
  },
```

to:

```json
    "saving": "Menyimpan...",
    "addEntry": "Tambah entri",
    "videoSectionTitle": "Latihan Video",
    "videoNoEntriesYet": "Belum ada latihan video — tambah satu di bawah.",
    "videoTopicLabel": "Topik",
    "videoTopicHelper": "Mesti sepadan dengan topik yang sudah mempunyai soalan dalam bank video_questions (Supabase table editor buat masa ini).",
    "videoLinkLabel": "Pautan YouTube",
    "videoErrorRequiredFields": "Tajuk, topik, dan pautan YouTube diperlukan.",
    "videoErrorSaveFailed": "Tidak dapat menyimpan.",
    "videoConfirmRemove": "Alih keluar \"{title}\"?",
    "videoAddEntry": "Tambah latihan video"
  },
```

- [ ] **Step 4: Verify build is clean**

Run: `cd lautan-academy-frontend && npm run build`
Expected: clean.

- [ ] **Step 5: Manual verification**

Log in as Supervisor, navigate to Add Resources. Confirm a new "Video
Training" section appears below the existing Content form. Add a video
(title, topic, a real YouTube link) — confirm it appears in the list.
Confirm submitting a non-YouTube link shows the backend's rejection message
inline. Click Remove on the test entry — confirm it disappears. Separately,
confirm the entry (while it briefly existed with a topic that has no
`video_questions` rows) correctly did **not** show up yet in the staff-side
`/video-training` list (Task 7's dead-end guard) — add a real question to
that topic via Supabase table editor first if you want to see the full
staff-side flow instead.

- [ ] **Step 6: Commit**

```bash
cd lautan-academy
git add lautan-academy-frontend/src/views/SupervisorAddResourcesView.vue lautan-academy-frontend/src/i18n/locales/en.json lautan-academy-frontend/src/i18n/locales/ms.json
git commit -m "Add Supervisor Video Training management to Add Resources

New list+form block (title/topic/YouTube link), mirrors the existing
Content add/list/delete UI on the same page. Backend already validates
the YouTube link server-side; the topic helper text calls out that
video_questions still has no in-app authoring UI (Supabase table
editor only, matching standard_questions today)."
```

---

## Self-review notes (for the plan author, not a task)

- **Spec coverage:** YouTube embed, in-app playback, free seeking (Task 8)
  ✓. Separate `video_questions` table (Task 1) ✓. 30s fixed per-question
  timer (Task 9) ✓. Navigate to `/quiz`, reuse `QuizView.vue` (Task 9) ✓.
  Graded + saved into `results` (Task 4, 9) ✓. Anti-fraud guard widened
  (Task 9) ✓. Retail-only nav (Task 6) ✓. Supervisor-only management (Task
  3, 10) ✓. Dead-end prevention — video list only shows topics with an
  active question bank (Task 2, verified explicitly in Task 3 Step 3) ✓.
  YouTube URL server-side validation (Task 3) ✓. Bilingual strings
  throughout (every task with new UI copy) ✓. Accepted-risk note (YouTube
  Unlisted leak risk) — this is a decision documented in the spec, not a
  code behavior, so no task implements it; nothing further needed.
- **Placeholder scan:** no TBD/TODO, no "similar to Task N" shortcuts —
  every code block is complete and copy-pasteable.
- **Type/name consistency:** `kind: 'video'` is the exact string used
  everywhere — `VideoWatchView.vue`'s sessionStorage write (Task 8),
  `QuizView.vue`'s every branch (Task 9). `api.getVideoTrainings()` /
  `getVideoQuestions(topic)` / `checkVideoAnswer(id, chosen)` /
  `saveVideoResult(payload)` / `addVideoTraining(payload)` /
  `deleteVideoTraining(id)` (all defined Task 5) are called with matching
  names and argument shapes in Tasks 7, 8, 9, 10 — checked against each
  call site above. Backend response shape `{videoTrainings: [{id, title,
  topic, youtubeUrl}]}` (Task 2) matches exactly what `VideoTrainingListView`
  (Task 7) and `VideoWatchView` (Task 8) read. `{questions: [...]}` (Task 2)
  matches what `VideoWatchView` (Task 8) and `QuizView` (Task 9, via the
  sessionStorage envelope) expect.
