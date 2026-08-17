# Browse Courses Reading Quiz + CPD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supervisor can flag a Browse Courses "Knowledge" (Content) entry as quiz-required with real CPD hours; retail staff who read it and pass a Supervisor-authored quiz earn those hours, capped to their first attempt per topic per calendar year. Unmarked entries and AI Practice are completely unaffected.

**Architecture:** New columns on the existing `content` table (`quiz_required`, `hours`) plus a new sibling table `content_questions` — a field-for-field copy of `video_questions`, keyed by `content.topic` text with no FK (matches the existing `standard_questions`/`video_questions` no-FK convention). Attempts land in the existing shared `results` table, discriminated by topic membership in `content` where `quiz_required` — the same "shared table, topic-membership tells kinds apart" pattern Module Quiz and Video Training already use. `cpdHoursThisYear()` becomes a 3-way split instead of 2-way. Frontend gets one new staff-facing page (`ContentReadingView.vue`, mirrors the existing `ReadingView.vue`) and one new Supervisor admin page (`SupervisorManageContentQuizQuestionsView.vue`, mirrors the existing `SupervisorManageQuizQuestionsView.vue`) rather than generalizing the existing video-quiz components — keeps each component single-purpose and avoids risking a regression in the already-shipped Video Training/Pharmacist Courses admin UI.

**Tech Stack:** Node.js/Express/Postgres (backend repo), Vue 3 `<script setup>`/Vue Router 4/vue-i18n (frontend repo). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-17-content-reading-quiz-design.md`

## Global Constraints

- Bilingual EN/MS: every new user-facing string needs both `en.json` and `ms.json` entries, same key, same nesting (per `CLAUDE.md`).
- No new frameworks/libraries without asking first — this plan introduces none.
- No test framework in either repo (no vitest/jest/pytest) — verification is `npm run build` (frontend, must stay clean), curl/`node -e` round-trips against the live dev backend (backend), and the EN/MS key-parity script, per this project's documented convention. Live browser click-through is recommended but has not been available in recent sessions (no Playwright tool) — flag this gap rather than skip it silently.
- Match existing file conventions over textbook best practice — mirror `video_questions`'/`video_trainings`' exact shape and route patterns throughout, don't invent new ones.
- Frontend repo: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend`. Backend repo: `C:\Users\Hafiz\projects\lautan-academy-backend` — separate git repos, separate commits, `master`/`main` respectively, direct commits (no feature-branch workflow).
- No migration runner in either repo — schema changes are applied directly against the live Supabase DB via a one-off `node -e` script, same as every prior schema change in this project.
- Any JWT needed for curl verification is minted directly via `issueToken()` in a one-off `node -e` script (bypasses `/auth/*` login entirely, touches no real PIN) — never use real credentials for verification.
- Any throwaway DB rows inserted purely for verification (`content`, `content_questions`, `results`, `sessions`) are deleted again at the end of the same task's verification step — no test data left behind in the shared production Supabase DB. Confirm zero leftover via a count query before moving on.
- Retail-only: every staff-facing piece of this feature (reading page, quiz submission, CPD credit) is gated to `division === 'retail'`, matching Module Quiz/Video Training. Warehouse staff and all manager tiers see `quiz_required` Content entries exactly as they do today — no behavior change for them.
- AI Practice is not touched anywhere in this plan.

---

### Task 1: Schema — `content.quiz_required`/`hours` + new `content_questions` table

**Files:**
- Modify: `lautan-academy-backend/sql/schema.sql` (append at end)

**Interfaces:**
- Produces: `content.quiz_required boolean default false`, `content.hours numeric default 1`; new table `content_questions(id, topic, question_en, question_ms, opt1_en..opt4_en, opt1_ms..opt4_ms, correct, status, created_at)`. Consumed by every later task.

- [ ] **Step 1: Append the schema change to `schema.sql`**

Add this at the end of `lautan-academy-backend/sql/schema.sql`:

```sql
-- Browse Courses reading quiz + CPD. quiz_required/hours mirror
-- video_trainings' opt-in-per-entry pattern. content_questions is a
-- field-for-field copy of video_questions — same no-FK, topic-text-keyed
-- convention as every other question bank in this app. See
-- docs/superpowers/specs/2026-08-17-content-reading-quiz-design.md.
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
create index if not exists idx_content_questions_topic on content_questions (topic);
```

- [ ] **Step 2: Apply the schema change to the live database**

Run from `lautan-academy-backend`:

```bash
node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  await pool.query('alter table content add column if not exists quiz_required boolean not null default false');
  await pool.query('alter table content add column if not exists hours numeric not null default 1');
  await pool.query(\`create table if not exists content_questions (
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
  await pool.query('create index if not exists idx_content_questions_topic on content_questions (topic)');
  console.log('done');
  process.exit(0);
});
"
```

- [ ] **Step 3: Verify the change**

```bash
node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  const cols = await pool.query(\`select column_name from information_schema.columns where table_name='content' and column_name in ('quiz_required','hours')\`);
  const tbl = await pool.query(\`select table_name from information_schema.tables where table_schema='public' and table_name='content_questions'\`);
  console.log('content columns:', cols.rows.map(r => r.column_name));
  console.log('content_questions exists:', tbl.rows.length === 1);
  process.exit(0);
});
"
```

Expected: `content columns: [ 'quiz_required', 'hours' ]` (order may vary), `content_questions exists: true`.

- [ ] **Step 4: Commit**

```bash
cd lautan-academy-backend
git add sql/schema.sql
git commit -m "Add content.quiz_required/hours and content_questions table

Schema for the Browse Courses reading-quiz-CPD feature. Applied
directly to the live DB (no migration runner in this project)."
```

---

### Task 2: Backend — Content entry routes gain `quizRequired`/`hours`

**Files:**
- Modify: `lautan-academy-backend/src/routes/content.js`

**Interfaces:**
- Consumes: `pool`, `requireAuth`, `requireScope`, `logAuditSafe` (all existing imports in this file).
- Produces: `GET /content` response items gain `QuizRequired`/`Hours`/`QuizReady` fields; `POST /content` accepts optional `quizRequired`/`hours` in the body. Consumed by Task 9 (Supervisor form) and Task 8 (`ResourcesView.vue`).

- [ ] **Step 1: Extend `GET /content` and `POST /content`**

In `lautan-academy-backend/src/routes/content.js`, replace the `GET /` and `POST /` handlers:

```js
// Company-wide, not outlet-scoped — any authenticated role can read.
// QuizReady mirrors GET /video-trainings' own exists-check: a
// quiz_required entry only becomes actionable for staff once it has
// at least one active question, so a staff member can't tap into a
// dead end (see docs/superpowers/specs/2026-08-17-content-reading-quiz-design.md).
contentRouter.get('/', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    select c.id, c.topic, c.category, c.title, c.body, c.link, c.created_at,
      c.quiz_required, c.hours,
      exists (
        select 1 from content_questions cq
        where cq.topic = c.topic and cq.status = 'active'
      ) as quiz_ready
    from content c
    order by c.topic, c.title
  `);
  res.json({
    content: rows.map(c => ({
      ID: c.id, Topic: c.topic, Category: c.category, Title: c.title, Body: c.body, Link: c.link, Timestamp: c.created_at,
      QuizRequired: c.quiz_required, Hours: Number(c.hours), QuizReady: c.quiz_ready,
    })),
  });
});

// Matches GAS's handleSaveContent gating — Supervisor only. quizRequired/
// hours are optional (default false/1) so existing callers/behavior are
// unchanged; hours is only ever read when quizRequired is true.
contentRouter.post('/', requireAuth, requireScope('supervisor'), async (req, res) => {
  const topic = (req.body.topic || '').toString().trim();
  const category = (req.body.category || '').toString().trim();
  const title = (req.body.title || '').toString().trim();
  const body = (req.body.body || '').toString().trim();
  const link = (req.body.link || '').toString().trim();
  const quizRequired = !!req.body.quizRequired;
  const hoursRaw = req.body.hours;
  const hours = hoursRaw === undefined || hoursRaw === null || hoursRaw === '' ? 1 : Number(hoursRaw);
  if (!topic || !title || !body) {
    return res.status(400).json({ status: 'error', error: 'Topic, title, and body are required.' });
  }
  if (quizRequired && (!Number.isFinite(hours) || hours <= 0)) {
    return res.status(400).json({ status: 'error', error: 'Hours must be a positive number.' });
  }
  const { rows } = await pool.query(
    'insert into content (topic, category, title, body, link, quiz_required, hours) values ($1,$2,$3,$4,$5,$6,$7) returning id',
    [topic, category, title, body, link, quizRequired, quizRequired ? hours : 1]
  );
  logAuditSafe({
    actorType: req.session.scopeType,
    actorKey: req.session.scopeKey,
    action: 'content.add',
    summary: `Added content "${title}" (${topic})${quizRequired ? ` [quiz required, ${hours}h]` : ''}`,
  });
  res.json({ status: 'ok', id: rows[0].id });
});
```

- [ ] **Step 2: Verify with curl round-trips**

Start the dev server if not already running (`cd lautan-academy-backend && npm run dev`), then mint a disposable Supervisor JWT and exercise both endpoints:

```bash
cd lautan-academy-backend
node -e "
import('./src/middleware/auth.js').then(async ({ issueToken }) => {
  const token = await issueToken('supervisor', 'ALL');
  console.log(token);
  process.exit(0);
});
" > /tmp/sup-token.txt
TOKEN=$(cat /tmp/sup-token.txt)

# hours <= 0 with quizRequired=true -> 400
curl -s -X POST http://localhost:3000/content -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"topic":"TESTQUIZTOPIC","category":"Test","title":"Test Entry","body":"Body text","quizRequired":true,"hours":0}'
echo

# valid create -> 200, id returned
curl -s -X POST http://localhost:3000/content -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"topic":"TESTQUIZTOPIC","category":"Test","title":"Test Entry","body":"Body text","quizRequired":true,"hours":2.5}'
echo

# GET /content includes QuizRequired/Hours/QuizReady (false, since no questions yet)
curl -s http://localhost:3000/content -H "Authorization: Bearer $TOKEN" | node -e "
let data = '';
process.stdin.on('data', d => data += d);
process.stdin.on('end', () => {
  const json = JSON.parse(data);
  const entry = json.content.find(c => c.Topic === 'TESTQUIZTOPIC');
  console.log(entry);
});
"
```

Expected: first call 400 (`Hours must be a positive number.`); second call `{"status":"ok","id":<n>}`; third call shows `QuizRequired: true, Hours: 2.5, QuizReady: false`.

- [ ] **Step 3: Clean up the test row**

```bash
node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  await pool.query(\"delete from content where topic = 'TESTQUIZTOPIC'\");
  await pool.query(\"delete from sessions where scope_key = 'ALL'\");
  console.log('cleaned');
  process.exit(0);
});
"
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/content.js
git commit -m "Extend content routes with quizRequired/hours/quizReady

GET /content now reports whether an entry is quiz-required and has a
ready question bank; POST /content accepts the new optional fields."
```

---

### Task 3: Backend — `content_questions` CRUD + quiz-taking routes

**Files:**
- Modify: `lautan-academy-backend/src/routes/content.js` (add `contentQuestionsRouter`)
- Modify: `lautan-academy-backend/src/index.js` (import + mount)

**Interfaces:**
- Consumes: `pool`, `requireAuth`, `requireScope`, `logAuditSafe` (existing); `hitRateLimit` (new import from `../middleware/rateLimit.js`, existing module).
- Produces: `contentQuestionsRouter` (Express Router, exported), mounted at `/content-questions`, handling `GET /?topic=`, `POST /:id/check`, `POST /`, `PATCH /:id`, `DELETE /:id`. Consumed by Task 5 (`api/client.js`), Task 7 (`ContentReadingView.vue`/`QuizView.vue`), Task 10 (Supervisor admin UI).

- [ ] **Step 1: Add `contentQuestionsRouter` to `content.js`**

Add this at the top of `lautan-academy-backend/src/routes/content.js` (new import) and at the end of the file (new router) — a direct copy of `video_questions`' equivalent routes in `routes/videoTraining.js`, s/video/content throughout:

Add to the import line at the top:
```js
import { hitRateLimit } from '../middleware/rateLimit.js';
```

Append at the end of the file:
```js
// Content quiz bank — direct copy of video_questions' router shape in
// routes/videoTraining.js (topic validated against real content rows,
// no FK; MCQ 4-option or True/False 2-option; hard delete blocked on a
// topic's last question). See
// docs/superpowers/specs/2026-08-17-content-reading-quiz-design.md.
export const contentQuestionsRouter = Router();

