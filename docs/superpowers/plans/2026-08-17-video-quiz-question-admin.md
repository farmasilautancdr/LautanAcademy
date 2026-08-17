# Video/Reading Quiz Question Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Supervisor in-app CRUD (add/edit/delete) over `video_questions` — the quiz bank behind Video Training and Pharmacist Courses — replacing the current manual-Supabase-insert-only workflow.

**Architecture:** Three new Express routes extend the existing `videoQuestionsRouter` in `routes/videoTraining.js` (already has GET list + POST check). One new Vue view (`SupervisorManageQuizQuestionsView.vue`) reached via a new sidebar nav item, following the exact list+form CRUD pattern `SupervisorAddResourcesView.vue` already uses for `video_trainings`. No schema changes, no new files beyond the one view.

**Tech Stack:** Node.js/Express/`pg` (backend, `lautan-academy-backend`), Vue 3 + Vite + Tailwind + `vue-i18n` (frontend, `lautan-academy-frontend`). No test framework in either repo — verification is `curl` round-trips (backend) + `npm run build` + manual/Playwright click-through (frontend), matching every prior subsystem in this codebase.

**Spec:** `docs/superpowers/specs/2026-08-17-video-quiz-question-admin-design.md`

## Global Constraints

- Supervisor-only (`requireScope('supervisor')`) — not Master.
- Hard delete, no soft-delete/status changes — `status` column stays `'active'` always.
- Both MCQ (4 options, `correct` 0-3) and True/False (2 options, `correct` 0-1, opt3/opt4 forced to `''`) must be supported.
- Delete is blocked (400) if it's the last `video_questions` row for that topic.
- `topic` must be picked from existing `video_trainings` topics (general + pharmacist), never free text — no FK exists, a typo silently orphans the question.
- Every user-facing string needs both `en.json` and `ms.json` entries (this codebase is bilingual EN/BM throughout).
- Match existing file conventions (see `routes/videoTraining.js`, `routes/masterOutlets.js`, `SupervisorAddResourcesView.vue`) over introducing new patterns.

---

## Task 1: Backend — POST /video-questions (create)

**Files:**
- Modify: `lautan-academy-backend/src/routes/videoTraining.js` (append after the existing `videoQuestionsRouter.post('/:id/check', ...)` block, which currently ends the file at line 196-197)

**Interfaces:**
- Consumes: `pool` (from `../config/db.js`), `requireAuth`/`requireScope` (from `../middleware/auth.js`), `logAuditSafe` (from `../services/auditLog.js`) — all already imported at the top of this file.
- Produces: `videoQuestionsRouter.post('/', ...)` — used by Task 4's `api.addVideoQuestion`.

- [ ] **Step 1: Add the route**

Append to `lautan-academy-backend/src/routes/videoTraining.js`:

```js
// Supervisor-only CRUD over the quiz bank itself — GET (list by topic) and
// POST /:id/check already existed for taking a quiz; these three add
// management. `topic` is validated against real video_trainings rows (not
// just non-empty) because the topic/video_trainings join elsewhere in this
// file is a plain string match with no FK — a typo here would silently
// orphan the question with no error anywhere.
async function topicExists(topic) {
  const { rows } = await pool.query(
    'select 1 from video_trainings where topic = $1 limit 1',
    [topic]
  );
  return rows.length > 0;
}

function validateQuestionBody(body) {
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

  if (!['mcq', 'tf'].includes(type)) {
    return { error: 'Type must be mcq or tf.' };
  }
  if (!topic) {
    return { error: 'Topic is required.' };
  }
  if (!question_en || !question_ms) {
    return { error: 'Question text (EN and MS) is required.' };
  }
  if (type === 'mcq') {
    if (!opt1_en || !opt2_en || !opt3_en || !opt4_en || !opt1_ms || !opt2_ms || !opt3_ms || !opt4_ms) {
      return { error: 'All 4 options (EN and MS) are required for a multiple-choice question.' };
    }
    if (!Number.isInteger(correct) || correct < 0 || correct > 3) {
      return { error: 'Correct answer must be option 1-4 for a multiple-choice question.' };
    }
    return {
      row: { topic, question_en, question_ms, opt1_en, opt2_en, opt3_en, opt4_en, opt1_ms, opt2_ms, opt3_ms, opt4_ms, correct },
    };
  }
  // type === 'tf'
  if (!opt1_en || !opt2_en || !opt1_ms || !opt2_ms) {
    return { error: 'Both options (EN and MS) are required for a True/False question.' };
  }
  if (!Number.isInteger(correct) || correct < 0 || correct > 1) {
    return { error: 'Correct answer must be option 1-2 for a True/False question.' };
  }
  return {
    row: { topic, question_en, question_ms, opt1_en, opt2_en, opt3_en: '', opt4_en: '', opt1_ms, opt2_ms, opt3_ms: '', opt4_ms: '', correct },
  };
}

videoQuestionsRouter.post('/', requireAuth, requireScope('supervisor'), async (req, res) => {
  const { error, row } = validateQuestionBody(req.body);
  if (error) return res.status(400).json({ status: 'error', error });

  if (!(await topicExists(row.topic))) {
    return res.status(400).json({ status: 'error', error: `Unknown topic '${row.topic}' — no course with this topic exists.` });
  }

  const { rows } = await pool.query(
    `insert into video_questions
      (topic, question_en, question_ms, opt1_en, opt2_en, opt3_en, opt4_en, opt1_ms, opt2_ms, opt3_ms, opt4_ms, correct, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active')
     returning id`,
    [row.topic, row.question_en, row.question_ms, row.opt1_en, row.opt2_en, row.opt3_en, row.opt4_en, row.opt1_ms, row.opt2_ms, row.opt3_ms, row.opt4_ms, row.correct]
  );
  logAuditSafe({
    actorType: req.session.scopeType,
    actorKey: req.session.scopeKey,
    action: 'video_question.add',
    summary: `Added question to topic "${row.topic}": ${row.question_en.slice(0, 60)}`,
  });
  res.json({ status: 'ok', id: rows[0].id });
});
```

- [ ] **Step 2: Start the backend dev server**

Run: `cd lautan-academy-backend && node --watch src/index.js`
Expected: `Server listening on port 3000` (or equivalent), no error.

- [ ] **Step 3: Verify manually with curl**

In a separate terminal, mint a throwaway Supervisor token and confirm the happy path + validation errors. Use a real topic that exists in your `video_trainings` table — substitute `<REAL_TOPIC>` below (if `video_trainings` is empty in your environment, first insert one throwaway row: `insert into video_trainings (title, topic, youtube_url, hours, kind, pharmacist_only) values ('Test Course', 'CAVEMAN_PLAN_TEST_TOPIC', 'https://youtu.be/dQw4w9WgXcQ', 1, 'video', false);`).

```bash
cd lautan-academy-backend
node -e "
(async () => {
  const { issueToken } = await import('./src/middleware/auth.js');
  const token = await issueToken('supervisor', 'ALL');
  console.log(token);
})();
"
```

Copy the printed token, then:

```bash
TOKEN="<paste token here>"
TOPIC="<REAL_TOPIC>"

# No auth -> 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/video-questions

# Missing required field -> 400
curl -s -X POST http://localhost:3000/video-questions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"type\":\"mcq\",\"topic\":\"$TOPIC\"}"

# Unknown topic -> 400
curl -s -X POST http://localhost:3000/video-questions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"mcq","topic":"NO_SUCH_TOPIC","question_en":"Q?","question_ms":"S?","opt1_en":"A","opt2_en":"B","opt3_en":"C","opt4_en":"D","opt1_ms":"A","opt2_ms":"B","opt3_ms":"C","opt4_ms":"D","correct":0}'

# correct out of range -> 400
curl -s -X POST http://localhost:3000/video-questions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"type\":\"mcq\",\"topic\":\"$TOPIC\",\"question_en\":\"Q?\",\"question_ms\":\"S?\",\"opt1_en\":\"A\",\"opt2_en\":\"B\",\"opt3_en\":\"C\",\"opt4_en\":\"D\",\"opt1_ms\":\"A\",\"opt2_ms\":\"B\",\"opt3_ms\":\"C\",\"opt4_ms\":\"D\",\"correct\":4}"

# Happy path MCQ -> 200 {status:'ok', id:...}
curl -s -X POST http://localhost:3000/video-questions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"type\":\"mcq\",\"topic\":\"$TOPIC\",\"question_en\":\"Q?\",\"question_ms\":\"S?\",\"opt1_en\":\"A\",\"opt2_en\":\"B\",\"opt3_en\":\"C\",\"opt4_en\":\"D\",\"opt1_ms\":\"A\",\"opt2_ms\":\"B\",\"opt3_ms\":\"C\",\"opt4_ms\":\"D\",\"correct\":1}"

# Happy path TF -> 200, opt3/opt4 stored as ''
curl -s -X POST http://localhost:3000/video-questions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"type\":\"tf\",\"topic\":\"$TOPIC\",\"question_en\":\"True?\",\"question_ms\":\"Betul?\",\"opt1_en\":\"True\",\"opt2_en\":\"False\",\"opt1_ms\":\"Betul\",\"opt2_ms\":\"Salah\",\"correct\":0}"
```

Expected: first call 401; next three each `{"status":"error","error":"..."}` with a 400; last two `{"status":"ok","id":<number>}`. Confirm in the DB that the TF row's `opt3_en`/`opt4_en`/`opt3_ms`/`opt4_ms` are `''`:

```bash
node -e "
(async () => {
  const { pool } = await import('./src/config/db.js');
  const r = await pool.query(\"select id, opt3_en, opt4_en from video_questions where topic = '$TOPIC' order by id desc limit 2\");
  console.log(r.rows);
  await pool.end();
})();
"
```

Note the two inserted rows' `id`s — needed by Task 2/3's tests. Do not delete them yet.

- [ ] **Step 4: Commit**

```bash
cd lautan-academy-backend
git add src/routes/videoTraining.js
git commit -m "feat: add POST /video-questions for Supervisor question creation"
```

---

## Task 2: Backend — PATCH /video-questions/:id (edit)

**Files:**
- Modify: `lautan-academy-backend/src/routes/videoTraining.js` (append after Task 1's new POST route)

**Interfaces:**
- Consumes: `validateQuestionBody()` and `topicExists()` from Task 1 (same file, module-scope functions).
- Produces: `videoQuestionsRouter.patch('/:id', ...)` — used by Task 4's `api.updateVideoQuestion`.

- [ ] **Step 1: Add the route**

Append to `lautan-academy-backend/src/routes/videoTraining.js`:

```js
// Full-row overwrite, not partial PATCH semantics — a question's fields
// are all interdependent on `type` (tf forces opt3/opt4 blank), so
// re-validating and re-writing every field avoids a stale mismatched
// field surviving a type change.
videoQuestionsRouter.patch('/:id', requireAuth, requireScope('supervisor'), async (req, res) => {
  const id = parseInt(req.params.id);
  const { rows: existingRows } = await pool.query('select id from video_questions where id = $1', [id]);
  if (!existingRows[0]) return res.status(404).json({ status: 'error', error: 'Question not found.' });

  const { error, row } = validateQuestionBody(req.body);
  if (error) return res.status(400).json({ status: 'error', error });

  if (!(await topicExists(row.topic))) {
    return res.status(400).json({ status: 'error', error: `Unknown topic '${row.topic}' — no course with this topic exists.` });
  }

  await pool.query(
    `update video_questions set
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
    action: 'video_question.update',
    summary: `Updated question ${id} (topic "${row.topic}")`,
  });
  res.json({ status: 'ok' });
});
```

- [ ] **Step 2: Verify manually with curl**

Using one of the ids inserted in Task 1 Step 3 (`<QID>`), the dev server still running (`--watch` picks up the file change automatically):

```bash
TOKEN="<same token as Task 1, or mint a fresh one the same way>"
TOPIC="<REAL_TOPIC>"
QID="<id from Task 1's MCQ insert>"