contentQuestionsRouter.get('/', requireAuth, async (req, res) => {
  const topic = (req.query.topic || '').toString().trim();
  if (!topic) return res.json({ questions: [] });
  const { rows } = await pool.query(
    "select id, topic, question_en, question_ms, opt1_en, opt2_en, opt3_en, opt4_en, opt1_ms, opt2_ms, opt3_ms, opt4_ms from content_questions where topic = $1 and status = 'active' order by id",
    [topic]
  );
  res.json({ questions: rows });
});

contentQuestionsRouter.post('/:id/check', requireAuth, async (req, res) => {
  if (await hitRateLimit(`check_content_${req.session.scopeKey}`, 80, 10 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many checks — slow down and try again shortly.' });
  }
  const id = parseInt(req.params.id);
  const chosen = parseInt(req.body.chosen);
  const { rows } = await pool.query('select correct from content_questions where id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Question not found.' });
  const correctIndex = rows[0].correct;
  res.json({ correct: chosen === correctIndex, correctIndex });
});

async function contentTopicExists(topic) {
  const { rows } = await pool.query('select 1 from content where topic = $1 limit 1', [topic]);
  return rows.length > 0;
}

function validateContentQuestionBody(body) {
  const topic = (body.topic || '').toString().trim();
  const type = (body.type || '').toString().trim();
  const question_en = (body.question_en || '').toString().trim();
  const question_ms = (body.question_ms || '').toString().trim();
  const opt1_en = (body.opt1_en || '').toString().trim();
  const opt2_en = (body.opt2_en || '').toString().trim();
  const opt3_en = (body.opt3_en || '').toString().trim();
  const opt4_en = (body.opt4_en || '').toString().trim();
  const opt1_ms = (body.opt1_ms || '').toString().trim();
  const opt2_ms = (body.opt2_ms || '').toString().trim();
  const opt3_ms = (body.opt3_ms || '').toString().trim();
  const opt4_ms = (body.opt4_ms || '').toString().trim();
  const correct = parseInt(body.correct);

  if (!topic) return { error: 'Topic is required.' };
  if (!['mcq', 'tf'].includes(type)) return { error: 'Type must be mcq or tf.' };
  if (!question_en || !question_ms) return { error: 'Question text (En and Ms) is required.' };
  if (!opt1_en || !opt2_en || !opt1_ms || !opt2_ms) return { error: 'At least two options (En and Ms) are required.' };
  if (type === 'mcq' && (!opt3_en || !opt4_en || !opt3_ms || !opt4_ms)) return { error: 'MCQ requires all four options (En and Ms).' };
  const maxCorrect = type === 'mcq' ? 3 : 1;
  if (!Number.isInteger(correct) || correct < 0 || correct > maxCorrect) return { error: `Correct must be an integer between 0 and ${maxCorrect} for this type.` };

  return {
    row: {
      topic, question_en, question_ms,
      opt1_en, opt2_en,
      opt3_en: type === 'mcq' ? opt3_en : '', opt4_en: type === 'mcq' ? opt4_en : '',
      opt1_ms, opt2_ms,
      opt3_ms: type === 'mcq' ? opt3_ms : '', opt4_ms: type === 'mcq' ? opt4_ms : '',
      correct,
    },
  };
}

contentQuestionsRouter.post('/', requireAuth, requireScope('supervisor'), async (req, res) => {
  const { error, row } = validateContentQuestionBody(req.body);
  if (error) return res.status(400).json({ status: 'error', error });

  if (!(await contentTopicExists(row.topic))) {
    return res.status(400).json({ status: 'error', error: `Unknown topic '${row.topic}' — no content entry with this topic exists.` });
  }

  const { rows } = await pool.query(
    `insert into content_questions
      (topic, question_en, question_ms, opt1_en, opt2_en, opt3_en, opt4_en, opt1_ms, opt2_ms, opt3_ms, opt4_ms, correct, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active')
     returning id`,
    [row.topic, row.question_en, row.question_ms, row.opt1_en, row.opt2_en, row.opt3_en, row.opt4_en, row.opt1_ms, row.opt2_ms, row.opt3_ms, row.opt4_ms, row.correct]
  );
  logAuditSafe({
    actorType: req.session.scopeType,
    actorKey: req.session.scopeKey,
    action: 'content_question.add',
    summary: `Added content question to topic "${row.topic}": ${row.question_en.slice(0, 60)}`,
  });
  res.json({ status: 'ok', id: rows[0].id });
});

contentQuestionsRouter.patch('/:id', requireAuth, requireScope('supervisor'), async (req, res) => {
  const id = parseInt(req.params.id);
  const { rows: existingRows } = await pool.query('select id from content_questions where id = $1', [id]);
  if (!existingRows[0]) return res.status(404).json({ status: 'error', error: 'Question not found.' });

  const { error, row } = validateContentQuestionBody(req.body);
  if (error) return res.status(400).json({ status: 'error', error });

  if (!(await contentTopicExists(row.topic))) {
    return res.status(400).json({ status: 'error', error: `Unknown topic '${row.topic}' — no content entry with this topic exists.` });
  }

  await pool.query(
    `update content_questions set
      topic=$1, question_en=$2, question_ms=$3,
      opt1_en=$4, opt2_en=$5, opt3_en=$6, opt4_en=$7,
      opt1_ms=$8, opt2_ms=$9, opt3_ms=$10, opt4_ms=$11,
      correct=$12
     where id=$13`,
    [row.topic, row.question_en, row.question_ms, row.opt1_en, row.opt2_en, row.opt3_en, row.opt4_en, row.opt1_ms, row.opt2_ms, row.opt3_ms, row.opt4_ms, row.correct, id]
  );
  logAuditSafe({
    actorType: req.session.scopeType,
    actorKey: req.session.scopeKey,
    action: 'content_question.update',
    summary: `Updated content question ${id} (topic "${row.topic}")`,
  });
  res.json({ status: 'ok' });
});

contentQuestionsRouter.delete('/:id', requireAuth, requireScope('supervisor'), async (req, res) => {
  const id = parseInt(req.params.id);
  const { rows } = await pool.query('select topic from content_questions where id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ status: 'error', error: 'Question not found.' });
  const topic = rows[0].topic;

  const { rows: siblingRows } = await pool.query(
    'select count(*)::int as count from content_questions where topic = $1 and id != $2',
    [topic, id]
  );
  if (siblingRows[0].count === 0) {
    return res.status(400).json({
      status: 'error',
      error: `Can't delete: this is the only question left for "${topic}" — the quiz would disappear from staff view.`,
    });
  }

  await pool.query('delete from content_questions where id = $1', [id]);
  logAuditSafe({
    actorType: req.session.scopeType,
    actorKey: req.session.scopeKey,
    action: 'content_question.delete',
    summary: `Deleted content question ${id} (topic "${topic}")`,
  });
  res.json({ status: 'ok' });
});
```

- [ ] **Step 2: Mount the new router in `index.js`**

In `lautan-academy-backend/src/index.js`, change the content import line:

```js
import { contentRouter, contentQuestionsRouter } from './routes/content.js';
```

And add a new mount line right after the existing `/content` mount:

```js
app.use('/content', checkMaintenance, contentRouter);
app.use('/content-questions', checkMaintenance, contentQuestionsRouter);
```

- [ ] **Step 3: Verify with curl round-trips**

```bash
cd lautan-academy-backend
node -e "
import('./src/middleware/auth.js').then(async ({ issueToken }) => {
  const token = await issueToken('supervisor', 'ALL');
  console.log(token);
  process.exit(0);
});
" > /tmp/sup-token.txt
TOKEN=$(cat /tmp/sup-token.txt)

# recreate the disposable content entry from Task 2
curl -s -X POST http://localhost:3000/content -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"topic":"TESTQUIZTOPIC","category":"Test","title":"Test Entry","body":"Body text","quizRequired":true,"hours":2.5}'
echo

# unknown topic -> 400
curl -s -X POST http://localhost:3000/content-questions -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"topic":"NOSUCHTOPIC","type":"mcq","question_en":"Q?","question_ms":"S?","opt1_en":"A","opt2_en":"B","opt3_en":"C","opt4_en":"D","opt1_ms":"A","opt2_ms":"B","opt3_ms":"C","opt4_ms":"D","correct":0}'
echo

# real topic -> 200
curl -s -X POST http://localhost:3000/content-questions -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"topic":"TESTQUIZTOPIC","type":"mcq","question_en":"Q?","question_ms":"S?","opt1_en":"A","opt2_en":"B","opt3_en":"C","opt4_en":"D","opt1_ms":"A","opt2_ms":"B","opt3_ms":"C","opt4_ms":"D","correct":0}'
echo

# GET /content now shows QuizReady: true
curl -s http://localhost:3000/content -H "Authorization: Bearer $TOKEN" | node -e "
let data=''; process.stdin.on('data', d => data += d); process.stdin.on('end', () => {
  const entry = JSON.parse(data).content.find(c => c.Topic === 'TESTQUIZTOPIC');
  console.log('QuizReady:', entry.QuizReady);
});
"

# delete last question -> 400 blocked
QID=$(curl -s "http://localhost:3000/content-questions?topic=TESTQUIZTOPIC" -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).questions[0].id));")
curl -s -X DELETE "http://localhost:3000/content-questions/$QID" -H "Authorization: Bearer $TOKEN"
echo

# check endpoint: correct=0 -> {correct:true}
curl -s -X POST "http://localhost:3000/content-questions/$QID/check" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"chosen":0}'
echo
```

Expected: unknown-topic create 400; real create 200 with `id`; `QuizReady: true`; delete-last-question 400 (`Can't delete...`); check with `chosen:0` returns `{"correct":true,"correctIndex":0}`.

- [ ] **Step 4: Clean up test rows**

```bash
node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  await pool.query(\"delete from content_questions where topic = 'TESTQUIZTOPIC'\");
  await pool.query(\"delete from content where topic = 'TESTQUIZTOPIC'\");
  await pool.query(\"delete from sessions where scope_key = 'ALL'\");
  console.log('cleaned');
  process.exit(0);
});
"
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/content.js src/index.js
git commit -m "Add content_questions CRUD + quiz-taking routes

Direct copy of video_questions' router shape, mounted at
/content-questions. Supervisor-only admin, topic validated against
real content rows, blocks deleting a topic's last question."
```

---

### Task 4: Backend — `POST /data/content-results` grading endpoint

**Files:**
- Modify: `lautan-academy-backend/src/routes/data.js`

**Interfaces:**
- Consumes: `pool`, `isSameCalendarDay` (existing in this file).
- Produces: `POST /data/content-results` — same request/response shape as `POST /data/video-results`. Consumed by Task 5 (`api/client.js`), Task 7 (`QuizView.vue`).

- [ ] **Step 1: Add the endpoint**

Append to `lautan-academy-backend/src/routes/data.js`, directly after the existing `POST /video-results` handler:

```js
// Staff-triggered: save a completed Browse-Courses reading-quiz attempt.
// Direct copy of POST /video-results (server-authoritative grading,
// same-day no-op, same wrong_answers write) except it reads from
// content_questions instead of video_questions. Writes into the same
// `results` table Module Quiz/Video Training already share — topic
// membership in `content` (where quiz_required) is the third
// discriminator. Retail-only, same as Module Quiz/Video Training. See
// docs/superpowers/specs/2026-08-17-content-reading-quiz-design.md.
dataRouter.post('/content-results', requireAuth, async (req, res) => {
  const name = (req.body.name || '').toString().trim().toUpperCase();
  const outlet = (req.body.outlet || '').toString().trim().toUpperCase();
  const topic = (req.body.topic || 'N/A').toString().trim();
  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];

  if (req.session.scopeType !== 'staff_retail' || req.session.scopeKey !== `${outlet}|${name}`) {
    return res.status(403).json({ status: 'unauthorized' });
  }

  const { rows } = await pool.query(
    'select created_at, score, percentage from results where name=$1 and outlet=$2 and topic=$3 order by created_at desc limit 1',
    [name, outlet, topic]
  );
  const alreadyToday = rows[0] && isSameCalendarDay(new Date(rows[0].created_at), new Date());
  if (alreadyToday) {
    const [prevScore, prevTotal] = (rows[0].score || '0/0').split('/').map(Number);
    return res.json({ status: 'ok', score: prevScore, total: prevTotal, percentage: parseInt(rows[0].percentage) || 0 });
  }

  const { rows: questions } = await pool.query("select * from content_questions where topic = $1 and status = 'active' order by id", [topic]);
  if (!questions.length) return res.status(404).json({ status: 'error', error: 'No questions found for this material.' });

  const chosenById = new Map();
  for (const a of answers) chosenById.set(parseInt(a.id), parseInt(a.chosen));

  let score = 0;
  const wrongRows = [];
  for (const q of questions) {
    const chosen = chosenById.get(parseInt(q.id));
    if (chosen === q.correct) {
      score++;
    } else {
      const optsEn = [q.opt1_en, q.opt2_en, q.opt3_en, q.opt4_en];
      const optsMs = [q.opt1_ms, q.opt2_ms, q.opt3_ms, q.opt4_ms];
      wrongRows.push({
        questionEn: q.question_en, questionMs: q.question_ms,
        chosenEn: optsEn[chosen] ?? '(no answer)', chosenMs: optsMs[chosen] ?? '(tiada jawapan)',
        correctEn: optsEn[q.correct] ?? '', correctMs: optsMs[q.correct] ?? '',
      });
    }
  }
  const total = questions.length;
  const percentage = Math.round((score / total) * 100);
  const attemptId = `CNT${Date.now()}`;

  await pool.query(
    'insert into results (attempt_id, outlet, name, topic, score, percentage) values ($1,$2,$3,$4,$5,$6)',
    [attemptId, outlet, name, topic, `${score}/${total}`, `${percentage}%`]
  );
  for (const w of wrongRows) {
    await pool.query(
      'insert into wrong_answers (attempt_id, outlet, staff_name, topic, question_en, question_ms, chosen_en, chosen_ms, correct_en, correct_ms) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [attemptId, outlet, name, topic, w.questionEn, w.questionMs, w.chosenEn, w.chosenMs, w.correctEn, w.correctMs]
    );
  }
  res.json({ status: 'ok', score, total, percentage });
});
```

- [ ] **Step 2: Verify with a curl round-trip**

```bash
cd lautan-academy-backend
node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  await pool.query(\"insert into content (topic, category, title, body, quiz_required, hours) values ('TESTQUIZTOPIC','Test','Test Entry','Body',true,2.5)\");
  await pool.query(\"insert into content_questions (topic, question_en, question_ms, opt1_en, opt2_en, opt3_en, opt4_en, opt1_ms, opt2_ms, opt3_ms, opt4_ms, correct, status) values ('TESTQUIZTOPIC','Q?','S?','A','B','C','D','A','B','C','D',0,'active')\");
  console.log('seeded');
  process.exit(0);
});
"
node -e "
import('./src/middleware/auth.js').then(async ({ issueToken }) => {
  const token = await issueToken('staff_retail', 'TESTOUTLET|TESTSTAFF');
  console.log(token);
  process.exit(0);
});
" > /tmp/staff-token.txt
TOKEN=$(cat /tmp/staff-token.txt)

curl -s -X POST http://localhost:3000/data/content-results -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"TESTSTAFF","outlet":"TESTOUTLET","topic":"TESTQUIZTOPIC","answers":[{"id":1,"chosen":0}]}'
echo
# second call same day -> cached, no new row
curl -s -X POST http://localhost:3000/data/content-results -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"TESTSTAFF","outlet":"TESTOUTLET","topic":"TESTQUIZTOPIC","answers":[{"id":1,"chosen":1}]}'
echo

node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  const { rows } = await pool.query(\"select count(*) from results where outlet='TESTOUTLET' and name='TESTSTAFF'\");
  console.log('result rows:', rows[0].count);
  process.exit(0);
});
"
```

Expected: first call `{"status":"ok","score":1,"total":1,"percentage":100}`; second call returns the same cached score (100, not re-graded against `chosen:1`); `result rows: 1` (same-day dedup confirmed, no second insert).

- [ ] **Step 3: Clean up test rows**

```bash
node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  await pool.query(\"delete from results where outlet='TESTOUTLET' and name='TESTSTAFF'\");
  await pool.query(\"delete from content_questions where topic = 'TESTQUIZTOPIC'\");
  await pool.query(\"delete from content where topic = 'TESTQUIZTOPIC'\");
  await pool.query(\"delete from sessions where scope_key = 'TESTOUTLET|TESTSTAFF'\");
  console.log('cleaned');
  process.exit(0);
});
"
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/data.js
git commit -m "Add POST /data/content-results grading endpoint

Direct copy of POST /data/video-results reading from
content_questions. Writes into the shared results table, retail-only."
```

---

### Task 5: Backend — `cpdHoursThisYear()` 3-way split

**Files:**
- Modify: `lautan-academy-backend/src/routes/data.js`

**Interfaces:**
- Consumes: existing `pool`.
- Produces: `cpdHoursThisYear(outlet, name)` now sums Video Training (stacks) + Content quiz (real hours, capped first-attempt/topic/year) + Module Quiz (flat 1hr, capped first-attempt/topic/year). Return value/signature unchanged — still consumed by `GET /data/scoped-data` exactly as before.

- [ ] **Step 1: Replace `cpdHoursThisYear()`**

Replace the function (added in the Module Quiz CPD cap fix, commit `36c07a8`) with:

```js
// CPD hours this calendar year, summed across three sources:
// - Video Training: real per-video hours, every attempt stacks.
// - Content quiz (Browse Courses reading quiz): real per-entry hours,
//   capped to the first attempt per topic per year (distinct on r.topic,
//   earliest created_at) — unlike Module Quiz's uniform rate, each
//   Content topic can carry a different Supervisor-set hours value, so
//   which attempt is "first" actually determines the sum, not just how
//   many distinct topics were attempted.
// - Module Quiz: flat 1hr, capped to the first attempt per topic per
//   year (count(distinct topic) — equivalent to "first attempt only"
//   since the rate is flat). Explicitly excludes both Video Training and
//   Content-quiz topics so a topic is never double-counted across
//   sources (on top of the existing "topic namespaces don't collide by
//   design" convention).
// See docs/superpowers/specs/2026-08-13-cpd-hours-revision-design.md and
// docs/superpowers/specs/2026-08-17-content-reading-quiz-design.md.
async function cpdHoursThisYear(outlet, name) {
  const [video, contentQuiz, moduleQuiz] = await Promise.all([
    pool.query(
      `select coalesce(sum(coalesce(vt.hours, 1)), 0) as hours
       from results r
       join video_trainings vt on vt.topic = r.topic
       where r.outlet = $1 and r.name = $2
         and extract(year from r.created_at) = extract(year from now())`,
      [outlet, name]
    ),
    pool.query(
      `select coalesce(sum(first_attempts.hours), 0) as hours
       from (
         select distinct on (r.topic) r.topic, c.hours
         from results r
         join content c on c.topic = r.topic and c.quiz_required
         where r.outlet = $1 and r.name = $2
           and extract(year from r.created_at) = extract(year from now())
         order by r.topic, r.created_at asc
       ) first_attempts`,
      [outlet, name]
    ),
    pool.query(
      `select count(distinct r.topic) as topics
       from results r
       where r.outlet = $1 and r.name = $2
         and extract(year from r.created_at) = extract(year from now())
         and not exists (select 1 from video_trainings vt where vt.topic = r.topic)
         and not exists (select 1 from content c where c.topic = r.topic and c.quiz_required)`,
      [outlet, name]
    ),
  ]);
  return Number(video.rows[0].hours) + Number(contentQuiz.rows[0].hours) + Number(moduleQuiz.rows[0].topics);
}
```

- [ ] **Step 2: Verify live end-to-end against real prod DB**

```bash
cd lautan-academy-backend
node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  const OUTLET='TESTOUTLET', NAME='TESTSTAFF';
  await pool.query('delete from results where outlet=\$1 and name=\$2', [OUTLET, NAME]);
  await pool.query(\"delete from content where topic='TEST_CONTENT_TOPIC_CPD'\");

  // Content-quiz topic, 2.5hr/attempt, capped: 2 attempts different days -> only 2.5hr counted.
  await pool.query(\"insert into content (topic, category, title, body, quiz_required, hours) values ('TEST_CONTENT_TOPIC_CPD','Test','t','b',true,2.5)\");
  await pool.query(
    \`insert into results (attempt_id, outlet, name, topic, score, percentage, created_at) values
     ('CNTTEST1',\$1,\$2,'TEST_CONTENT_TOPIC_CPD','8/10','80%', date_trunc('year', now()) + interval '10 days'),
     ('CNTTEST2',\$1,\$2,'TEST_CONTENT_TOPIC_CPD','9/10','90%', now())\`,
    [OUTLET, NAME]
  );
  // Module quiz topic, flat 1hr, capped: 1 attempt -> 1hr.
  await pool.query(
    \`insert into results (attempt_id, outlet, name, topic, score, percentage, created_at) values ('STDTEST1',\$1,\$2,'TEST_MODULE_TOPIC_CPD','5/10','50%', now())\`,
    [OUTLET, NAME]
  );
  console.log('seeded');
  process.exit(0);
});
"
node -e "
import('./src/middleware/auth.js').then(async ({ issueToken }) => {
  const token = await issueToken('staff_retail', 'TESTOUTLET|TESTSTAFF');
  console.log(token);
  process.exit(0);
});
" > /tmp/staff-token.txt
TOKEN=$(cat /tmp/staff-token.txt)
curl -s http://localhost:3000/data/scoped-data -H "Authorization: Bearer $TOKEN" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const j = JSON.parse(d);
  console.log('cpdHoursThisYear:', j.cpdHoursThisYear, '(expected 3.5 = 2.5 content-quiz capped + 1 module-quiz)');
});
"
```

Expected: `cpdHoursThisYear: 3.5`.

- [ ] **Step 3: Clean up test rows**

```bash
node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  await pool.query(\"delete from results where outlet='TESTOUTLET' and name='TESTSTAFF'\");
  await pool.query(\"delete from content where topic='TEST_CONTENT_TOPIC_CPD'\");
  await pool.query(\"delete from sessions where scope_key='TESTOUTLET|TESTSTAFF'\");
  console.log('cleaned');
  process.exit(0);
});
"
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/data.js
git commit -m "Split cpdHoursThisYear() into a 3-way source calc

Adds Content quiz (real hours, capped first-attempt/topic/year)
alongside the existing Video Training (stacks) and Module Quiz
(flat, capped) sources. Module Quiz's exclusion now also excludes
Content-quiz topics to prevent double-counting."
```

---

### Task 6: Frontend — `api/client.js` new methods

**Files:**
- Modify: `lautan-academy-frontend/src/api/client.js`

**Interfaces:**
- Produces: `api.getContentQuestions(topic)`, `api.checkContentAnswer(id, chosen)`, `api.addContentQuestion(payload)`, `api.updateContentQuestion(id, payload)`, `api.deleteContentQuestion(id)`, `api.saveContentResult(payload)`. Consumed by Task 7 (`ContentReadingView.vue`, `QuizView.vue`) and Task 10 (Supervisor admin UI).

- [ ] **Step 1: Add the new methods**

In `lautan-academy-frontend/src/api/client.js`, add these lines directly after the existing `saveVideoResult`/`addVideoTraining`/`deleteVideoTraining` block (mirrors that block exactly, s/video/content):