# Unknown id -> 404
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH http://localhost:3000/video-questions/999999999 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"type\":\"mcq\",\"topic\":\"$TOPIC\",\"question_en\":\"Q?\",\"question_ms\":\"S?\",\"opt1_en\":\"A\",\"opt2_en\":\"B\",\"opt3_en\":\"C\",\"opt4_en\":\"D\",\"opt1_ms\":\"A\",\"opt2_ms\":\"B\",\"opt3_ms\":\"C\",\"opt4_ms\":\"D\",\"correct\":0}"

# Happy path -> 200, changes correct from 1 to 2
curl -s -X PATCH http://localhost:3000/video-questions/$QID \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"type\":\"mcq\",\"topic\":\"$TOPIC\",\"question_en\":\"Q edited?\",\"question_ms\":\"S edited?\",\"opt1_en\":\"A\",\"opt2_en\":\"B\",\"opt3_en\":\"C\",\"opt4_en\":\"D\",\"opt1_ms\":\"A\",\"opt2_ms\":\"B\",\"opt3_ms\":\"C\",\"opt4_ms\":\"D\",\"correct\":2}"

# Confirm the edit landed
curl -s "http://localhost:3000/video-questions?topic=$TOPIC" -H "Authorization: Bearer $TOKEN"
```

Expected: first call `404`; second `{"status":"ok"}`; third shows `question_en:"Q edited?"` for that id (the response omits `correct`, so verify it via a direct DB query if you want to double check the stored value: `select correct from video_questions where id = $QID`).

- [ ] **Step 3: Commit**

```bash
cd lautan-academy-backend
git add src/routes/videoTraining.js
git commit -m "feat: add PATCH /video-questions/:id for Supervisor question editing"
```

---

## Task 3: Backend — DELETE /video-questions/:id (delete, with last-question guard)

**Files:**
- Modify: `lautan-academy-backend/src/routes/videoTraining.js` (append after Task 2's new PATCH route)

**Interfaces:**
- Consumes: `pool`, `requireAuth`/`requireScope`, `logAuditSafe` (already imported).
- Produces: `videoQuestionsRouter.delete('/:id', ...)`, used by Task 4's `api.deleteVideoQuestion`.

- [ ] **Step 1: Add the route**

Append to `lautan-academy-backend/src/routes/videoTraining.js`:

```js
// Blocks deleting a topic's last remaining question — GET /video-trainings
// and GET /video-trainings/pharmacist both only list a course if its topic
// has >=1 active video_questions row (see those handlers above), so
// deleting the last one would silently vanish the course from staff view.
videoQuestionsRouter.delete('/:id', requireAuth, requireScope('supervisor'), async (req, res) => {
  const id = parseInt(req.params.id);
  const { rows } = await pool.query('select topic from video_questions where id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ status: 'error', error: 'Question not found.' });
  const topic = rows[0].topic;

  const { rows: siblingRows } = await pool.query(
    'select count(*)::int as count from video_questions where topic = $1 and id != $2',
    [topic, id]
  );
  if (siblingRows[0].count === 0) {
    return res.status(400).json({
      status: 'error',
      error: `Can't delete: this is the only question left for "${topic}" — the course would disappear from staff view.`,
    });
  }

  await pool.query('delete from video_questions where id = $1', [id]);
  logAuditSafe({
    actorType: req.session.scopeType,
    actorKey: req.session.scopeKey,
    action: 'video_question.delete',
    summary: `Deleted question ${id} (topic "${topic}")`,
  });
  res.json({ status: 'ok' });
});
```

- [ ] **Step 2: Verify manually with curl**

Using the two ids from Task 1 Step 3 (`<QID_MCQ>` = the MCQ one edited in Task 2, `<QID_TF>` = the True/False one):

```bash
TOKEN="<same token>"
TOPIC="<REAL_TOPIC>"

# Unknown id -> 404
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE http://localhost:3000/video-questions/999999999 \
  -H "Authorization: Bearer $TOKEN"

# Delete the MCQ one (TF sibling still exists) -> 200
curl -s -X DELETE http://localhost:3000/video-questions/<QID_MCQ> -H "Authorization: Bearer $TOKEN"

# Now only the TF question remains for TOPIC — deleting it should be BLOCKED -> 400
curl -s -X DELETE http://localhost:3000/video-questions/<QID_TF> -H "Authorization: Bearer $TOKEN"

# Confirm it's still there
curl -s "http://localhost:3000/video-questions?topic=$TOPIC" -H "Authorization: Bearer $TOKEN"
```

Expected: `404`, then `{"status":"ok"}`, then `{"status":"error","error":"Can't delete: this is the only question left for \"...\" — the course would disappear from staff view."}`, then the final GET still shows the TF row.

- [ ] **Step 3: Clean up test data**

```bash
node -e "
(async () => {
  const { pool } = await import('./src/config/db.js');
  await pool.query(\"delete from video_questions where topic = '$TOPIC'\");
  await pool.query(\"delete from video_trainings where topic = 'CAVEMAN_PLAN_TEST_TOPIC'\"); // only if you inserted this throwaway course in Task 1
  await pool.end();
})();
"
```

Stop the dev server (Ctrl+C, or find/kill the listening process on port 3000).

- [ ] **Step 4: Commit**

```bash
cd lautan-academy-backend
git add src/routes/videoTraining.js
git commit -m "feat: add DELETE /video-questions/:id with last-question guard"
```

---

## Task 4: Frontend — API client, router, sidebar nav

**Files:**
- Modify: `lautan-academy-frontend/src/api/client.js:124-129` (add 3 new methods next to the existing `video-questions`/`video-trainings` ones)
- Modify: `lautan-academy-frontend/src/router/index.js:34` (add import), `:83` (add route entry)
- Modify: `lautan-academy-frontend/src/components/AppSidebar.vue:151` (add nav item to the existing `groupBrowseCourses` group, next to Add Resources)

**Interfaces:**
- Consumes: Task 1-3's backend routes (`POST/PATCH/DELETE /video-questions`, `POST /video-questions/:id` for PATCH).
- Produces: `api.addVideoQuestion(payload)`, `api.updateVideoQuestion(id, payload)`, `api.deleteVideoQuestion(id)` — all consumed by Task 5's view. Route name `supervisor-manage-quiz-questions` at path `/supervisor/manage-quiz-questions`.

- [ ] **Step 1: Add API client methods**

In `lautan-academy-frontend/src/api/client.js`, right after the existing line `checkVideoAnswer: (id, chosen) => ...` (currently line 126):

```js
  addVideoQuestion: (payload) => request('/video-questions', { method: 'POST', body: JSON.stringify(payload) }),
  updateVideoQuestion: (id, payload) => request(`/video-questions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteVideoQuestion: (id) => request(`/video-questions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
```

- [ ] **Step 2: Add the route**

In `lautan-academy-frontend/src/router/index.js`, add the import after line 34 (`import SupervisorPharmacistTagView ...`):

```js
import SupervisorManageQuizQuestionsView from '../views/SupervisorManageQuizQuestionsView.vue'
```

And add the route entry after line 83 (`{ path: '/supervisor/pharmacist', ... }`):

```js
    { path: '/supervisor/manage-quiz-questions', name: 'supervisor-manage-quiz-questions', component: SupervisorManageQuizQuestionsView, meta: { requiresAuth: true, role: 'manager', managerRole: 'supervisor' } },
```

(This will fail to compile until Task 5 creates the component file — that's expected, Step 4 below verifies after Task 5.)

- [ ] **Step 3: Add the sidebar nav item**

In `lautan-academy-frontend/src/components/AppSidebar.vue`, the `groupBrowseCourses` group (around line 147-153) currently reads:

```js
    groups.push({
      label: t('sidebar.groupBrowseCourses'),
      items: [
        { label: t('sidebar.browseCourses'), to: managerResourcesPath.value, icon: 'book' },
        { label: t('sidebar.addResources'), to: '/supervisor/add-resources', icon: 'plus' },
      ],
    })
```

Add a third item:

```js
    groups.push({
      label: t('sidebar.groupBrowseCourses'),
      items: [
        { label: t('sidebar.browseCourses'), to: managerResourcesPath.value, icon: 'book' },
        { label: t('sidebar.addResources'), to: '/supervisor/add-resources', icon: 'plus' },
        { label: t('sidebar.manageQuizQuestions'), to: '/supervisor/manage-quiz-questions', icon: 'clipboard' },
      ],
    })
```

(`clipboard` is an existing icon key already defined in this file's `ICONS` object — no new icon needed. The mobile bottom-nav bar renders from the same `groups` data via `flatItems`, so no separate mobile edit is needed.)

- [ ] **Step 4: Defer build verification to Task 6**

This task's route/import will not compile standalone (component doesn't exist yet) — verification happens after Task 5 creates the view. Do not commit yet; Task 5 commits Tasks 4+5 together (they're one working unit — a route to a component that doesn't exist isn't independently testable).

---

## Task 5: Frontend — SupervisorManageQuizQuestionsView.vue

**Files:**
- Create: `lautan-academy-frontend/src/views/SupervisorManageQuizQuestionsView.vue`

**Interfaces:**
- Consumes: `api.getVideoTrainings()`, `api.getPharmacistCourses()`, `api.getVideoQuestions(topic)`, `api.addVideoQuestion(payload)`, `api.updateVideoQuestion(id, payload)`, `api.deleteVideoQuestion(id)` (Task 4). `usePagination` from `../composables/usePagination`, `Pagination` from `../components/Pagination.vue` (both already exist, used identically in `SupervisorAddResourcesView.vue`).
- Produces: nothing consumed by later tasks — this is the leaf UI.

- [ ] **Step 1: Write the component**

Create `lautan-academy-frontend/src/views/SupervisorManageQuizQuestionsView.vue`:

```vue
<script setup>
// Supervisor-only CRUD over video_questions (the quiz bank behind Video
// Training + Pharmacist Courses). Topic is picked from a dropdown of real
// video_trainings topics, not free text — video_questions.topic is a plain
// string match with no FK, a typo would silently orphan the question.
import { ref, computed, watch } from 'vue'
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
  const [generalData, pharmacistData] = await Promise.allSettled([api.getVideoTrainings(), api.getPharmacistCourses()])
  const general = generalData.status === 'fulfilled' ? (generalData.value.videoTrainings || []) : []
  const pharmacist = pharmacistData.status === 'fulfilled' ? (pharmacistData.value.videoTrainings || []) : []
  topics.value = [...new Set([...general, ...pharmacist].map(v => v.topic))].filter(Boolean).sort()
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
    const data = await api.getVideoQuestions(selectedTopic.value)
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
  qCorrect.value = 0 // backend never sends `correct` in the list response (grading endpoint keeps it server-side); Supervisor re-picks it when editing
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
      await api.updateVideoQuestion(editingId.value, payload)
    } else {
      await api.addVideoQuestion(payload)
    }
    resetForm()
    await loadQuestions()
  } catch (err) {
    qError.value = err.message || t('supervisorManageQuizQuestionsView.errorSaveFailed')
  } finally {
    qSaving.value = false
  }
}

const deleteError = ref('')
async function removeQuestion(q) {
  deleteError.value = ''
  if (!confirm(t('supervisorManageQuizQuestionsView.confirmRemove'))) return
  try {
    await api.deleteVideoQuestion(q.id)
    if (editingId.value === q.id) resetForm()
    await loadQuestions()
  } catch (err) {
    deleteError.value = err.message || t('supervisorManageQuizQuestionsView.errorDeleteFailed')
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ t('sidebar.roleSupervisor') }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('supervisorManageQuizQuestionsView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div class="mb-4">
        <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorManageQuizQuestionsView.topicLabel') }}</label>
        <div v-if="loadingTopics" class="text-slate text-sm">{{ t('supervisorManageQuizQuestionsView.loading') }}</div>
        <select v-else v-model="selectedTopic" class="w-full border border-slate/30 rounded-lg py-2 px-3 bg-white">
          <option value="">{{ t('supervisorManageQuizQuestionsView.topicPlaceholder') }}</option>
          <option v-for="topic in topics" :key="topic" :value="topic">{{ topic }}</option>
        </select>
        <p v-if="!loadingTopics && topics.length === 0" class="text-xs text-slate mt-1">{{ t('supervisorManageQuizQuestionsView.noTopicsYet') }}</p>
      </div>

      <template v-if="selectedTopic">
        <p v-if="deleteError" class="text-coral text-sm mb-2">{{ deleteError }}</p>

        <div v-if="loadingQuestions" class="text-slate text-sm">{{ t('supervisorManageQuizQuestionsView.loading') }}</div>
        <div v-else-if="questions.length === 0" class="text-slate text-sm mb-4">{{ t('supervisorManageQuizQuestionsView.noQuestionsYet') }}</div>
        <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam mb-4">
          <div v-for="q in paginatedQuestions" :key="q.id" class="px-5 py-3 flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-ink truncate">{{ q.question_en }}</p>
              <p class="text-xs text-slate">{{ q.opt3_en === '' ? t('supervisorManageQuizQuestionsView.typeTrueFalse') : t('supervisorManageQuizQuestionsView.typeMcq') }}</p>
            </div>
            <div class="flex gap-3 shrink-0">
              <button @click="startEdit(q)" class="text-aqua text-xs font-medium underline">{{ t('supervisorManageQuizQuestionsView.edit') }}</button>
              <button @click="removeQuestion(q)" class="text-coral text-xs font-medium underline">{{ t('supervisorManageQuizQuestionsView.remove') }}</button>
            </div>
          </div>
          <Pagination :current-page="currentPage" :total-pages="totalPages" @prev="prev" @next="next" />
        </div>

        <form @submit.prevent="saveQuestion" class="bg-white rounded-xl2 p-5 shadow-sm space-y-3">
          <h2 class="font-display text-base font-semibold text-ink">
            {{ editingId ? t('supervisorManageQuizQuestionsView.editingHeading') : t('supervisorManageQuizQuestionsView.addingHeading') }}
          </h2>
          <div>
            <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorManageQuizQuestionsView.typeLabel') }}</label>
            <select v-model="qType" class="w-full border border-slate/30 rounded-lg py-2 px-3">
              <option value="mcq">{{ t('supervisorManageQuizQuestionsView.typeMcq') }}</option>
              <option value="tf">{{ t('supervisorManageQuizQuestionsView.typeTrueFalse') }}</option>
            </select>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorManageQuizQuestionsView.questionEnLabel') }}</label>
              <textarea v-model="qQuestionEn" rows="2" class="w-full border border-slate/30 rounded-lg py-2 px-3"></textarea>
            </div>
            <div>
              <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorManageQuizQuestionsView.questionMsLabel') }}</label>
              <textarea v-model="qQuestionMs" rows="2" class="w-full border border-slate/30 rounded-lg py-2 px-3"></textarea>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="flex items-center gap-2 text-sm text-ink mb-1">
                <input type="radio" :value="0" v-model="qCorrect" /> {{ t('supervisorManageQuizQuestionsView.opt1EnLabel') }}
              </label>
              <input v-model="qOpt1En" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
            </div>
            <div>
              <label class="block text-sm text-ink mb-1">{{ t('supervisorManageQuizQuestionsView.opt1MsLabel') }}</label>
              <input v-model="qOpt1Ms" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
            </div>
            <div>
              <label class="flex items-center gap-2 text-sm text-ink mb-1">
                <input type="radio" :value="1" v-model="qCorrect" /> {{ t('supervisorManageQuizQuestionsView.opt2EnLabel') }}
              </label>
              <input v-model="qOpt2En" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
            </div>
            <div>
              <label class="block text-sm text-ink mb-1">{{ t('supervisorManageQuizQuestionsView.opt2MsLabel') }}</label>
              <input v-model="qOpt2Ms" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
            </div>
            <template v-if="qType === 'mcq'">
              <div>
                <label class="flex items-center gap-2 text-sm text-ink mb-1">
                  <input type="radio" :value="2" v-model="qCorrect" /> {{ t('supervisorManageQuizQuestionsView.opt3EnLabel') }}
                </label>
                <input v-model="qOpt3En" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
              </div>
              <div>
                <label class="block text-sm text-ink mb-1">{{ t('supervisorManageQuizQuestionsView.opt3MsLabel') }}</label>
                <input v-model="qOpt3Ms" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
              </div>
              <div>
                <label class="flex items-center gap-2 text-sm text-ink mb-1">
                  <input type="radio" :value="3" v-model="qCorrect" /> {{ t('supervisorManageQuizQuestionsView.opt4EnLabel') }}
                </label>
                <input v-model="qOpt4En" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
              </div>
              <div>
                <label class="block text-sm text-ink mb-1">{{ t('supervisorManageQuizQuestionsView.opt4MsLabel') }}</label>
                <input v-model="qOpt4Ms" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
              </div>
            </template>
          </div>

          <p v-if="qError" class="text-coral text-sm">{{ qError }}</p>
          <div class="flex gap-2">
            <button type="submit" :disabled="qSaving" class="bg-aqua text-white font-medium px-5 py-2.5 rounded-lg disabled:opacity-60">
              {{ qSaving ? t('supervisorManageQuizQuestionsView.saving') : (editingId ? t('supervisorManageQuizQuestionsView.saveChanges') : t('supervisorManageQuizQuestionsView.addQuestion')) }}
            </button>
            <button v-if="editingId" type="button" @click="resetForm" class="text-slate text-sm font-medium px-3">
              {{ t('supervisorManageQuizQuestionsView.cancelEdit') }}
            </button>
          </div>
        </form>
      </template>
    </main>
  </div>
</template>
```

- [ ] **Step 2: Commit Tasks 4 + 5 together**

```bash
cd lautan-academy-frontend
git add src/api/client.js src/router/index.js src/components/AppSidebar.vue src/views/SupervisorManageQuizQuestionsView.vue
git commit -m "feat: add Supervisor UI for managing video/reading quiz questions"
```

(Build verification happens in Task 6 once i18n keys exist — this view calls `t()` with keys that don't exist yet, so `npm run build` will succeed but the UI will show raw key strings until Task 6 lands.)

---

## Task 6: i18n keys (EN/MS) + key-parity check + build verification

**Files:**
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json` (add `sidebar.manageQuizQuestions` near `sidebar.addResources`; add a new top-level `supervisorManageQuizQuestionsView` block, following the same placement convention as the existing `supervisorAddResourcesView` block)
- Modify: `lautan-academy-frontend/src/i18n/locales/ms.json` (same two additions, Malay text)

**Interfaces:**
- Consumes: nothing (pure data).
- Produces: every `t('supervisorManageQuizQuestionsView.*')` and `t('sidebar.manageQuizQuestions')` call from Tasks 4-5 resolves to real text instead of showing the raw key.

- [ ] **Step 1: Add the sidebar key**

In `lautan-academy-frontend/src/i18n/locales/en.json`, next to the existing `"addResources": "Add Resources",` (line 155):

```json
    "manageQuizQuestions": "Manage Quiz Questions",
```

In `lautan-academy-frontend/src/i18n/locales/ms.json`, find the matching `"addResources"` key in the `sidebar` block and add directly after it:

```json
    "manageQuizQuestions": "Urus Soalan Kuiz",
```

- [ ] **Step 2: Add the view's block to en.json**

In `lautan-academy-frontend/src/i18n/locales/en.json`, add a new top-level block (place it alphabetically near `"supervisorManageAccessView"`/`"supervisorAddResourcesView"`, matching this file's existing per-view namespace convention):

```json
  "supervisorManageQuizQuestionsView": {
    "title": "Manage Quiz Questions",
    "loading": "Loading...",
    "topicLabel": "Topic",
    "topicPlaceholder": "Select a topic...",
    "noTopicsYet": "No courses exist yet — add one under Add Resources first, then come back here to add its quiz questions.",
    "noQuestionsYet": "No questions for this topic yet — add one below.",
    "typeMcq": "Multiple Choice",
    "typeTrueFalse": "True / False",
    "edit": "Edit",
    "remove": "Delete",
    "editingHeading": "Edit Question",
    "addingHeading": "Add Question",
    "typeLabel": "Question Type",
    "questionEnLabel": "Question (English)",
    "questionMsLabel": "Question (Bahasa Malaysia)",
    "opt1EnLabel": "Option 1 (English) — select if correct",
    "opt1MsLabel": "Option 1 (Bahasa Malaysia)",
    "opt2EnLabel": "Option 2 (English) — select if correct",
    "opt2MsLabel": "Option 2 (Bahasa Malaysia)",
    "opt3EnLabel": "Option 3 (English) — select if correct",
    "opt3MsLabel": "Option 3 (Bahasa Malaysia)",
    "opt4EnLabel": "Option 4 (English) — select if correct",
    "opt4MsLabel": "Option 4 (Bahasa Malaysia)",
    "saving": "Saving...",
    "saveChanges": "Save Changes",
    "addQuestion": "Add Question",
    "cancelEdit": "Cancel",
    "confirmRemove": "Delete this question?",
    "errorSaveFailed": "Failed to save. Please check the fields and try again.",
    "errorDeleteFailed": "Failed to delete."
  },
```

- [ ] **Step 3: Add the matching block to ms.json**

In `lautan-academy-frontend/src/i18n/locales/ms.json`, add the same key set with Malay values:

```json
  "supervisorManageQuizQuestionsView": {
    "title": "Urus Soalan Kuiz",
    "loading": "Memuatkan...",
    "topicLabel": "Topik",
    "topicPlaceholder": "Pilih topik...",
    "noTopicsYet": "Belum ada kursus — tambah satu di bawah Add Resources dahulu, kemudian kembali ke sini untuk tambah soalan kuiznya.",
    "noQuestionsYet": "Belum ada soalan untuk topik ini — tambah satu di bawah.",
    "typeMcq": "Pilihan Berganda",
    "typeTrueFalse": "Betul / Salah",
    "edit": "Edit",
    "remove": "Padam",
    "editingHeading": "Edit Soalan",
    "addingHeading": "Tambah Soalan",
    "typeLabel": "Jenis Soalan",
    "questionEnLabel": "Soalan (Bahasa Inggeris)",
    "questionMsLabel": "Soalan (Bahasa Malaysia)",
    "opt1EnLabel": "Pilihan 1 (Bahasa Inggeris) — tandakan jika betul",
    "opt1MsLabel": "Pilihan 1 (Bahasa Malaysia)",
    "opt2EnLabel": "Pilihan 2 (Bahasa Inggeris) — tandakan jika betul",
    "opt2MsLabel": "Pilihan 2 (Bahasa Malaysia)",
    "opt3EnLabel": "Pilihan 3 (Bahasa Inggeris) — tandakan jika betul",
    "opt3MsLabel": "Pilihan 3 (Bahasa Malaysia)",
    "opt4EnLabel": "Pilihan 4 (Bahasa Inggeris) — tandakan jika betul",
    "opt4MsLabel": "Pilihan 4 (Bahasa Malaysia)",
    "saving": "Menyimpan...",
    "saveChanges": "Simpan Perubahan",
    "addQuestion": "Tambah Soalan",
    "cancelEdit": "Batal",
    "confirmRemove": "Padam soalan ini?",
    "errorSaveFailed": "Gagal menyimpan. Sila semak medan dan cuba lagi.",
    "errorDeleteFailed": "Gagal memadam."
  },
```

- [ ] **Step 4: Run the key-parity check**

This project has no committed parity script (per its own CAVEAT note: no test framework) — every prior batch verified parity with a one-off inline check. Run:

```bash
cd lautan-academy-frontend
node -e "
const en = require('./src/i18n/locales/en.json');
const ms = require('./src/i18n/locales/ms.json');
function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? flatten(v, prefix + k + '.') : [prefix + k]
  );
}
const enKeys = new Set(flatten(en));
const msKeys = new Set(flatten(ms));
const missingInMs = [...enKeys].filter(k => !msKeys.has(k));
const missingInEn = [...msKeys].filter(k => !enKeys.has(k));
console.log('Missing in ms.json:', missingInMs);
console.log('Missing in en.json:', missingInEn);
console.log(missingInMs.length === 0 && missingInEn.length === 0 ? 'PARITY OK' : 'PARITY FAILED');
"
```

Expected: `PARITY OK`. If not, fix whichever key is missing and re-run.

- [ ] **Step 5: Build verification**

```bash
cd lautan-academy-frontend
npm run build
```

Expected: builds clean, no errors (this also confirms Task 4/5's router import and component reference are valid).

- [ ] **Step 6: Commit**

```bash
cd lautan-academy-frontend
git add src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "feat: add EN/MS strings for Manage Quiz Questions view"
```

---

## Task 7: End-to-end live verification

**Files:** none (verification only, no code changes expected unless a bug is found — if one is, fix it in the relevant file from Tasks 1-6 and note it here before re-running this task).

**Interfaces:**
- Consumes: the fully assembled feature from Tasks 1-6.
- Produces: nothing — this is the final gate before considering the feature done.

- [ ] **Step 1: Start both dev servers**

```bash
# terminal 1
cd lautan-academy-backend && node --watch src/index.js
# terminal 2
cd lautan-academy-frontend && npm run dev
```

- [ ] **Step 2: Browser click-through (Playwright if available, else manual)**

Log in as Supervisor (real PIN, or if unavailable, mint a manager token the same throwaway way Task 1 minted a supervisor token and inject into `localStorage['lautan_token']`/`localStorage['lautan_manager']` — same pattern this codebase's prior subsystems used when no real credentials were available). Then:

1. Open the sidebar — confirm "Manage Quiz Questions" appears under Browse Courses (desktop sidebar) and in the mobile bottom nav.
2. Navigate to it. Pick a topic with an existing course (create a throwaway one via Add Resources first if none exist).
3. Add an MCQ question — confirm it appears in the list.
4. Add a True/False question for the same topic — confirm it appears, and confirm its list-row shows "True / False" not "Multiple Choice".
5. Click Edit on the MCQ question, change its question text, save — confirm the list updates.
6. Delete the True/False question (leaving 1 question for the topic) — confirm it succeeds.
7. Attempt to delete the remaining question — confirm the "Can't delete..." error renders inline, not a generic failure.
8. Switch language to Bahasa Malaysia — confirm every label on this page (nav item, form labels, buttons, both error messages) is in Malay, not showing raw `supervisorManageQuizQuestionsView.*` keys.
9. Log out, log in as a non-Supervisor role (e.g. Outlet Manager) — confirm "Manage Quiz Questions" is absent from nav and a direct URL visit (`/supervisor/manage-quiz-questions`) redirects away (per the router guard's existing `managerRole` mismatch behavior).

- [ ] **Step 3: Clean up any test data created during click-through**

Delete any throwaway topic/course/questions created purely for this walkthrough, the same way Task 3's Step 3 cleaned up.

- [ ] **Step 4: Record verification in MEMORY.md**

Per this project's CLAUDE.md rule 5 ("Upon task completion, summarize outcomes to MEMORY.md"), add a `[DONE...]` entry to `lautan-academy/MEMORY.md` documenting what was built, backend/frontend commit ranges, and exactly how it was verified (mirroring the style of this file's existing subsystem entries — see e.g. the Pharmacist Tag entry). Also update the memory system's `pending_module_quiz_question_admin.md` note (now that video_questions CRUD is done, only standard_questions/Module Quiz remains pending).