```js
  getContentQuestions: (topic) => request(`/content-questions?topic=${encodeURIComponent(topic)}`),
  checkContentAnswer: (id, chosen) => request(`/content-questions/${id}/check`, { method: 'POST', body: JSON.stringify({ chosen }) }),
  addContentQuestion: (payload) => request('/content-questions', { method: 'POST', body: JSON.stringify(payload) }),
  updateContentQuestion: (id, payload) => request(`/content-questions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteContentQuestion: (id) => request(`/content-questions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  saveContentResult: (payload) => request('/data/content-results', { method: 'POST', body: JSON.stringify(payload) }),
```

- [ ] **Step 2: Verify the frontend still builds clean**

```bash
cd lautan-academy-frontend
npm run build
```

Expected: build succeeds, no new errors/warnings beyond the pre-existing chunk-size warning.

- [ ] **Step 3: Commit**

```bash
cd lautan-academy-frontend
git add src/api/client.js
git commit -m "Add api client methods for content_questions + content-results"
```

---

### Task 7: Frontend — `useCpdHours.js` 3-way split

**Files:**
- Modify: `lautan-academy-frontend/src/composables/useCpdHours.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: new export `contentHoursByTopic(contentEntries)` (mirrors existing `videoHoursByTopic`); `hoursByStaff()` signature gains a 4th parameter `contentHoursByTopicMap` (before the existing `year` param, keeping `year` last since callers pass it positionally with a default). Consumed by every view that renders a CPD summary (Task 8's `ResourcesView.vue` doesn't need this directly, but `QuizHistoryView.vue`, `OutletManagerResultsView.vue`, `AreaManagerDashboard.vue`, `SupervisorStaffComparisonView.vue` all call `hoursByStaff()`/`videoHoursByTopic()` already — this task updates their call sites too).

- [ ] **Step 1: Add `contentHoursByTopic` and update `hoursByStaff`**

Replace the full contents of `lautan-academy-frontend/src/composables/useCpdHours.js` with:

```js
// Pure calculation, no reactive state of its own — every call site already
// owns its own `results`/`aiResults`/`video_trainings`/`content` refs from
// the API calls it was already making. Reused identically by the Dashboard
// and all three manager-facing Staff Results pages instead of
// quadruplicating the same join+group logic. See
// docs/superpowers/specs/2026-08-12-cpd-hours-design.md,
// docs/superpowers/specs/2026-08-13-cpd-hours-revision-design.md, and
// docs/superpowers/specs/2026-08-17-content-reading-quiz-design.md.

// Flat rate for the one source with no fixed per-entry hours value to
// attach to (Module Quiz's standard_questions bank has no hours field).
// AI Practice quizzes are generated on the fly per passcode, no catalog at
// all. Video Training's and Content quiz's real per-topic rates come from
// hoursByTopic/contentHoursByTopic instead.
export const MODULE_QUIZ_HOURS = 1
export const AI_PRACTICE_HOURS = 0.25

// Global CPD target, hours/calendar-year. Was 120, lowered to 60 — single
// source of truth so a future change only touches this file. See
// docs/superpowers/specs/2026-08-17-cpd-compliance-report-design.md.
export const CPD_TARGET_HOURS = 60

// video_trainings entries -> a topic -> hours lookup, the shape
// hoursByStaff() needs to tell a Video Training results row apart from a
// Module Quiz one (same results table, only topic membership here
// distinguishes them — Video Training's and Module Quiz's topic
// namespaces never collide by design).
export function videoHoursByTopic(videoTrainings) {
  const map = new Map()
  for (const v of videoTrainings) map.set(v.topic, v.hours)
  return map
}

// content entries (quiz_required only) -> a topic -> hours lookup, same
// shape as videoHoursByTopic. Only quiz_required entries are included —
// a plain reading-only Content entry never appears in `results` at all,
// so it wouldn't matter either way, but filtering here keeps the map's
// contents self-documenting.
export function contentHoursByTopic(contentEntries) {
  const map = new Map()
  for (const c of contentEntries) {
    if (c.QuizRequired) map.set(c.Topic, c.Hours)
  }
  return map
}

// Splits a `results` array (Video Training + Module Quiz share one table)
// into the two sources by topic membership — the same check hoursByStaff()
// already does internally, exposed standalone so views can render them as
// separate sections instead of only summing them together. See
// docs/superpowers/specs/2026-08-13-results-filters-sections-design.md.
export function splitByVideoTopic(results, hoursByTopic) {
  const video = []
  const moduleQuiz = []
  for (const r of results) {
    (hoursByTopic.has(r.Topic) ? video : moduleQuiz).push(r)
  }
  return { video, moduleQuiz }
}

// results rows (Video Training + Module Quiz + Content quiz, shared
// table) + aiResults rows (AI Practice, separate table) -> per-staff
// hours-this-year, both filtered to Timestamp falling in `year` (defaults
// to the current calendar year). Precedence per results row: Video
// Training first (real hours, every attempt stacks), then Content quiz
// (real hours, capped to first attempt per topic per year), then Module
// Quiz fallback (flat rate, same cap) — matches the backend's
// not-exists/not-exists layering in data.js's cpdHoursThisYear() exactly.
// Every aiResults row counts at the flat AI Practice rate, no topic check
// needed (ai_results is exclusively AI Practice). Sorted ascending by
// hours — staff furthest behind the CPD_TARGET_HOURS target surface
// first, the actual point of a manager-facing view.
export function hoursByStaff(results, aiResults, hoursByTopic, contentHoursByTopicMap = new Map(), year = new Date().getFullYear()) {
  const byStaff = new Map()
  const countedCappedTopics = new Set() // `${name}|${outlet}|${topic}`, Content-quiz and Module-Quiz topics share this cap
  function add(name, outlet, hours) {
    const key = `${name}|${outlet}`
    if (!byStaff.has(key)) byStaff.set(key, { name, outlet, hours: 0 })
    byStaff.get(key).hours += hours
  }
  for (const r of results) {
    if (new Date(r.Timestamp).getFullYear() !== year) continue
    if (hoursByTopic.has(r.Topic)) {
      add(r.Name, r.Outlet, hoursByTopic.get(r.Topic))
      continue
    }
    const topicKey = `${r.Name}|${r.Outlet}|${r.Topic}`
    if (countedCappedTopics.has(topicKey)) continue
    countedCappedTopics.add(topicKey)
    if (contentHoursByTopicMap.has(r.Topic)) {
      add(r.Name, r.Outlet, contentHoursByTopicMap.get(r.Topic))
    } else {
      add(r.Name, r.Outlet, MODULE_QUIZ_HOURS)
    }
  }
  for (const r of aiResults) {
    if (new Date(r.Timestamp).getFullYear() !== year) continue
    add(r.Name, r.Outlet, AI_PRACTICE_HOURS)
  }
  return [...byStaff.values()].sort((a, b) => a.hours - b.hours)
}
```

- [ ] **Step 2: Update every call site to pass the new map**

There are 4 callers. Each needs the same 4 edits: import `contentHoursByTopic`, add a `contentEntries` ref, fetch `api.getContent()` alongside the existing `api.getVideoTrainings()` call, and pass `contentHoursByTopic(contentEntries.value)` into `hoursByStaff(...)` as the new 4th argument (before the existing `year`/`cpdYear.value` argument, which shifts to 5th).

**`QuizHistoryView.vue`:**

```js
// line 18 — was: import { videoHoursByTopic, hoursByStaff, splitByVideoTopic, MODULE_QUIZ_HOURS, AI_PRACTICE_HOURS, CPD_TARGET_HOURS } from '../composables/useCpdHours'
import { videoHoursByTopic, contentHoursByTopic, hoursByStaff, splitByVideoTopic, MODULE_QUIZ_HOURS, AI_PRACTICE_HOURS, CPD_TARGET_HOURS } from '../composables/useCpdHours'
```

```js
// after line 38 (`const videoTrainings = ref([])`), add:
const contentEntries = ref([])
```

```js
// lines 49-61, was:
onMounted(async () => {
  try {
    const [data, videos] = await Promise.all([
      api.getScopedData(),
      api.getVideoTrainings().catch(() => ({ videoTrainings: [] })),
    ])
    standardHistory.value = (data.results || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    aiHistory.value = (data.aiResults || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    wrongAnswers.value = data.wrongAnswers || []
    aiWrongAnswers.value = data.aiWrongAnswers || []
    reports.value = (data.reports || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    videoTrainings.value = videos.videoTrainings || []
  } catch (e) { /* leave empty — not fatal */ }
  loading.value = false

// becomes:
onMounted(async () => {
  try {
    const [data, videos, content] = await Promise.all([
      api.getScopedData(),
      api.getVideoTrainings().catch(() => ({ videoTrainings: [] })),
      api.getContent().catch(() => ({ content: [] })),
    ])
    standardHistory.value = (data.results || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    aiHistory.value = (data.aiResults || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    wrongAnswers.value = data.wrongAnswers || []
    aiWrongAnswers.value = data.aiWrongAnswers || []
    reports.value = (data.reports || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    videoTrainings.value = videos.videoTrainings || []
    contentEntries.value = content.content || []
  } catch (e) { /* leave empty — not fatal */ }
  loading.value = false
```

```js
// line 98 — was:
const cpdHoursThisYear = computed(() => hoursByStaff(standardHistory.value, aiHistory.value, videoHoursByTopic(videoTrainings.value), cpdYear.value).reduce((sum, e) => sum + e.hours, 0))
// becomes:
const cpdHoursThisYear = computed(() => hoursByStaff(standardHistory.value, aiHistory.value, videoHoursByTopic(videoTrainings.value), contentHoursByTopic(contentEntries.value), cpdYear.value).reduce((sum, e) => sum + e.hours, 0))
```

**`OutletManagerResultsView.vue`:**

```js
// line 19 — was: import { videoHoursByTopic, hoursByStaff, splitByVideoTopic, CPD_TARGET_HOURS } from '../composables/useCpdHours'
import { videoHoursByTopic, contentHoursByTopic, hoursByStaff, splitByVideoTopic, CPD_TARGET_HOURS } from '../composables/useCpdHours'
```

```js
// after line 40 (`const videoTrainings = ref([])`), add:
const contentEntries = ref([])
```

```js
// lines 107-114, was:
onMounted(async () => {
  try {
    const [data, videos] = await Promise.all([api.getScopedData(), api.getVideoTrainings()])
    standardHistory.value = (data.results || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    aiHistory.value = (data.aiResults || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    wrongAnswers.value = data.wrongAnswers || []
    aiWrongAnswers.value = data.aiWrongAnswers || []
    videoTrainings.value = videos.videoTrainings || []
  } catch (e) { /* leave empty */ }
  loading.value = false

// becomes:
onMounted(async () => {
  try {
    const [data, videos, content] = await Promise.all([api.getScopedData(), api.getVideoTrainings(), api.getContent()])
    standardHistory.value = (data.results || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    aiHistory.value = (data.aiResults || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    wrongAnswers.value = data.wrongAnswers || []
    aiWrongAnswers.value = data.aiWrongAnswers || []
    videoTrainings.value = videos.videoTrainings || []
    contentEntries.value = content.content || []
  } catch (e) { /* leave empty */ }
  loading.value = false
```

```js
// line 124 — was:
const cpdSummary = computed(() => hoursByStaff(outletScopedResults.value, outletScopedAiResults.value, videoHoursByTopic(videoTrainings.value), cpdYear.value))
// becomes:
const cpdSummary = computed(() => hoursByStaff(outletScopedResults.value, outletScopedAiResults.value, videoHoursByTopic(videoTrainings.value), contentHoursByTopic(contentEntries.value), cpdYear.value))
```

**`AreaManagerDashboard.vue`:**

```js
// line 14 — was: import { videoHoursByTopic, hoursByStaff, splitByVideoTopic, CPD_TARGET_HOURS } from '../composables/useCpdHours'
import { videoHoursByTopic, contentHoursByTopic, hoursByStaff, splitByVideoTopic, CPD_TARGET_HOURS } from '../composables/useCpdHours'
```

```js
// after line 36 (`const videoTrainings = ref([])`), add:
const contentEntries = ref([])
```

```js
// lines 67-75, was:
onMounted(async () => {
  try {
    const [scoped, videos] = await Promise.all([api.getScopedData(), api.getVideoTrainings()])
    allResults.value = (scoped.results || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    wrongAnswers.value = scoped.wrongAnswers || []
    // Real data as of Task 4's backend fix — this branch used to hardcode
    // aiResults to [].
    allAiResults.value = scoped.aiResults || []
    videoTrainings.value = videos.videoTrainings || []
  } catch (e) { /* leave empty */ }

// becomes:
onMounted(async () => {
  try {
    const [scoped, videos, content] = await Promise.all([api.getScopedData(), api.getVideoTrainings(), api.getContent()])
    allResults.value = (scoped.results || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    wrongAnswers.value = scoped.wrongAnswers || []
    // Real data as of Task 4's backend fix — this branch used to hardcode
    // aiResults to [].
    allAiResults.value = scoped.aiResults || []
    videoTrainings.value = videos.videoTrainings || []
    contentEntries.value = content.content || []
  } catch (e) { /* leave empty */ }
```

```js
// line 123 — was:
const cpdSummary = computed(() => hoursByStaff(outletScopedResults.value, outletScopedAiResults.value, videoHoursByTopic(videoTrainings.value), cpdYear.value))
// becomes:
const cpdSummary = computed(() => hoursByStaff(outletScopedResults.value, outletScopedAiResults.value, videoHoursByTopic(videoTrainings.value), contentHoursByTopic(contentEntries.value), cpdYear.value))
```

**`SupervisorStaffComparisonView.vue`:**

```js
// line 10 — was: import { videoHoursByTopic, hoursByStaff, splitByVideoTopic, CPD_TARGET_HOURS } from '../composables/useCpdHours'
import { videoHoursByTopic, contentHoursByTopic, hoursByStaff, splitByVideoTopic, CPD_TARGET_HOURS } from '../composables/useCpdHours'
```

```js
// after line 26 (`const videoTrainings = ref([])`), add:
const contentEntries = ref([])
```

```js
// lines 81-89, was:
onMounted(async () => {
  try {
    const [scoped, videos] = await Promise.all([api.getScopedData(0), api.getVideoTrainings()])
    cpdResults.value = scoped.results || []
    cpdAiResults.value = scoped.aiResults || []
    videoTrainings.value = videos.videoTrainings || []
  } catch (e) { /* leave empty */ }
  videoTrainingsLoaded.value = true
})

// becomes:
onMounted(async () => {
  try {
    const [scoped, videos, content] = await Promise.all([api.getScopedData(0), api.getVideoTrainings(), api.getContent()])
    cpdResults.value = scoped.results || []
    cpdAiResults.value = scoped.aiResults || []
    videoTrainings.value = videos.videoTrainings || []
    contentEntries.value = content.content || []
  } catch (e) { /* leave empty */ }
  videoTrainingsLoaded.value = true
})
```

```js
// line 161 — was:
const cpdSummary = computed(() => hoursByStaff(outletScoped(cpdResults.value), outletScoped(cpdAiResults.value), videoHoursByTopic(videoTrainings.value), cpdYear.value))
// becomes:
const cpdSummary = computed(() => hoursByStaff(outletScoped(cpdResults.value), outletScoped(cpdAiResults.value), videoHoursByTopic(videoTrainings.value), contentHoursByTopic(contentEntries.value), cpdYear.value))
```

Note: `contentHoursByTopic(contentEntries.value)` is a plain `Map`, not a `results`-shaped array — it does not go through `outletScoped(...)`/any scoping wrapper, only the two results/aiResults arguments do (matches how `videoHoursByTopic(videoTrainings.value)` is already unwrapped in this same call today).

- [ ] **Step 3: Verify with a standalone `node -e` mock test**

```bash
cd lautan-academy-frontend
node -e "
import('./src/composables/useCpdHours.js').then(({hoursByStaff, videoHoursByTopic, contentHoursByTopic}) => {
  const results = [
    {Name:'A',Outlet:'O1',Topic:'MOD_A',Timestamp:'2026-03-01'},
    {Name:'A',Outlet:'O1',Topic:'MOD_A',Timestamp:'2026-06-01'},
    {Name:'A',Outlet:'O1',Topic:'CNT_X',Timestamp:'2026-01-05'},
    {Name:'A',Outlet:'O1',Topic:'CNT_X',Timestamp:'2026-08-01'},
    {Name:'A',Outlet:'O1',Topic:'VID_Y',Timestamp:'2026-02-01'},
    {Name:'A',Outlet:'O1',Topic:'VID_Y',Timestamp:'2026-09-01'},
  ];
  const hoursByTopic = videoHoursByTopic([{topic:'VID_Y',hours:1.5}]);
  const cHoursByTopic = contentHoursByTopic([{Topic:'CNT_X',Hours:3,QuizRequired:true}]);
  const out = hoursByStaff(results, [], hoursByTopic, cHoursByTopic, 2026);
  console.log(JSON.stringify(out));
  console.log('PASS (expected 1+3+3=7):', out[0].hours === 7);
});
"
```

Expected: `PASS (expected 1+3+3=7): true` — MOD_A capped to 1 attempt (1hr), CNT_X capped to 1 attempt (3hr, not 6), VID_Y stacks both attempts (1.5+1.5=3hr).

- [ ] **Step 4: `npm run build` clean**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/composables/useCpdHours.js src/views/QuizHistoryView.vue src/views/OutletManagerResultsView.vue src/views/AreaManagerDashboard.vue src/views/SupervisorStaffComparisonView.vue
git commit -m "Extend useCpdHours.js for the Content-quiz CPD source

hoursByStaff() gains a 4th param (content topic->hours map), same
capped-first-attempt-per-year rule as Module Quiz but with real
per-topic rates. All 4 call sites updated to fetch Content and pass it."
```

---

### Task 8: Frontend — `ContentReadingView.vue` + `QuizView.vue` `kind: 'content'` support + router

**Files:**
- Create: `lautan-academy-frontend/src/views/ContentReadingView.vue`
- Modify: `lautan-academy-frontend/src/views/QuizView.vue`
- Modify: `lautan-academy-frontend/src/router/index.js`
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`, `lautan-academy-frontend/src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: `api.getContent()`, `api.getContentQuestions(topic)`, `api.checkContentAnswer(id, chosen)`, `api.saveContentResult(payload)` (Task 6).
- Produces: route `/content-reading/:id`, component `ContentReadingView.vue`. Consumed by Task 9 (`ResourcesView.vue`'s "Take Quiz" link).

- [ ] **Step 1: Create `ContentReadingView.vue`**

Direct copy of `ReadingView.vue`'s shape, pointed at the general `content` list instead of the pharmacist-scoped one, and its own `kind: 'content'` envelope (not `kind: 'video'`, since this feature has its own bank/endpoint — `QuizView.vue` needs to route accordingly, added in Step 2):

```vue
<script setup>
// Reading gate for a quiz_required Browse Courses Content entry — same
// "I've read this" pattern as ReadingView.vue (Pharmacist Courses), but
// against the general content table/content_questions bank instead of
// video_trainings/video_questions, and its own kind: 'content' envelope
// since grading/CPD go through their own endpoint. See
// docs/superpowers/specs/2026-08-17-content-reading-quiz-design.md.
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const entry = ref(null)
const loadError = ref('')
const starting = ref(false)

onMounted(async () => {
  try {
    const data = await api.getContent()
    entry.value = (data.content || []).find(c => String(c.ID) === route.params.id)
    if (!entry.value) {
      loadError.value = t('contentReadingView.errorNotFound')
    }
  } catch (e) {
    loadError.value = t('contentReadingView.errorNotFound')
  }
})

async function markRead() {
  starting.value = true
  loadError.value = ''
  try {
    const data = await api.getContentQuestions(entry.value.Topic)
    const questions = data.questions || []
    if (!questions.length) {
      loadError.value = t('contentReadingView.errorNoQuestions')
      return
    }
    sessionStorage.setItem('lautan_active_quiz', JSON.stringify({ kind: 'content', topic: entry.value.Topic, questions }))
    router.push('/quiz')
  } catch (e) {
    loadError.value = t('contentReadingView.errorNoQuestions')
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <h1 class="font-display text-xl font-semibold text-white">{{ entry?.Title || t('contentReadingView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <p v-if="loadError" class="text-coral text-sm mb-4">{{ loadError }}</p>
      <div v-if="entry" class="bg-white rounded-xl2 p-5 shadow-sm">
        <p class="text-slate text-xs mb-3">{{ entry.Topic }} · {{ t('contentReadingView.cpdHourValue', { hours: entry.Hours }, entry.Hours) }}</p>
        <p class="text-sm text-ink whitespace-pre-wrap">{{ entry.Body }}</p>
        <button
          type="button"
          @click="markRead"
          :disabled="starting"
          class="mt-5 bg-aqua text-white font-medium px-5 py-2.5 rounded-lg disabled:opacity-60"
        >
          {{ starting ? t('contentReadingView.starting') : t('contentReadingView.markRead') }}
        </button>
      </div>
    </main>
  </div>
</template>
```

- [ ] **Step 2: Extend `QuizView.vue` for `kind: 'content'`**

In `lautan-academy-frontend/src/views/QuizView.vue`:

Update the `kind` comment and the 3 branch points. First, the top-of-file comment/const:

```js
const kind = stored?.kind || 'ai' // 'standard' (Module Quiz) | 'video' (Video Training/Pharmacist Courses) | 'content' (Browse Courses reading quiz) | 'ai' (Practice)
```

In `selectAnswer()`, add a branch:

```js
    let result
    if (kind === 'standard') result = await api.checkStandardAnswer(currentQuestion.value.id, optIndex)
    else if (kind === 'video') result = await api.checkVideoAnswer(currentQuestion.value.id, optIndex)
    else if (kind === 'content') result = await api.checkContentAnswer(currentQuestion.value.id, optIndex)
    else result = await api.checkAiAnswer(auth.staff.outlet, passcode, answeredIndex, optIndex)
```

In `gradeAndSave()`, add a branch:

```js
  if (kind === 'standard') return api.saveResult({ name: auth.staff.name, outlet: auth.staff.outlet, topic, answers: payloadAnswers })
  if (kind === 'video') return api.saveVideoResult({ name: auth.staff.name, outlet: auth.staff.outlet, topic, answers: payloadAnswers })
  if (kind === 'content') return api.saveContentResult({ name: auth.staff.name, outlet: auth.staff.outlet, topic, answers: payloadAnswers })
  return api.saveAiResult({ attemptId: 'AI' + Date.now(), name: auth.staff.name, outlet: auth.staff.outlet, topic, passcode, answers: payloadAnswers })
```

Extend the anti-fraud/Back-lock kind arrays in 3 places — `onBeforeRouteLeave`, `handlePageHide`, and the template's Back button `:disabled` — from `['standard', 'video']` to `['standard', 'video', 'content']`. This is a real behavior addition (Content-quiz attempts now get the same abandon-lock and Back-lock as Module Quiz/Video Training, since they're real assessed CPD-earning attempts, not casual AI Practice):

```js
onBeforeRouteLeave(async (to, from, next) => {
  if (!['standard', 'video', 'content'].includes(kind) || answeredCount.value === 0 || hasSubmitted.value) {
```

```js
function handlePageHide() {
  if (!['standard', 'video', 'content'].includes(kind) || answeredCount.value === 0 || hasSubmitted.value) return
```

```html
        <button
          @click="back"
          :disabled="currentIndex === 0 || (['standard', 'video', 'content'].includes(kind) && answeredCount >= 1)"
```

- [ ] **Step 3: Add the route**

In `lautan-academy-frontend/src/router/index.js`, add the import near the existing `ReadingView` import:

```js
import ContentReadingView from '../views/ContentReadingView.vue'
```

And add the route directly after the existing `/reading-view/:id` route:

```js
    { path: '/content-reading/:id', name: 'content-reading', component: ContentReadingView, meta: { requiresAuth: true, role: 'staff', division: 'retail' } },
```

- [ ] **Step 4: Add EN/MS strings**

In `lautan-academy-frontend/src/i18n/locales/en.json`, add a new top-level key directly after the existing `"readingView"` block:

```json
  "contentReadingView": {
    "title": "Course Material",
    "markRead": "I've read this — start the quiz",
    "starting": "Loading quiz...",
    "errorNotFound": "This material could not be found.",
    "errorNoQuestions": "Couldn't load the quiz for this material — refresh and try again.",
    "cpdHourValue": "{hours} CPD hour | {hours} CPD hours"
  },
```

In `lautan-academy-frontend/src/i18n/locales/ms.json`, add the matching block in the same position:

```json
  "contentReadingView": {
    "title": "Bahan Kursus",
    "markRead": "Saya sudah baca — mula kuiz",
    "starting": "Memuatkan kuiz...",
    "errorNotFound": "Bahan ini tidak dijumpai.",
    "errorNoQuestions": "Gagal memuatkan kuiz untuk bahan ini — muat semula dan cuba lagi.",
    "cpdHourValue": "{hours} jam CPD"
  },
```

- [ ] **Step 5: `npm run build` and EN/MS key-parity check**

```bash
cd lautan-academy-frontend
npm run build
node -e "
const en = require('./src/i18n/locales/en.json');
const ms = require('./src/i18n/locales/ms.json');
function keys(o, p=''){let r=[];for(const k in o){const v=o[k];const kp=p?p+'.'+k:k;if(v&&typeof v==='object')r=r.concat(keys(v,kp));else r.push(kp);}return r;}
const ek=new Set(keys(en)), mk=new Set(keys(ms));
console.log('missing in MS:', [...ek].filter(k=>!mk.has(k)));
console.log('missing in EN:', [...mk].filter(k=>!ek.has(k)));
"
```

Expected: build clean; both missing-key lists empty.

- [ ] **Step 6: Commit**

```bash
git add src/views/ContentReadingView.vue src/views/QuizView.vue src/router/index.js src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "Add ContentReadingView + QuizView kind:'content' support

New reading gate for quiz_required Content entries, mirrors
ReadingView.vue. QuizView.vue routes kind:'content' to the new
content-questions/content-results endpoints and gets the same
abandon-lock/Back-lock as Module Quiz and Video Training."
```

---

### Task 9: Frontend — `ResourcesView.vue` retail-staff "Take Quiz" action

**Files:**
- Modify: `lautan-academy-frontend/src/views/ResourcesView.vue`
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`, `lautan-academy-frontend/src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: `entry.QuizRequired`/`entry.QuizReady` fields on Content entries (Task 2), `auth.staff?.division`/`auth.isStaff` (existing store).
- Produces: no new exports — pure template/computed change.

- [ ] **Step 1: Extend the `allEntries` mapping and add a retail-staff gate**

In `lautan-academy-frontend/src/views/ResourcesView.vue`, extend the `knowledgeEntries.value.map(...)` inside `allEntries` to carry the new fields through:

```js
  ...knowledgeEntries.value.map(c => ({
    id: 'content-' + c.ID, name: c.Title, category: c.Category, subcategory: c.Topic,
    kind: 'Article', link: c.Link, body: c.Body, isContent: true,
    quizRequired: c.QuizRequired, quizReady: c.QuizReady, contentId: c.ID,
  })),
```

Add a new computed near `canCreateQuiz`:

```js
// Retail-only, matches Module Quiz/Video Training's existing gate —
// warehouse staff and every manager tier see quiz_required entries
// exactly as any other Content entry (see
// docs/superpowers/specs/2026-08-17-content-reading-quiz-design.md).
const canTakeContentQuiz = computed(() => auth.isStaff && auth.staff?.division === 'retail')
```

- [ ] **Step 2: Add the "Take Quiz" action in the template**

In the `<details v-else ...>` block (the Knowledge-entry branch), add a "Take Quiz" link right after the existing "Create Quiz From This" `RouterLink`, only for retail staff on a ready quiz-required entry:

```html
                <RouterLink v-if="canCreateQuiz" :to="{ path: createQuizPath, query: { topic: e.subcategory } }" class="text-xs text-white font-medium bg-aqua rounded-full px-3 py-1">
                  {{ t('resourcesView.createQuizFromThis') }}
                </RouterLink>
                <RouterLink v-if="canTakeContentQuiz && e.quizRequired && e.quizReady" :to="`/content-reading/${e.contentId}`" class="text-xs text-white font-medium bg-coral rounded-full px-3 py-1">
                  {{ t('resourcesView.takeQuiz') }}
                </RouterLink>
```

- [ ] **Step 3: Add EN/MS strings**

In `en.json`'s existing `"resourcesView"` block, add one key:

```json
  "resourcesView": {
    "title": "Browse Courses",
    "loading": "Loading...",
    "noMaterial": "No course material added yet.",
    "allCategories": "All categories",
    "allTopics": "All topics",
    "createQuiz": "Create Quiz",
    "createQuizFromThis": "Create Quiz from this",
    "openAttachedLink": "Open attached link",
    "takeQuiz": "Take Quiz"
  },
```

In `ms.json`'s matching `"resourcesView"` block, add the same key with a Malay value (find the existing block and add):

```json
    "takeQuiz": "Ambil Kuiz"
```

- [ ] **Step 4: `npm run build` and EN/MS key-parity check**

```bash
cd lautan-academy-frontend
npm run build
node -e "
const en = require('./src/i18n/locales/en.json');
const ms = require('./src/i18n/locales/ms.json');
function keys(o, p=''){let r=[];for(const k in o){const v=o[k];const kp=p?p+'.'+k:k;if(v&&typeof v==='object')r=r.concat(keys(v,kp));else r.push(kp);}return r;}
const ek=new Set(keys(en)), mk=new Set(keys(ms));
console.log('missing in MS:', [...ek].filter(k=>!mk.has(k)));
console.log('missing in EN:', [...mk].filter(k=>!ek.has(k)));
"
```

Expected: build clean; both lists empty.

- [ ] **Step 5: Commit**

```bash
git add src/views/ResourcesView.vue src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "Add retail-staff Take Quiz action for quiz_required Content

Only shown to retail staff, only when the entry's question bank is
ready (QuizReady). Warehouse staff and managers unaffected — same
inline expand as before."
```

---

### Task 10: Frontend — Supervisor authoring: quiz-required toggle on Content form

**Files:**
- Modify: `lautan-academy-frontend/src/views/SupervisorAddResourcesView.vue`
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`, `lautan-academy-frontend/src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: `api.addContent(payload)` (existing, already forwards arbitrary payload fields).
- Produces: no new exports.

- [ ] **Step 1: Add the new refs**

In `lautan-academy-frontend/src/views/SupervisorAddResourcesView.vue`, add two new refs directly after the existing `const cLink = ref('')`:

```js
const cQuizRequired = ref(false)
const cHours = ref('1')
```

- [ ] **Step 2: Include the new fields in `addContent()` and reset them after save**

Update the `addContent()` function:

```js
async function addContent() {
  cError.value = ''
  if (!cTopic.value.trim() || !cCategory.value.trim() || !cTitle.value.trim() || !cBody.value.trim()) {
    cError.value = t('supervisorAddResourcesView.errorRequiredFields')
    return
  }
  if (cQuizRequired.value && (!Number.isFinite(Number(cHours.value)) || Number(cHours.value) <= 0)) {
    cError.value = t('supervisorAddResourcesView.errorHoursInvalid')
    return
  }
  cSaving.value = true
  try {
    await api.addContent({
      topic: cTopic.value.trim(), category: cCategory.value, title: cTitle.value.trim(), body: cBody.value.trim(), link: cLink.value.trim(),
      quizRequired: cQuizRequired.value, hours: cQuizRequired.value ? Number(cHours.value) : undefined,
    })
    cTopic.value = ''
    cTitle.value = ''
    cBody.value = ''
    cLink.value = ''
    cUploadedName.value = ''
    cQuizRequired.value = false
    cHours.value = '1'
    if (cFileInput.value) cFileInput.value.value = ''
    await loadContent()
  } catch (err) {
    cError.value = err.message || t('supervisorAddResourcesView.errorSaveFailed')
  } finally {
    cSaving.value = false
  }
}
```

- [ ] **Step 3: Add the form fields and list badge**

In the template, add a checkbox + conditional hours field directly before the existing `<p v-if="cError" ...>` line inside the Content `<form>`:

```html
        <div>
          <label class="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" v-model="cQuizRequired" />
            {{ t('supervisorAddResourcesView.quizRequiredLabel') }}
          </label>
          <div v-if="cQuizRequired" class="mt-2">
            <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorAddResourcesView.hoursLabel') }}</label>
            <input v-model="cHours" type="number" min="0.5" step="0.5" class="w-32 border border-slate/30 rounded-lg py-2 px-3" />
          </div>
        </div>
```

And show a badge in the existing Content list item, mirroring the video list's `pharmacistOnly` badge pattern:

```html
        <div v-for="item in paginatedContent" :key="item.ID" class="px-5 py-3 flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-medium text-ink truncate">
              {{ item.Title }}
              <span v-if="item.QuizRequired" class="ml-1 text-[10px] font-semibold uppercase tracking-wide text-aqua">{{ t('supervisorAddResourcesView.quizRequiredBadge') }}</span>
            </p>
            <p class="text-xs text-slate">{{ item.Topic }} · {{ item.Category }}{{ item.QuizRequired ? ' · ' + t('supervisorAddResourcesView.contentHoursValue', { hours: item.Hours }) : '' }}</p>
          </div>
          <button @click="removeContent(item)" class="text-coral text-xs font-medium underline shrink-0">{{ t('supervisorAddResourcesView.remove') }}</button>
        </div>
```

- [ ] **Step 4: Add EN/MS strings**

In `en.json`'s `"supervisorAddResourcesView"` block, add:

```json
    "quizRequiredLabel": "Quiz required (staff must pass a quiz to earn CPD hours for this)",
    "hoursLabel": "CPD Hours",
    "quizRequiredBadge": "QUIZ REQUIRED",
    "contentHoursValue": "{hours} CPD hour",
    "errorHoursInvalid": "Hours must be a positive number."
```

In `ms.json`'s matching block, add:

```json
    "quizRequiredLabel": "Kuiz diperlukan (staf perlu lulus kuiz untuk peroleh jam CPD)",
    "hoursLabel": "Jam CPD",
    "quizRequiredBadge": "KUIZ DIPERLUKAN",
    "contentHoursValue": "{hours} jam CPD",
    "errorHoursInvalid": "Jam mesti nombor positif."
```

- [ ] **Step 5: `npm run build` and EN/MS key-parity check**

```bash
cd lautan-academy-frontend
npm run build
node -e "
const en = require('./src/i18n/locales/en.json');
const ms = require('./src/i18n/locales/ms.json');
function keys(o, p=''){let r=[];for(const k in o){const v=o[k];const kp=p?p+'.'+k:k;if(v&&typeof v==='object')r=r.concat(keys(v,kp));else r.push(kp);}return r;}
const ek=new Set(keys(en)), mk=new Set(keys(ms));
console.log('missing in MS:', [...ek].filter(k=>!mk.has(k)));
console.log('missing in EN:', [...mk].filter(k=>!ek.has(k)));
"
```

Expected: build clean; both lists empty.

- [ ] **Step 6: Commit**

```bash
git add src/views/SupervisorAddResourcesView.vue src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "Add quiz-required toggle + hours field to Supervisor Content form"
```

---

### Task 11: Frontend — `SupervisorManageContentQuizQuestionsView.vue` + nav

**Files:**
- Create: `lautan-academy-frontend/src/views/SupervisorManageContentQuizQuestionsView.vue`
- Modify: `lautan-academy-frontend/src/router/index.js`
- Modify: `lautan-academy-frontend/src/components/AppSidebar.vue`
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`, `lautan-academy-frontend/src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: `api.getContent()`, `api.getContentQuestions(topic)`, `api.addContentQuestion(payload)`, `api.updateContentQuestion(id, payload)`, `api.deleteContentQuestion(id)` (Task 6).
- Produces: route `/supervisor/manage-content-quiz`, new nav item. Terminal task — nothing later consumes this.

- [ ] **Step 1: Create the new view**

Direct copy of `SupervisorManageQuizQuestionsView.vue`, pointed at `content`/`content_questions` instead of `video_trainings`/`video_questions` (topics sourced from `quiz_required` Content entries only, single source — no pharmacist-course-style second fetch needed):

```vue
<script setup>
// Supervisor-only CRUD over content_questions (the quiz bank behind
// Browse Courses' quiz_required reading entries). Direct copy of
// SupervisorManageQuizQuestionsView.vue's shape — topic is picked from a
// dropdown of real quiz_required content topics, not free text;
// content_questions.topic is a plain string match with no FK, a typo
// would silently orphan the question. See
// docs/superpowers/specs/2026-08-17-content-reading-quiz-design.md.
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { usePagination } from '../composables/usePagination'
import Pagination from '../components/Pagination.vue'

const { t } = useI18n()

const topics = ref([])
const loadingTopics = ref(true)
const selectedTopic = ref('')

const questions = ref([])
const loadingQuestions = ref(false)
const { currentPage, totalPages, paginatedItems: paginatedQuestions, next, prev } = usePagination(questions)

const editingId = ref(null) // null = add mode, otherwise the id being edited
const qType = ref('mcq') // 'mcq' | 'tf'
const qQuestionEn = ref('')
const qQuestionMs = ref('')
const qOpt1En = ref('')
const qOpt2En = ref('')
const qOpt3En = ref('')
const qOpt4En = ref('')
const qOpt1Ms = ref('')
const qOpt2Ms = ref('')
const qOpt3Ms = ref('')
const qOpt4Ms = ref('')
const qCorrect = ref(0)
const qError = ref('')
const qSaving = ref(false)

async function loadTopics() {
  loadingTopics.value = true
  try {
    const data = await api.getContent()
    topics.value = [...new Set((data.content || []).filter(c => c.QuizRequired).map(c => c.Topic))].filter(Boolean).sort()
  } catch (e) {
    topics.value = []
  }
  loadingTopics.value = false
}
loadTopics()

async function loadQuestions() {
  if (!selectedTopic.value) {
    questions.value = []
    return
  }
  loadingQuestions.value = true
  try {
    const data = await api.getContentQuestions(selectedTopic.value)
    questions.value = data.questions || []
  } catch (e) {
    questions.value = []
  }
  loadingQuestions.value = false
}
watch(selectedTopic, loadQuestions)

function resetForm() {
  editingId.value = null
  qType.value = 'mcq'
  qQuestionEn.value = ''
  qQuestionMs.value = ''
  qOpt1En.value = ''
  qOpt2En.value = ''
  qOpt3En.value = ''
  qOpt4En.value = ''
  qOpt1Ms.value = ''
  qOpt2Ms.value = ''
  qOpt3Ms.value = ''
  qOpt4Ms.value = ''
  qCorrect.value = 0
  qError.value = ''
}

function startEdit(q) {
  editingId.value = q.id
  qType.value = q.opt3_en === '' && q.opt4_en === '' ? 'tf' : 'mcq'
  qQuestionEn.value = q.question_en
  qQuestionMs.value = q.question_ms
  qOpt1En.value = q.opt1_en || ''
  qOpt2En.value = q.opt2_en || ''
  qOpt3En.value = q.opt3_en || ''
  qOpt4En.value = q.opt4_en || ''
  qOpt1Ms.value = q.opt1_ms || ''
  qOpt2Ms.value = q.opt2_ms || ''
  qOpt3Ms.value = q.opt3_ms || ''
  qOpt4Ms.value = q.opt4_ms || ''
  qCorrect.value = 0 // backend never sends `correct` in the list response; Supervisor re-picks it when editing
  qError.value = ''
}

function buildPayload() {
  return {
    type: qType.value,
    topic: selectedTopic.value,
    question_en: qQuestionEn.value.trim(),
    question_ms: qQuestionMs.value.trim(),
    opt1_en: qOpt1En.value.trim(),
    opt2_en: qOpt2En.value.trim(),
    opt3_en: qType.value === 'mcq' ? qOpt3En.value.trim() : '',
    opt4_en: qType.value === 'mcq' ? qOpt4En.value.trim() : '',
    opt1_ms: qOpt1Ms.value.trim(),
    opt2_ms: qOpt2Ms.value.trim(),
    opt3_ms: qType.value === 'mcq' ? qOpt3Ms.value.trim() : '',
    opt4_ms: qType.value === 'mcq' ? qOpt4Ms.value.trim() : '',
    correct: qCorrect.value,
  }
}

async function saveQuestion() {
  qError.value = ''
  qSaving.value = true
  try {
    const payload = buildPayload()
    if (editingId.value) {
      await api.updateContentQuestion(editingId.value, payload)
    } else {
      await api.addContentQuestion(payload)
    }
    resetForm()
    await loadQuestions()
  } catch (err) {
    qError.value = err.message || t('supervisorManageContentQuizQuestionsView.errorSaveFailed')
  } finally {
    qSaving.value = false
  }
}

const deleteError = ref('')
async function removeQuestion(q) {
  deleteError.value = ''
  if (!confirm(t('supervisorManageContentQuizQuestionsView.confirmRemove'))) return
  try {
    await api.deleteContentQuestion(q.id)
    if (editingId.value === q.id) resetForm()
    await loadQuestions()
  } catch (err) {
    deleteError.value = err.message || t('supervisorManageContentQuizQuestionsView.errorDeleteFailed')
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ t('sidebar.roleSupervisor') }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('supervisorManageContentQuizQuestionsView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div class="mb-4">
        <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorManageContentQuizQuestionsView.topicLabel') }}</label>
        <div v-if="loadingTopics" class="text-slate text-sm">{{ t('supervisorManageContentQuizQuestionsView.loading') }}</div>
        <select v-else v-model="selectedTopic" class="w-full border border-slate/30 rounded-lg py-2 px-3 bg-white">
          <option value="">{{ t('supervisorManageContentQuizQuestionsView.topicPlaceholder') }}</option>
          <option v-for="topic in topics" :key="topic" :value="topic">{{ topic }}</option>
        </select>
        <p v-if="!loadingTopics && topics.length === 0" class="text-xs text-slate mt-1">{{ t('supervisorManageContentQuizQuestionsView.noTopicsYet') }}</p>
      </div>

      <template v-if="selectedTopic">
        <p v-if="deleteError" class="text-coral text-sm mb-2">{{ deleteError }}</p>

        <div v-if="loadingQuestions" class="text-slate text-sm">{{ t('supervisorManageContentQuizQuestionsView.loading') }}</div>
        <div v-else-if="questions.length === 0" class="text-slate text-sm mb-4">{{ t('supervisorManageContentQuizQuestionsView.noQuestionsYet') }}</div>
        <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam mb-4">
          <div v-for="q in paginatedQuestions" :key="q.id" class="px-5 py-3 flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-ink truncate">{{ q.question_en }}</p>
              <p class="text-xs text-slate">{{ q.opt3_en === '' ? t('supervisorManageContentQuizQuestionsView.typeTrueFalse') : t('supervisorManageContentQuizQuestionsView.typeMcq') }}</p>
            </div>
            <div class="flex gap-3 shrink-0">
              <button @click="startEdit(q)" class="text-aqua text-xs font-medium underline">{{ t('supervisorManageContentQuizQuestionsView.edit') }}</button>
              <button @click="removeQuestion(q)" class="text-coral text-xs font-medium underline">{{ t('supervisorManageContentQuizQuestionsView.remove') }}</button>
            </div>
          </div>
          <Pagination :current-page="currentPage" :total-pages="totalPages" @prev="prev" @next="next" />
        </div>

        <form @submit.prevent="saveQuestion" class="bg-white rounded-xl2 p-5 shadow-sm space-y-3">
          <h2 class="font-display text-base font-semibold text-ink">
            {{ editingId ? t('supervisorManageContentQuizQuestionsView.editingHeading') : t('supervisorManageContentQuizQuestionsView.addingHeading') }}
          </h2>
          <div>
            <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorManageContentQuizQuestionsView.typeLabel') }}</label>
            <select v-model="qType" class="w-full border border-slate/30 rounded-lg py-2 px-3">
              <option value="mcq">{{ t('supervisorManageContentQuizQuestionsView.typeMcq') }}</option>
              <option value="tf">{{ t('supervisorManageContentQuizQuestionsView.typeTrueFalse') }}</option>
            </select>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorManageContentQuizQuestionsView.questionEnLabel') }}</label>
              <textarea v-model="qQuestionEn" rows="2" class="w-full border border-slate/30 rounded-lg py-2 px-3"></textarea>
            </div>
            <div>
              <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorManageContentQuizQuestionsView.questionMsLabel') }}</label>
              <textarea v-model="qQuestionMs" rows="2" class="w-full border border-slate/30 rounded-lg py-2 px-3"></textarea>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="flex items-center gap-2 text-sm text-ink mb-1">
                <input type="radio" :value="0" v-model="qCorrect" /> {{ t('supervisorManageContentQuizQuestionsView.opt1EnLabel') }}
              </label>
              <input v-model="qOpt1En" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
            </div>
            <div>
              <label class="block text-sm text-ink mb-1">{{ t('supervisorManageContentQuizQuestionsView.opt1MsLabel') }}</label>
              <input v-model="qOpt1Ms" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
            </div>
            <div>
              <label class="flex items-center gap-2 text-sm text-ink mb-1">
                <input type="radio" :value="1" v-model="qCorrect" /> {{ t('supervisorManageContentQuizQuestionsView.opt2EnLabel') }}
              </label>
              <input v-model="qOpt2En" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
            </div>
            <div>
              <label class="block text-sm text-ink mb-1">{{ t('supervisorManageContentQuizQuestionsView.opt2MsLabel') }}</label>
              <input v-model="qOpt2Ms" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
            </div>
            <template v-if="qType === 'mcq'">
              <div>
                <label class="flex items-center gap-2 text-sm text-ink mb-1">
                  <input type="radio" :value="2" v-model="qCorrect" /> {{ t('supervisorManageContentQuizQuestionsView.opt3EnLabel') }}
                </label>
                <input v-model="qOpt3En" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
              </div>
              <div>
                <label class="block text-sm text-ink mb-1">{{ t('supervisorManageContentQuizQuestionsView.opt3MsLabel') }}</label>
                <input v-model="qOpt3Ms" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
              </div>
              <div>
                <label class="flex items-center gap-2 text-sm text-ink mb-1">
                  <input type="radio" :value="3" v-model="qCorrect" /> {{ t('supervisorManageContentQuizQuestionsView.opt4EnLabel') }}
                </label>
                <input v-model="qOpt4En" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
              </div>
              <div>
                <label class="block text-sm text-ink mb-1">{{ t('supervisorManageContentQuizQuestionsView.opt4MsLabel') }}</label>
                <input v-model="qOpt4Ms" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
              </div>
            </template>
          </div>

          <p v-if="qError" class="text-coral text-sm">{{ qError }}</p>
          <div class="flex gap-2">
            <button type="submit" :disabled="qSaving" class="bg-aqua text-white font-medium px-5 py-2.5 rounded-lg disabled:opacity-60">
              {{ qSaving ? t('supervisorManageContentQuizQuestionsView.saving') : (editingId ? t('supervisorManageContentQuizQuestionsView.saveChanges') : t('supervisorManageContentQuizQuestionsView.addQuestion')) }}
            </button>
            <button v-if="editingId" type="button" @click="resetForm" class="text-slate text-sm font-medium px-3">
              {{ t('supervisorManageContentQuizQuestionsView.cancelEdit') }}
            </button>
          </div>
        </form>
      </template>
    </main>
  </div>
</template>
```

- [ ] **Step 2: Add the route**

In `lautan-academy-frontend/src/router/index.js`, add the import near `SupervisorManageQuizQuestionsView`:

```js
import SupervisorManageContentQuizQuestionsView from '../views/SupervisorManageContentQuizQuestionsView.vue'
```

And add the route directly after the existing `supervisor-manage-quiz-questions` route:

```js
    { path: '/supervisor/manage-content-quiz', name: 'supervisor-manage-content-quiz', component: SupervisorManageContentQuizQuestionsView, meta: { requiresAuth: true, role: 'manager', managerRole: 'supervisor' } },
```

- [ ] **Step 3: Add the nav item**

In `lautan-academy-frontend/src/components/AppSidebar.vue`, add a new item directly after the existing `manageQuizQuestions` entry:

```js
        { label: t('sidebar.manageQuizQuestions'), to: '/supervisor/manage-quiz-questions', icon: 'clipboard' },
        { label: t('sidebar.manageContentQuiz'), to: '/supervisor/manage-content-quiz', icon: 'clipboard' },
```

- [ ] **Step 4: Add EN/MS strings**

In `en.json`, add `"sidebar.manageContentQuiz"` inside the existing `"sidebar"` block (find `"manageQuizQuestions"` and add a sibling key):

```json
    "manageContentQuiz": "Manage Content Quiz"
```

And a new top-level block directly after the existing `"supervisorManageQuizQuestionsView"` block:

```json
  "supervisorManageContentQuizQuestionsView": {
    "title": "Manage Content Quiz",
    "topicLabel": "Topic",
    "loading": "Loading...",
    "topicPlaceholder": "Select a topic",
    "noTopicsYet": "No quiz-required content entries yet — mark one from Add Resources first.",
    "noQuestionsYet": "No questions yet for this topic.",
    "typeMcq": "Multiple Choice",
    "typeTrueFalse": "True / False",
    "edit": "Edit",
    "remove": "Remove",
    "editingHeading": "Edit Question",
    "addingHeading": "Add Question",
    "typeLabel": "Type",
    "questionEnLabel": "Question (English)",
    "questionMsLabel": "Question (Bahasa Malaysia)",
    "opt1EnLabel": "Option 1 (English)",
    "opt1MsLabel": "Option 1 (Bahasa Malaysia)",
    "opt2EnLabel": "Option 2 (English)",
    "opt2MsLabel": "Option 2 (Bahasa Malaysia)",
    "opt3EnLabel": "Option 3 (English)",
    "opt3MsLabel": "Option 3 (Bahasa Malaysia)",
    "opt4EnLabel": "Option 4 (English)",
    "opt4MsLabel": "Option 4 (Bahasa Malaysia)",
    "saving": "Saving...",
    "saveChanges": "Save Changes",
    "addQuestion": "Add Question",
    "cancelEdit": "Cancel",
    "confirmRemove": "Remove this question?",
    "errorSaveFailed": "Could not save this question. Check your connection and try again.",
    "errorDeleteFailed": "Could not delete this question. Check your connection and try again."
  },
```

In `ms.json`, add `"sidebar.manageContentQuiz"`:

```json
    "manageContentQuiz": "Urus Kuiz Kandungan"
```

And the matching block:

```json
  "supervisorManageContentQuizQuestionsView": {
    "title": "Urus Kuiz Kandungan",
    "topicLabel": "Topik",
    "loading": "Memuatkan...",
    "topicPlaceholder": "Pilih topik",
    "noTopicsYet": "Belum ada entri kandungan yang memerlukan kuiz — tandakan satu dari Tambah Sumber dahulu.",
    "noQuestionsYet": "Belum ada soalan untuk topik ini.",
    "typeMcq": "Pelbagai Pilihan",
    "typeTrueFalse": "Betul / Salah",
    "edit": "Edit",
    "remove": "Buang",
    "editingHeading": "Edit Soalan",
    "addingHeading": "Tambah Soalan",
    "typeLabel": "Jenis",
    "questionEnLabel": "Soalan (Bahasa Inggeris)",
    "questionMsLabel": "Soalan (Bahasa Malaysia)",
    "opt1EnLabel": "Pilihan 1 (Bahasa Inggeris)",
    "opt1MsLabel": "Pilihan 1 (Bahasa Malaysia)",
    "opt2EnLabel": "Pilihan 2 (Bahasa Inggeris)",
    "opt2MsLabel": "Pilihan 2 (Bahasa Malaysia)",
    "opt3EnLabel": "Pilihan 3 (Bahasa Inggeris)",
    "opt3MsLabel": "Pilihan 3 (Bahasa Malaysia)",
    "opt4EnLabel": "Pilihan 4 (Bahasa Inggeris)",
    "opt4MsLabel": "Pilihan 4 (Bahasa Malaysia)",
    "saving": "Menyimpan...",
    "saveChanges": "Simpan Perubahan",
    "addQuestion": "Tambah Soalan",
    "cancelEdit": "Batal",
    "confirmRemove": "Buang soalan ini?",
    "errorSaveFailed": "Gagal menyimpan soalan ini. Semak sambungan anda dan cuba lagi.",
    "errorDeleteFailed": "Gagal memadam soalan ini. Semak sambungan anda dan cuba lagi."
  },
```

- [ ] **Step 5: `npm run build` and EN/MS key-parity check**

```bash
cd lautan-academy-frontend
npm run build
node -e "
const en = require('./src/i18n/locales/en.json');
const ms = require('./src/i18n/locales/ms.json');
function keys(o, p=''){let r=[];for(const k in o){const v=o[k];const kp=p?p+'.'+k:k;if(v&&typeof v==='object')r=r.concat(keys(v,kp));else r.push(kp);}return r;}
const ek=new Set(keys(en)), mk=new Set(keys(ms));
console.log('missing in MS:', [...ek].filter(k=>!mk.has(k)));
console.log('missing in EN:', [...mk].filter(k=>!ek.has(k)));
"
```

Expected: build clean; both lists empty.

- [ ] **Step 6: Commit**

```bash
git add src/views/SupervisorManageContentQuizQuestionsView.vue src/router/index.js src/components/AppSidebar.vue src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "Add Supervisor content-quiz question management UI + nav

Direct copy of SupervisorManageQuizQuestionsView.vue, pointed at
content_questions. Topic dropdown sourced from quiz_required content
entries only."
```

---

### Task 12: Full end-to-end verification

**Files:** none (verification-only task, no code changes).

**Interfaces:** none.

- [ ] **Step 1: Full live flow via curl + disposable data, both repos' dev servers running**

```bash
cd lautan-academy-backend

# Supervisor: create a quiz-required content entry + 2 questions
node -e "
import('./src/middleware/auth.js').then(async ({ issueToken }) => {
  console.log(await issueToken('supervisor', 'ALL'));
  process.exit(0);
});
" > /tmp/sup-token.txt
SUP=$(cat /tmp/sup-token.txt)

curl -s -X POST http://localhost:3000/content -H "Authorization: Bearer $SUP" -H "Content-Type: application/json" \
  -d '{"topic":"E2E_TOPIC","category":"Test","title":"E2E Entry","body":"Read me","quizRequired":true,"hours":4}'
echo
curl -s -X POST http://localhost:3000/content-questions -H "Authorization: Bearer $SUP" -H "Content-Type: application/json" \
  -d '{"topic":"E2E_TOPIC","type":"mcq","question_en":"Q1?","question_ms":"S1?","opt1_en":"A","opt2_en":"B","opt3_en":"C","opt4_en":"D","opt1_ms":"A","opt2_ms":"B","opt3_ms":"C","opt4_ms":"D","correct":2}'
echo

# Confirm QuizReady flipped true
curl -s http://localhost:3000/content -H "Authorization: Bearer $SUP" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  console.log(JSON.parse(d).content.find(c=>c.Topic==='E2E_TOPIC'));
});
"

# Retail staff: fetch questions, submit correct answer
node -e "
import('./src/middleware/auth.js').then(async ({ issueToken }) => {
  console.log(await issueToken('staff_retail', 'TESTOUTLET|TESTSTAFF'));
  process.exit(0);
});
" > /tmp/staff-token.txt
STAFF=$(cat /tmp/staff-token.txt)

QID=$(curl -s "http://localhost:3000/content-questions?topic=E2E_TOPIC" -H "Authorization: Bearer $STAFF" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).questions[0].id));")
curl -s -X POST http://localhost:3000/data/content-results -H "Authorization: Bearer $STAFF" -H "Content-Type: application/json" \
  -d "{\"name\":\"TESTSTAFF\",\"outlet\":\"TESTOUTLET\",\"topic\":\"E2E_TOPIC\",\"answers\":[{\"id\":$QID,\"chosen\":2}]}"
echo

# Confirm CPD credited (should be 4, the entry's real hours)
curl -s http://localhost:3000/data/scoped-data -H "Authorization: Bearer $STAFF" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  console.log('cpdHoursThisYear:', JSON.parse(d).cpdHoursThisYear, '(expected 4)');
});
"

# Warehouse staff -> 403 on content-results (retail-only)
node -e "
import('./src/middleware/auth.js').then(async ({ issueToken }) => {
  console.log(await issueToken('staff_warehouse', 'TESTOUTLET|TESTWHSTAFF'));
  process.exit(0);
});
" > /tmp/wh-token.txt
WH=$(cat /tmp/wh-token.txt)
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/data/content-results -H "Authorization: Bearer $WH" -H "Content-Type: application/json" \
  -d "{\"name\":\"TESTWHSTAFF\",\"outlet\":\"TESTOUTLET\",\"topic\":\"E2E_TOPIC\",\"answers\":[]}"
```

Expected: entry created; question created; `QuizReady: true`; content-results returns `{"status":"ok","score":1,"total":1,"percentage":100}`; `cpdHoursThisYear: 4`; warehouse-staff call returns `403`.

- [ ] **Step 2: Clean up all test data**

```bash
node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  await pool.query(\"delete from results where outlet='TESTOUTLET'\");
  await pool.query(\"delete from content_questions where topic='E2E_TOPIC'\");
  await pool.query(\"delete from content where topic='E2E_TOPIC'\");
  await pool.query(\"delete from sessions where scope_key like 'TESTOUTLET|%' or scope_key='ALL'\");
  const check = await pool.query(\"select count(*) from results where outlet='TESTOUTLET'\");
  console.log('leftover results:', check.rows[0].count);
  process.exit(0);
});
"
```

Expected: `leftover results: 0`.

- [ ] **Step 3: Final `npm run build` + EN/MS parity check on the frontend**

```bash
cd lautan-academy-frontend
npm run build
node -e "
const en = require('./src/i18n/locales/en.json');
const ms = require('./src/i18n/locales/ms.json');
function keys(o, p=''){let r=[];for(const k in o){const v=o[k];const kp=p?p+'.'+k:k;if(v&&typeof v==='object')r=r.concat(keys(v,kp));else r.push(kp);}return r;}
const ek=new Set(keys(en)), mk=new Set(keys(ms));
console.log('EN total', ek.size, 'MS total', mk.size);
console.log('missing in MS:', [...ek].filter(k=>!mk.has(k)));
console.log('missing in EN:', [...mk].filter(k=>!ek.has(k)));
"
```

Expected: build clean, `EN total` === `MS total`, both missing-key lists empty.

- [ ] **Step 4: Update `MEMORY.md`**

Add a `[DONE, NOT PUSHED]` entry to `lautan-academy/MEMORY.md` summarizing what shipped, verification performed, and flag the recurring known gap: no live browser click-through was available this session (no Playwright tool) — recommend one before real Supervisor/staff use, same as several prior subsystems.

- [ ] **Step 5: Report status to the user**

Summarize: both repos' commits ready, nothing pushed yet (matches this project's convention of batching pushes for user review) — ask whether to push now or hold.

---

## Notes for the executor

- Every task that touches the frontend must end with a clean `npm run build` — a broken build blocks every later task, don't proceed past one.
- Every task that touches i18n must end with a clean key-parity check — a mismatch here has silently caused a real shipped bug before in this project (`f401274` — a key landed in the wrong locale block, parity script stayed green because both files still had matching key *counts*, just under the wrong parent. Double check the key lands under the *correct* top-level block, not just that the parity script passes).
- Task 7's `hoursByStaff()` signature change (inserting a new 4th positional param before the existing `year`) touches 4 existing view files — don't skip updating all 4, a stale call site would silently pass `cpdYear.value` as the new `contentHoursByTopicMap` param instead of `year`, corrupting that view's CPD numbers (wrong type in a `.has()`/`.get()` call — would silently no-op rather than throw, easy to miss without the Step 3 mock test).
- No live browser click-through is expected to be available (no Playwright tool in recent sessions) — Task 12 flags this explicitly rather than silently skipping it. If a browser tool becomes available before shipping, run through: Supervisor marks an entry quiz-required + sets hours + authors questions; retail staff sees "Take Quiz" only on that entry; reads, clicks "I've read this", completes the quiz; CPD number updates by the entry's real hours; retaking the same entry same year doesn't double-credit; a warehouse-staff login sees the entry with no gate at all; a non-quiz-required entry is completely unchanged for everyone.
