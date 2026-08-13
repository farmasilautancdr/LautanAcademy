# Pharmacist Tag + Gated Pharmacist Courses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Supervisor tag staff as "Pharmacist" (company-wide) and gate a new "Pharmacist Courses" section (video or reading + quiz, retail-only) visible only to tagged staff, feeding the existing 120hr/year CPD target.

**Architecture:** Backend: one additive migration (`staff_roster.is_pharmacist`, `video_trainings.kind`/`pharmacist_only`/`body`, `youtube_url` made nullable), two new Supervisor-only staff-directory routes, three extended/new `video_trainings` routes, one extended login route. Frontend: two new views (Supervisor tag directory, staff reading-course page), one new staff list view, one extended Supervisor add-course form, nav gating on a client-side `isPharmacist` flag set at login.

**Tech Stack:** Vue 3 + Vite + Tailwind (frontend), Node.js + Express + Postgres/Supabase (backend). No new dependencies.

## Global Constraints

- UI label "Pharmacist" everywhere user-facing; DB column stays `is_pharmacist` (never renamed, never shown).
- Only Supervisor can set the tag. Only Supervisor can add/edit course content (existing `requireScope('supervisor')` convention, unchanged).
- Pharmacist Courses is retail-only (`division: 'retail'` route meta, same as existing Video Training).
- Tag changes apply on next login only — no live mid-session refresh. The gated backend endpoint still re-checks the DB on every request regardless (client flag is advisory, never authorization).
- Reading-course unlock is a single "I've read this" button — no scroll-tracking, no timer.
- Both video and reading Pharmacist Courses credit the same existing 120hr CPD target via `video_trainings.hours` — no new accounting logic.
- EN/MS strings required for every new user-facing string, per existing bilingual convention (`src/i18n/locales/en.json` / `ms.json`, same flat-per-view-key structure).
- No automated test suite exists in either repo — verification is `curl` round-trips (backend), `npm run build` + EN/MS key-parity check (frontend), and live browser click-through, matching every prior feature in this codebase (see `MEMORY.md`).
- Spec: `docs/superpowers/specs/2026-08-13-pharmacist-tag-design.md`.

---

### Task 1: Database migration

**Files:**
- Create: `lautan-academy-backend/scripts/migrate-add-pharmacist-tag.js`
- Modify: `lautan-academy-backend/sql/schema.sql` (append at end)

**Interfaces:**
- Produces: `staff_roster.is_pharmacist` (boolean, default false), `video_trainings.kind` (text, default 'video'), `video_trainings.pharmacist_only` (boolean, default false), `video_trainings.body` (text, nullable), `video_trainings.youtube_url` now nullable. Every later backend task reads/writes these exact column names.

- [ ] **Step 1: Write the migration script**

```js
// One-off: adds staff_roster.is_pharmacist (CPD sub-project B tag) and
// extends video_trainings for pharmacist-gated courses (kind: video|reading,
// pharmacist_only flag, optional body text for reading courses; youtube_url
// becomes nullable since a reading-kind row has none). See
// docs/superpowers/specs/2026-08-13-pharmacist-tag-design.md.
// Safe to re-run (add-if-not-exists / drop not null is idempotent).
import { pool } from '../src/config/db.js';

async function main() {
  await pool.query(`alter table staff_roster add column if not exists is_pharmacist boolean not null default false`);
  await pool.query(`alter table video_trainings alter column youtube_url drop not null`);
  await pool.query(`alter table video_trainings add column if not exists kind text not null default 'video'`);
  await pool.query(`alter table video_trainings add column if not exists pharmacist_only boolean not null default false`);
  await pool.query(`alter table video_trainings add column if not exists body text`);
  console.log('Migration complete: staff_roster.is_pharmacist, video_trainings.kind/pharmacist_only/body added, youtube_url nullable.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Append the same statements to `sql/schema.sql`**

Add after the existing `alter table video_trainings add column if not exists hours ...` line at the bottom of the file:

```sql
-- Pharmacist Tag + Gated Pharmacist Courses (CPD sub-project B). Supervisor
-- tags staff Pharmacist (UI label only — column name unchanged); Pharmacist
-- Courses reuses this same table with pharmacist_only=true, kind
-- distinguishing a YouTube video from a reading-material page (body). See
-- docs/superpowers/specs/2026-08-13-pharmacist-tag-design.md.
alter table staff_roster add column if not exists is_pharmacist boolean not null default false;
alter table video_trainings alter column youtube_url drop not null;
alter table video_trainings add column if not exists kind text not null default 'video';
alter table video_trainings add column if not exists pharmacist_only boolean not null default false;
alter table video_trainings add column if not exists body text;
```

- [ ] **Step 3: Run the migration against the real DB**

Run: `cd lautan-academy-backend && node scripts/migrate-add-pharmacist-tag.js`
Expected: prints `Migration complete: ...`, exits 0.

- [ ] **Step 4: Verify the columns exist**

Run:
```bash
node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  const r = await pool.query(\"select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and (table_name='staff_roster' or table_name='video_trainings') and column_name in ('is_pharmacist','kind','pharmacist_only','body','youtube_url') order by table_name, column_name\");
  console.log(r.rows);
  await pool.end();
});
"
```
Expected: 5 rows — `staff_roster.is_pharmacist` (boolean, not nullable, default false), `video_trainings.body` (text, nullable), `video_trainings.kind` (text, not nullable, default 'video'), `video_trainings.pharmacist_only` (boolean, not nullable, default false), `video_trainings.youtube_url` (nullable now `YES`).

- [ ] **Step 5: Commit**

```bash
cd lautan-academy-backend
git add scripts/migrate-add-pharmacist-tag.js sql/schema.sql
git commit -m "feat: add pharmacist tag + gated course columns"
```

---

### Task 2: Supervisor staff directory + tag toggle (backend)

**Files:**
- Modify: `lautan-academy-backend/src/routes/staff.js`

**Interfaces:**
- Consumes: `staff_roster.is_pharmacist` (Task 1), `requireAuth`/`requireScope` (`middleware/auth.js`, existing), `logAuditSafe` (`services/auditLog.js`, existing).
- Produces: `GET /staff-roster-manage/all` → `{staff: [{id, division, outlet, name, idNote, isPharmacist}]}`. `PATCH /staff-roster-manage/:id/pharmacist` → `{status:'ok'}` or 404. Frontend Task 6 calls these by exact path.

- [ ] **Step 1: Add the two routes**

Add to `lautan-academy-backend/src/routes/staff.js`, after the existing `staffRouter.delete('/', ...)` block (end of file, before nothing — this becomes the new end):

```js
// Company-wide (not outlet-scoped) — Supervisor tags staff Pharmacist from
// here. No other role can see or set this. See
// docs/superpowers/specs/2026-08-13-pharmacist-tag-design.md.
staffRouter.get('/all', requireAuth, requireScope('supervisor'), async (req, res) => {
  const { rows } = await pool.query(
    'select id, division, outlet, name, id_note, is_pharmacist from staff_roster order by outlet, name'
  );
  res.json({
    staff: rows.map(r => ({
      id: r.id,
      division: r.division,
      outlet: r.outlet,
      name: r.name,
      idNote: r.id_note,
      isPharmacist: r.is_pharmacist,
    })),
  });
});

staffRouter.patch('/:id/pharmacist', requireAuth, requireScope('supervisor'), async (req, res) => {
  const id = parseInt(req.params.id);
  const isPharmacist = !!req.body.isPharmacist;
  const { rows } = await pool.query('select outlet, name from staff_roster where id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ status: 'error', error: 'Staff member not found.' });

  await pool.query('update staff_roster set is_pharmacist = $1 where id = $2', [isPharmacist, id]);
  logAuditSafe({
    actorType: req.session.scopeType,
    actorKey: req.session.scopeKey,
    action: 'staff.pharmacist_tag',
    summary: `${isPharmacist ? 'Tagged' : 'Untagged'} ${rows[0].outlet}/${rows[0].name} as Pharmacist`,
  });
  res.json({ status: 'ok' });
});
```

- [ ] **Step 2: Start the backend**

Run: `cd lautan-academy-backend && npm run dev` (leave running)

- [ ] **Step 3: curl-verify without a Supervisor token**

Run: `curl -s -X GET http://localhost:3000/staff-roster-manage/all`
Expected: `{"authorized":false,"error":"No session token."}`, HTTP 401.

- [ ] **Step 4: curl-verify with a real Supervisor token**

Get a token: `curl -s -X POST http://localhost:3000/auth/manager-login -H "Content-Type: application/json" -d '{"role":"supervisor","pin":"<real supervisor PIN>"}'`
Then: `curl -s http://localhost:3000/staff-roster-manage/all -H "Authorization: Bearer <token>"`
Expected: 200, `{"staff":[...]}` with every staff row, each having `isPharmacist: false` (or true if any already tagged).

- [ ] **Step 5: curl-verify the tag toggle + audit log**

Pick a real `id` from Step 4's output (call it `<id>`):
`curl -s -X PATCH http://localhost:3000/staff-roster-manage/<id>/pharmacist -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"isPharmacist":true}'`
Expected: 200, `{"status":"ok"}`. Re-run Step 4's GET — that row now shows `isPharmacist: true`. Then:
`curl -s http://localhost:3000/master/audit-log -H "Authorization: Bearer <master token>"` (or check the `audit_log` table directly) — expect a row with `action: 'staff.pharmacist_tag'`.
Toggle it back to `false` afterward (leave test data clean, same caution as prior sessions' throwaway-account convention — reuse a real disposable staff row, don't leave a stray tag on production data).

- [ ] **Step 6: curl-verify unknown id**

`curl -s -X PATCH http://localhost:3000/staff-roster-manage/999999999/pharmacist -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"isPharmacist":true}'`
Expected: 404, `{"status":"error","error":"Staff member not found."}`.

- [ ] **Step 7: Commit**

```bash
cd lautan-academy-backend
git add src/routes/staff.js
git commit -m "feat: add supervisor staff directory + pharmacist tag toggle"
```

---

### Task 3: Pharmacist course content routes (backend)

**Files:**
- Modify: `lautan-academy-backend/src/routes/videoTraining.js`

**Interfaces:**
- Consumes: `video_trainings.kind`/`pharmacist_only`/`body` (Task 1), existing `extractYouTubeId()` in this same file.
- Produces: `POST /video-trainings` now accepts `kind`, `pharmacistOnly`, `body`. `GET /video-trainings` now excludes `pharmacist_only=true` rows and returns `kind`/`body` fields. New `GET /video-trainings/pharmacist` → `{videoTrainings: [...]}` (same shape, `pharmacist_only=true` rows only), 403 if caller isn't a tagged staff member. Frontend Tasks 6/8/9 call these.

- [ ] **Step 1: Extend `POST /`'s validation and insert**

Replace the existing `videoTrainingsRouter.post('/', ...)` handler body with:

```js
videoTrainingsRouter.post('/', requireAuth, requireScope('supervisor'), async (req, res) => {
  const title = (req.body.title || '').toString().trim();
  const topic = (req.body.topic || '').toString().trim();
  const kind = (req.body.kind || 'video').toString().trim();
  const youtubeUrl = (req.body.youtubeUrl || '').toString().trim();
  const body = (req.body.body || '').toString().trim();
  const pharmacistOnly = !!req.body.pharmacistOnly;
  const hours = parseFloat(req.body.hours);

  if (!['video', 'reading'].includes(kind)) {
    return res.status(400).json({ status: 'error', error: 'Kind must be video or reading.' });
  }
  if (!title || !topic) {
    return res.status(400).json({ status: 'error', error: 'Title and topic are required.' });
  }
  if (kind === 'video') {
    if (!youtubeUrl) {
      return res.status(400).json({ status: 'error', error: 'YouTube link is required.' });
    }
    if (!extractYouTubeId(youtubeUrl)) {
      return res.status(400).json({ status: 'error', error: 'Not a recognized YouTube link (expected a youtube.com/watch?v=... or youtu.be/... URL).' });
    }
  } else if (!body) {
    return res.status(400).json({ status: 'error', error: 'Reading material body is required.' });
  }
  if (!Number.isFinite(hours) || hours <= 0) {
    return res.status(400).json({ status: 'error', error: 'Hours must be a positive number.' });
  }

  const { rows } = await pool.query(
    'insert into video_trainings (title, topic, youtube_url, hours, kind, pharmacist_only, body) values ($1,$2,$3,$4,$5,$6,$7) returning id',
    [title, topic, kind === 'video' ? youtubeUrl : null, hours, kind, pharmacistOnly, kind === 'reading' ? body : null]
  );
  logAuditSafe({
    actorType: req.session.scopeType,
    actorKey: req.session.scopeKey,
    action: 'video_training.add',
    summary: `Added ${kind} training "${title}" (${topic})${pharmacistOnly ? ', pharmacist-only' : ''}`,
  });
  res.json({ status: 'ok', id: rows[0].id });
});
```

- [ ] **Step 2: Filter `GET /` and add `kind`/`body` to its response**

Replace the existing `videoTrainingsRouter.get('/', ...)` handler with:

```js
videoTrainingsRouter.get('/', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    select vt.id, vt.title, vt.topic, vt.youtube_url, vt.hours, vt.kind, vt.body
    from video_trainings vt
    where vt.pharmacist_only = false
      and exists (
        select 1 from video_questions vq
        where vq.topic = vt.topic and vq.status = 'active'
      )
    order by vt.title
  `);
  res.json({
    videoTrainings: rows.map(v => ({
      id: v.id, title: v.title, topic: v.topic, youtubeUrl: v.youtube_url,
      hours: Number(v.hours), kind: v.kind, body: v.body,
    })),
  });
});
```

- [ ] **Step 3: Add the new gated `GET /pharmacist` route**

Add immediately after the `GET /` handler from Step 2:

```js
// Live DB check every request — the client's isPharmacist flag (set at
// login) only controls nav visibility, never authorization. See
// docs/superpowers/specs/2026-08-13-pharmacist-tag-design.md.
videoTrainingsRouter.get('/pharmacist', requireAuth, async (req, res) => {
  const scopeType = req.session.scopeType;
  if (scopeType !== 'staff_retail' && scopeType !== 'staff_warehouse') {
    return res.status(403).json({ status: 'error', error: 'Not authorized.' });
  }
  const [outlet, name] = (req.session.scopeKey || '').split('|');
  const division = scopeType === 'staff_warehouse' ? 'warehouse' : 'retail';
  const { rows: staffRows } = await pool.query(
    'select is_pharmacist from staff_roster where division = $1 and outlet = $2 and name = $3',
    [division, outlet, name]
  );
  if (!staffRows[0]?.is_pharmacist) {
    return res.status(403).json({ status: 'error', error: 'Not authorized.' });
  }

  const { rows } = await pool.query(`
    select vt.id, vt.title, vt.topic, vt.youtube_url, vt.hours, vt.kind, vt.body
    from video_trainings vt
    where vt.pharmacist_only = true
      and exists (
        select 1 from video_questions vq
        where vq.topic = vt.topic and vq.status = 'active'
      )
    order by vt.title
  `);
  res.json({
    videoTrainings: rows.map(v => ({
      id: v.id, title: v.title, topic: v.topic, youtubeUrl: v.youtube_url,
      hours: Number(v.hours), kind: v.kind, body: v.body,
    })),
  });
});
```

- [ ] **Step 4: curl-verify `POST /` validation (reading kind, missing body)**

`curl -s -X POST http://localhost:3000/video-trainings -H "Authorization: Bearer <supervisor token>" -H "Content-Type: application/json" -d '{"title":"Test","topic":"pharmtest","kind":"reading","hours":1}'`
Expected: 400, `{"status":"error","error":"Reading material body is required."}`.

- [ ] **Step 5: curl-verify `POST /` creates a pharmacist-only reading course**

`curl -s -X POST http://localhost:3000/video-trainings -H "Authorization: Bearer <supervisor token>" -H "Content-Type: application/json" -d '{"title":"Test Reading","topic":"pharmtest","kind":"reading","body":"Read this.","hours":1,"pharmacistOnly":true}'`
Expected: 200, `{"status":"ok","id":<n>}`. Note the returned `id` for later steps/cleanup.

- [ ] **Step 6: curl-verify `GET /` never includes the pharmacist-only row**

`curl -s http://localhost:3000/video-trainings -H "Authorization: Bearer <any staff token>"`
Expected: 200, response does NOT contain `"title":"Test Reading"` (it has no `video_questions` yet either, so it'd be excluded either way — repeat this check after Task 9's manual video_questions insert, or accept this as the authoritative check once a question bank exists for `pharmtest`).

- [ ] **Step 7: curl-verify `GET /pharmacist` rejects a non-tagged staff member**

`curl -s http://localhost:3000/video-trainings/pharmacist -H "Authorization: Bearer <staff token, is_pharmacist=false>"`
Expected: 403, `{"status":"error","error":"Not authorized."}`.

- [ ] **Step 8: curl-verify `GET /pharmacist` allows a tagged staff member**

Using Task 2 Step 5's tagged staff row, log that staff member in (`POST /auth/staff-login`), then:
`curl -s http://localhost:3000/video-trainings/pharmacist -H "Authorization: Bearer <tagged staff token>"`
Expected: 200 (empty list is fine if `pharmtest` has no `video_questions` yet — the `exists` join still applies here, matching general Video Training's existing behavior).

- [ ] **Step 9: Clean up test data**

`curl -s -X DELETE http://localhost:3000/video-trainings/<id from Step 5> -H "Authorization: Bearer <supervisor token>"`

- [ ] **Step 10: Commit**

```bash
cd lautan-academy-backend
git add src/routes/videoTraining.js
git commit -m "feat: extend video_trainings routes for pharmacist-gated courses"
```

---

### Task 4: Login response includes the tag (backend)

**Files:**
- Modify: `lautan-academy-backend/src/routes/auth.js`

**Interfaces:**
- Consumes: `staff_roster.is_pharmacist` (Task 1).
- Produces: `POST /auth/staff-login` response gains `isPharmacist: boolean`. Frontend Task 5 stores this.

- [ ] **Step 1: Extend the staff-login query and response**

In `authRouter.post('/staff-login', ...)`, change:

```js
  const { rows } = await pool.query(
    'select pin_hash from staff_roster where division = $1 and outlet = $2 and name = $3',
    [division, outlet, name]
  );
```

to:

```js
  const { rows } = await pool.query(
    'select pin_hash, is_pharmacist from staff_roster where division = $1 and outlet = $2 and name = $3',
    [division, outlet, name]
  );
```

And change:

```js
  await clearFailures(failKey);
  const scopeType = division === 'warehouse' ? 'staff_warehouse' : 'staff_retail';
  const scopeKey = `${outlet}|${name}`;
  const token = await issueToken(scopeType, scopeKey);
  res.json({ authorized: true, token });
```

to:

```js
  await clearFailures(failKey);
  const scopeType = division === 'warehouse' ? 'staff_warehouse' : 'staff_retail';
  const scopeKey = `${outlet}|${name}`;
  const token = await issueToken(scopeType, scopeKey);
  res.json({ authorized: true, token, isPharmacist: match.is_pharmacist });
```

- [ ] **Step 2: curl-verify**

`curl -s -X POST http://localhost:3000/auth/staff-login -H "Content-Type: application/json" -d '{"division":"retail","outlet":"<real outlet>","name":"<Task 2's tagged staff name>","pin":"<their real PIN>"}'`
Expected: 200, `{"authorized":true,"token":"...","isPharmacist":true}`.
Repeat for a non-tagged staff member — expect `"isPharmacist":false`.

- [ ] **Step 3: Commit**

```bash
cd lautan-academy-backend
git add src/routes/auth.js
git commit -m "feat: return isPharmacist on staff login"
```

---

### Task 5: Frontend API client + auth store

**Files:**
- Modify: `lautan-academy-frontend/src/api/client.js`
- Modify: `lautan-academy-frontend/src/store/auth.js`

**Interfaces:**
- Consumes: `POST /auth/staff-login` now returns `isPharmacist` (Task 4); `GET /staff-roster-manage/all`, `PATCH /staff-roster-manage/:id/pharmacist`, `GET /video-trainings/pharmacist` (Tasks 2/3).
- Produces: `api.getAllStaffPharmacistTags()`, `api.setStaffPharmacistTag(id, isPharmacist)`, `api.getPharmacistCourses()`. `auth.staff.isPharmacist` (boolean) available to every component via `useAuthStore()`. Tasks 6/8/9 depend on these exact names.

- [ ] **Step 1: Add the three API methods**

In `lautan-academy-frontend/src/api/client.js`, add after the existing `addVideoTraining` line (currently line 127):

```js
  getAllStaffPharmacistTags: () => request('/staff-roster-manage/all'),
  setStaffPharmacistTag: (id, isPharmacist) =>
    request(`/staff-roster-manage/${id}/pharmacist`, { method: 'PATCH', body: JSON.stringify({ isPharmacist }) }),
  getPharmacistCourses: () => request('/video-trainings/pharmacist'),
```

- [ ] **Step 2: Store `isPharmacist` on login**

In `lautan-academy-frontend/src/store/auth.js`, change the `login()` action:

```js
    async login(division, outlet, name, pin) {
      const data = await api.login(division, outlet, name, pin)
      if (!data.authorized) throw new Error(data.error || 'Login failed')
      this.token = data.token
      this.staff = { name, outlet, division }
      this.manager = null
      localStorage.setItem('lautan_token', data.token)
      localStorage.setItem('lautan_staff', JSON.stringify(this.staff))
      localStorage.removeItem('lautan_manager')
    },
```

to:

```js
    async login(division, outlet, name, pin) {
      const data = await api.login(division, outlet, name, pin)
      if (!data.authorized) throw new Error(data.error || 'Login failed')
      this.token = data.token
      this.staff = { name, outlet, division, isPharmacist: !!data.isPharmacist }
      this.manager = null
      localStorage.setItem('lautan_token', data.token)
      localStorage.setItem('lautan_staff', JSON.stringify(this.staff))
      localStorage.removeItem('lautan_manager')
    },
```

- [ ] **Step 3: Manual verification**

`cd lautan-academy-frontend && npm run build` — expect clean build (no syntax errors from the edits).

- [ ] **Step 4: Commit**

```bash
cd lautan-academy-frontend
git add src/api/client.js src/store/auth.js
git commit -m "feat: add pharmacist-tag API methods, store isPharmacist on login"
```

---

### Task 6: Supervisor Pharmacist tag directory (frontend)

**Files:**
- Create: `lautan-academy-frontend/src/views/SupervisorPharmacistTagView.vue`
- Modify: `lautan-academy-frontend/src/router/index.js`
- Modify: `lautan-academy-frontend/src/components/AppSidebar.vue`
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`
- Modify: `lautan-academy-frontend/src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: `api.getAllStaffPharmacistTags()`, `api.setStaffPharmacistTag(id, isPharmacist)` (Task 5).
- Produces: route `supervisor-pharmacist` at `/supervisor/pharmacist`, nav item under Supervisor's Cross-Outlet group.

- [ ] **Step 1: Write `SupervisorPharmacistTagView.vue`**

```vue
<script setup>
// Company-wide staff directory, Supervisor-only — the only place the
// Pharmacist tag can be set. See
// docs/superpowers/specs/2026-08-13-pharmacist-tag-design.md.
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'

const { t } = useI18n()

const staff = ref([])
const loading = ref(true)
const status = ref('')
const statusOk = ref(true)

async function load() {
  loading.value = true
  try {
    const data = await api.getAllStaffPharmacistTags()
    staff.value = data.staff || []
  } catch (e) { /* leave empty */ }
  loading.value = false
}
load()

async function toggle(row) {
  status.value = ''
  try {
    await api.setStaffPharmacistTag(row.id, !row.isPharmacist)
    await load()
  } catch (err) {
    status.value = err.message || t('supervisorPharmacistTagView.errorUpdateFailed')
    statusOk.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ t('sidebar.roleSupervisor') }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('supervisorPharmacistTagView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <p v-if="status" class="text-sm mb-3" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>
      <div v-if="loading" class="text-slate text-sm">{{ t('supervisorPharmacistTagView.loading') }}</div>
      <div v-else-if="staff.length === 0" class="text-slate text-sm">{{ t('supervisorPharmacistTagView.noStaffYet') }}</div>
      <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
        <div v-for="row in staff" :key="row.id" class="px-5 py-3 flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-medium text-ink truncate">{{ row.name }}<span v-if="row.idNote" class="text-slate font-normal"> ({{ row.idNote }})</span></p>
            <p class="text-xs text-slate">{{ row.outlet }} · {{ row.division }}</p>
          </div>
          <button
            type="button"
            @click="toggle(row)"
            class="text-xs font-medium hover:underline shrink-0"
            :class="row.isPharmacist ? 'text-coral' : 'text-aqua'"
          >
            {{ row.isPharmacist ? t('supervisorPharmacistTagView.untag') : t('supervisorPharmacistTagView.tag') }}
          </button>
        </div>
      </div>
    </main>
  </div>
</template>
```

- [ ] **Step 2: Register the route**

In `lautan-academy-frontend/src/router/index.js`, add the import after line 31 (`import SupervisorManagerAccessView ...`):

```js
import SupervisorPharmacistTagView from '../views/SupervisorPharmacistTagView.vue'
```

Add the route after line 77 (`supervisor-manager-access`):

```js
    { path: '/supervisor/pharmacist', name: 'supervisor-pharmacist', component: SupervisorPharmacistTagView, meta: { requiresAuth: true, role: 'manager', managerRole: 'supervisor' } },
```

- [ ] **Step 3: Add the nav item**

In `lautan-academy-frontend/src/components/AppSidebar.vue`, in the `isSupervisor.value` block's `groupCrossOutlet` items array (currently lines 128-133), add a new entry:

```js
        { label: t('sidebar.allOutlets'), to: '/supervisor', icon: 'grid' },
        { label: t('sidebar.staffComparison'), to: '/supervisor/staff-comparison', icon: 'users' },
        { label: t('sidebar.clusterReports'), to: '/supervisor/reports', icon: 'file' },
        { label: t('sidebar.managerAccess'), to: '/supervisor/manager-access', icon: 'key' },
        { label: t('sidebar.pharmacistTag'), to: '/supervisor/pharmacist', icon: 'users' },
```

- [ ] **Step 4: Add EN/MS locale keys**

In `en.json`, add after the `sidebar` block's `"addResources": "Add Resources",` line:

```json
    "pharmacistTag": "Pharmacist",
```

Add a new top-level block (alongside `supervisorAddResourcesView` etc.):

```json
  "supervisorPharmacistTagView": {
    "title": "Pharmacist",
    "loading": "Loading...",
    "noStaffYet": "No staff on record yet.",
    "tag": "Mark Pharmacist",
    "untag": "Remove Pharmacist",
    "errorUpdateFailed": "Could not update."
  },
```

In `ms.json`, add the matching keys with Malay text:

```json
    "pharmacistTag": "Ahli Farmasi",
```

```json
  "supervisorPharmacistTagView": {
    "title": "Ahli Farmasi",
    "loading": "Memuatkan...",
    "noStaffYet": "Tiada staf direkodkan lagi.",
    "tag": "Tandakan Ahli Farmasi",
    "untag": "Buang Tanda Ahli Farmasi",
    "errorUpdateFailed": "Gagal kemas kini."
  },
```

- [ ] **Step 5: EN/MS key-parity check**

Run:
```bash
cd lautan-academy-frontend
node -e "
const en = require('./src/i18n/locales/en.json');
const ms = require('./src/i18n/locales/ms.json');
function flatten(obj, prefix='') {
  return Object.entries(obj).flatMap(([k,v]) => typeof v === 'object' ? flatten(v, prefix+k+'.') : [prefix+k]);
}
const enKeys = new Set(flatten(en));
const msKeys = new Set(flatten(ms));
const missingInMs = [...enKeys].filter(k => !msKeys.has(k));
const missingInEn = [...msKeys].filter(k => !enKeys.has(k));
console.log('Missing in ms:', missingInMs);
console.log('Missing in en:', missingInEn);
"
```
Expected: both arrays empty.

- [ ] **Step 6: `npm run build`**

Run: `cd lautan-academy-frontend && npm run build`
Expected: clean build.

- [ ] **Step 7: Live browser check**

Start both dev servers, log in as Supervisor, open the new "Pharmacist" nav item, confirm the staff list loads and toggling a row's tag persists after a page refresh.

- [ ] **Step 8: Commit**

```bash
cd lautan-academy-frontend
git add src/views/SupervisorPharmacistTagView.vue src/router/index.js src/components/AppSidebar.vue src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "feat: add supervisor pharmacist tag directory"
```

---

### Task 7: Extend Supervisor's add-course form (frontend)

**Files:**
- Modify: `lautan-academy-frontend/src/views/SupervisorAddResourcesView.vue`
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`
- Modify: `lautan-academy-frontend/src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: extended `POST /video-trainings` (Task 3).
- Produces: no new exported interface — this is a leaf UI change other tasks don't depend on.

- [ ] **Step 1: Add new refs**

In the `<script setup>` block, after the existing `const vHours = ref('1')` line, add:

```js
const vKind = ref('video')
const vBody = ref('')
const vPharmacistOnly = ref(false)
```

- [ ] **Step 2: Update `addVideoTraining()`'s validation and payload**

Replace the existing function body:

```js
async function addVideoTraining() {
  vError.value = ''
  if (!vTitle.value.trim() || !vTopic.value.trim() || !vYoutubeUrl.value.trim()) {
    vError.value = t('supervisorAddResourcesView.videoErrorRequiredFields')
    return
  }
  const hours = parseFloat(vHours.value)
  if (!Number.isFinite(hours) || hours <= 0) {
    vError.value = t('supervisorAddResourcesView.videoErrorBadHours')
    return
  }
  vSaving.value = true
  try {
    await api.addVideoTraining({ title: vTitle.value.trim(), topic: vTopic.value.trim(), youtubeUrl: vYoutubeUrl.value.trim(), hours })
    vTitle.value = ''
    vTopic.value = ''
    vYoutubeUrl.value = ''
    vHours.value = '1'
    await loadVideoTrainings()
  } catch (err) {
    vError.value = err.message || t('supervisorAddResourcesView.videoErrorSaveFailed')
  } finally {
    vSaving.value = false
  }
}
```

with:

```js
async function addVideoTraining() {
  vError.value = ''
  if (!vTitle.value.trim() || !vTopic.value.trim()) {
    vError.value = t('supervisorAddResourcesView.videoErrorRequiredFields')
    return
  }
  if (vKind.value === 'video' && !vYoutubeUrl.value.trim()) {
    vError.value = t('supervisorAddResourcesView.videoErrorRequiredFields')
    return
  }
  if (vKind.value === 'reading' && !vBody.value.trim()) {
    vError.value = t('supervisorAddResourcesView.videoErrorBodyRequired')
    return
  }
  const hours = parseFloat(vHours.value)
  if (!Number.isFinite(hours) || hours <= 0) {
    vError.value = t('supervisorAddResourcesView.videoErrorBadHours')
    return
  }
  vSaving.value = true
  try {
    await api.addVideoTraining({
      title: vTitle.value.trim(),
      topic: vTopic.value.trim(),
      kind: vKind.value,
      youtubeUrl: vKind.value === 'video' ? vYoutubeUrl.value.trim() : '',
      body: vKind.value === 'reading' ? vBody.value.trim() : '',
      hours,
      pharmacistOnly: vPharmacistOnly.value,
    })
    vTitle.value = ''
    vTopic.value = ''
    vYoutubeUrl.value = ''
    vBody.value = ''
    vHours.value = '1'
    vKind.value = 'video'
    vPharmacistOnly.value = false
    await loadVideoTrainings()
  } catch (err) {
    vError.value = err.message || t('supervisorAddResourcesView.videoErrorSaveFailed')
  } finally {
    vSaving.value = false
  }
}
```

- [ ] **Step 3: Add the kind selector, conditional fields, and pharmacist-only checkbox to the template**

Replace the existing video-add `<form>` block:

```html
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
        <div>
          <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorAddResourcesView.videoHoursLabel') }}</label>
          <input v-model="vHours" type="number" step="0.5" min="0.5" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
          <p class="text-xs text-slate mt-1">{{ t('supervisorAddResourcesView.videoHoursHelper') }}</p>
        </div>
        <p v-if="vError" class="text-coral text-sm">{{ vError }}</p>
        <button type="submit" :disabled="vSaving" class="bg-aqua text-white font-medium px-5 py-2.5 rounded-lg disabled:opacity-60">
          {{ vSaving ? t('supervisorAddResourcesView.saving') : t('supervisorAddResourcesView.videoAddEntry') }}
        </button>
      </form>
```

with:

```html
      <form @submit.prevent="addVideoTraining" class="bg-white rounded-xl2 p-5 shadow-sm space-y-3">
        <div>
          <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorAddResourcesView.videoKindLabel') }}</label>
          <select v-model="vKind" class="w-full border border-slate/30 rounded-lg py-2 px-3">
            <option value="video">{{ t('supervisorAddResourcesView.videoKindVideo') }}</option>
            <option value="reading">{{ t('supervisorAddResourcesView.videoKindReading') }}</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorAddResourcesView.titleLabel') }}</label>
          <input v-model="vTitle" type="text" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
        </div>
        <div>
          <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorAddResourcesView.videoTopicLabel') }}</label>
          <input v-model="vTopic" type="text" :placeholder="t('supervisorAddResourcesView.topicPlaceholder')" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
          <p class="text-xs text-slate mt-1">{{ t('supervisorAddResourcesView.videoTopicHelper') }}</p>
        </div>
        <div v-if="vKind === 'video'">
          <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorAddResourcesView.videoLinkLabel') }}</label>
          <input v-model="vYoutubeUrl" type="text" placeholder="https://www.youtube.com/watch?v=..." class="w-full border border-slate/30 rounded-lg py-2 px-3" />
        </div>
        <div v-else>
          <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorAddResourcesView.videoBodyLabel') }}</label>
          <textarea v-model="vBody" rows="4" class="w-full border border-slate/30 rounded-lg py-2 px-3"></textarea>
        </div>
        <div>
          <label class="block text-sm font-medium text-ink mb-1">{{ t('supervisorAddResourcesView.videoHoursLabel') }}</label>
          <input v-model="vHours" type="number" step="0.5" min="0.5" class="w-full border border-slate/30 rounded-lg py-2 px-3" />
          <p class="text-xs text-slate mt-1">{{ t('supervisorAddResourcesView.videoHoursHelper') }}</p>
        </div>
        <label class="flex items-center gap-2 text-sm text-ink">
          <input v-model="vPharmacistOnly" type="checkbox" class="rounded border-slate/30" />
          {{ t('supervisorAddResourcesView.videoPharmacistOnlyLabel') }}
        </label>
        <p v-if="vError" class="text-coral text-sm">{{ vError }}</p>
        <button type="submit" :disabled="vSaving" class="bg-aqua text-white font-medium px-5 py-2.5 rounded-lg disabled:opacity-60">
          {{ vSaving ? t('supervisorAddResourcesView.saving') : t('supervisorAddResourcesView.videoAddEntry') }}
        </button>
      </form>
```

- [ ] **Step 4: Add EN/MS locale keys**

In `en.json`'s `supervisorAddResourcesView` block, add after `"videoErrorBadHours": "Hours must be a positive number."`:

```json
    "videoKindLabel": "Type",
    "videoKindVideo": "YouTube video",
    "videoKindReading": "Reading material",
    "videoBodyLabel": "Reading material text",
    "videoErrorBodyRequired": "Reading material text is required.",
    "videoPharmacistOnlyLabel": "Pharmacist only (shows in the gated Pharmacist Courses section)"
```

In `ms.json`'s matching block, add:

```json
    "videoKindLabel": "Jenis",
    "videoKindVideo": "Video YouTube",
    "videoKindReading": "Bahan bacaan",
    "videoBodyLabel": "Teks bahan bacaan",
    "videoErrorBodyRequired": "Teks bahan bacaan diperlukan.",
    "videoPharmacistOnlyLabel": "Khas Ahli Farmasi (muncul dalam bahagian Kursus Ahli Farmasi terhad)"
```

- [ ] **Step 5: EN/MS key-parity check**

Re-run Task 6 Step 5's parity script. Expected: both arrays empty.

- [ ] **Step 6: `npm run build`**

Run: `cd lautan-academy-frontend && npm run build`
Expected: clean build.

- [ ] **Step 7: Live browser check**

As Supervisor, add a reading-kind pharmacist-only course with a real topic that has an existing `video_questions` bank (or add one manually via Supabase table editor first, matching the existing `standard_questions`/`video_questions` manual-insert convention this codebase already uses). Confirm the form's video/reading fields toggle correctly and the entry saves.

- [ ] **Step 8: Commit**

```bash
cd lautan-academy-frontend
git add src/views/SupervisorAddResourcesView.vue src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "feat: add kind selector and pharmacist-only flag to add-course form"
```

---

### Task 8: Pharmacist Courses list (staff-facing, frontend)

**Files:**
- Create: `lautan-academy-frontend/src/views/PharmacistCoursesListView.vue`
- Modify: `lautan-academy-frontend/src/views/VideoWatchView.vue`
- Modify: `lautan-academy-frontend/src/router/index.js`
- Modify: `lautan-academy-frontend/src/components/AppSidebar.vue`
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`
- Modify: `lautan-academy-frontend/src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: `api.getPharmacistCourses()` (Task 5), `auth.staff.isPharmacist` (Task 5).
- Produces: route `pharmacist-courses` at `/pharmacist-courses`. Each row navigates to `/video-watch/:id` (existing, patched below) for `kind==='video'`, or `/reading-view/:id` (Task 9) for `kind==='reading'`.

**Important — fixes a real bug this task introduces:** `VideoWatchView.vue` currently looks up its video by id from `api.getVideoTrainings()` alone. Task 3 made that endpoint exclude `pharmacist_only=true` rows, so a pharmacist-only *video* course would 404 on its own watch page (the reading-kind path doesn't hit this, since it uses `ReadingView.vue`/`api.getPharmacistCourses()` instead — only the video-kind path reuses `VideoWatchView.vue` unmodified). Step 1 below patches the lookup to fall back to the pharmacist list.

- [ ] **Step 1: Patch `VideoWatchView.vue`'s lookup to fall back to the pharmacist list**

Replace the existing `onMounted` block's video-lookup line:

```js
    const data = await api.getVideoTrainings()
    video.value = (data.videoTrainings || []).find(v => String(v.id) === route.params.id)
    if (!video.value) {
      loadError.value = t('videoWatchView.errorNotFound')
      return
    }
```

with:

```js
    const data = await api.getVideoTrainings()
    let found = (data.videoTrainings || []).find(v => String(v.id) === route.params.id)
    if (!found) {
      // Not in the general list — try the pharmacist-gated list. A 403 here
      // just means this viewer isn't a tagged Pharmacist (or the id truly
      // doesn't exist); either way, falls through to the "not found" error.
      try {
        const pharmData = await api.getPharmacistCourses()
        found = (pharmData.videoTrainings || []).find(v => String(v.id) === route.params.id)
      } catch (e) { /* not authorized or not found — handled below */ }
    }
    video.value = found
    if (!video.value) {
      loadError.value = t('videoWatchView.errorNotFound')
      return
    }
```

- [ ] **Step 2: Write `PharmacistCoursesListView.vue`**

```vue
<script setup>
// Mirrors VideoTrainingListView.vue exactly, but fetches the gated
// pharmacist-only list and routes readings to a different watch page. See
// docs/superpowers/specs/2026-08-13-pharmacist-tag-design.md.
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'

const router = useRouter()
const auth = useAuthStore()
const { t } = useI18n()

const courses = ref([])
const loading = ref(true)

onMounted(async () => {
  try {
    const data = await api.getPharmacistCourses()
    courses.value = data.videoTrainings || []
  } catch (e) { /* leave empty */ }
  loading.value = false
})

function open(course) {
  if (course.kind === 'reading') router.push(`/reading-view/${course.id}`)
  else router.push(`/video-watch/${course.id}`)
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <p class="text-aqualight text-xs">{{ auth.staff?.outlet }}</p>
      <h1 class="font-display text-xl font-semibold text-white">{{ t('pharmacistCoursesListView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <div v-if="loading" class="text-slate text-sm">{{ t('pharmacistCoursesListView.loading') }}</div>
      <div v-else-if="courses.length === 0" class="text-slate text-sm">{{ t('pharmacistCoursesListView.noCoursesYet') }}</div>
      <div v-else class="bg-white rounded-xl2 divide-y divide-seafoam">
        <button
          v-for="c in courses"
          :key="c.id"
          @click="open(c)"
          class="w-full text-left px-5 py-4 flex items-center justify-between gap-3 hover:bg-seafoam/50"
        >
          <div class="min-w-0">
            <p class="text-sm font-medium text-ink truncate">{{ c.title }}</p>
            <p class="text-xs text-slate">{{ c.topic }}</p>
          </div>
          <span class="text-aqua text-sm font-medium shrink-0">
            {{ c.kind === 'reading' ? t('pharmacistCoursesListView.read') : t('pharmacistCoursesListView.watch') }}
          </span>
        </button>
      </div>
    </main>
  </div>
</template>
```

- [ ] **Step 3: Register the route**

In `router/index.js`, add the import after line 15 (`import VideoWatchView ...`):

```js
import PharmacistCoursesListView from '../views/PharmacistCoursesListView.vue'
```

Add the route after line 57 (`video-watch`):

```js
    { path: '/pharmacist-courses', name: 'pharmacist-courses', component: PharmacistCoursesListView, meta: { requiresAuth: true, role: 'staff', division: 'retail' } },
```

- [ ] **Step 4: Add the gated nav item**

In `AppSidebar.vue`'s `auth.isStaff` block, in the `quizItems` array construction (currently lines 64-72), add after the existing `videoTraining` push:

```js
    if (auth.staff?.division === 'retail' && auth.staff?.isPharmacist) {
      quizItems.push({ label: t('sidebar.pharmacistCourses'), to: '/pharmacist-courses', icon: 'clipboard' })
    }
```

- [ ] **Step 5: Add EN/MS locale keys**

In `en.json`'s `sidebar` block, add after `"videoTraining": "Video Training",`:

```json
    "pharmacistCourses": "Pharmacist Courses",
```

Add a new top-level block:

```json
  "pharmacistCoursesListView": {
    "title": "Pharmacist Courses",
    "loading": "Loading...",
    "noCoursesYet": "No pharmacist courses available yet.",
    "watch": "Watch →",
    "read": "Read →"
  },
```

In `ms.json`, add:

```json
    "pharmacistCourses": "Kursus Ahli Farmasi",
```

```json
  "pharmacistCoursesListView": {
    "title": "Kursus Ahli Farmasi",
    "loading": "Memuatkan...",
    "noCoursesYet": "Tiada kursus ahli farmasi lagi.",
    "watch": "Tonton →",
    "read": "Baca →"
  },
```

- [ ] **Step 6: EN/MS key-parity check + `npm run build`**

Re-run Task 6 Step 5's parity script (expect empty) and `npm run build` (expect clean).

- [ ] **Step 7: Live browser check**

Log in as the tagged staff member from Task 2 (must re-login after Task 4/5 shipped, since the flag is set at login) — confirm "Pharmacist Courses" appears in the nav and lists the course added in Task 7, including the pharmacist-only *video* course opening correctly via `/video-watch/:id` (verifies Step 1's fallback fix). Log in as a non-tagged staff member — confirm the nav item is absent.

- [ ] **Step 8: Commit**

```bash
cd lautan-academy-frontend
git add src/views/PharmacistCoursesListView.vue src/views/VideoWatchView.vue src/router/index.js src/components/AppSidebar.vue src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "feat: add gated pharmacist courses list for staff"
```

---

### Task 9: Reading-course watch page (frontend)

**Files:**
- Create: `lautan-academy-frontend/src/views/ReadingView.vue`
- Modify: `lautan-academy-frontend/src/router/index.js`
- Modify: `lautan-academy-frontend/src/i18n/locales/en.json`
- Modify: `lautan-academy-frontend/src/i18n/locales/ms.json`

**Interfaces:**
- Consumes: `api.getPharmacistCourses()` (Task 5, re-fetched to find this course's `body`/`topic` by id — same approach `VideoWatchView.vue` uses for its own video list), `api.getVideoQuestions(topic)` (existing).
- Produces: route `reading-view` at `/reading-view/:id`. On "I've read this", hands off to `/quiz` via the same `sessionStorage` envelope `VideoWatchView.vue` uses.

- [ ] **Step 1: Write `ReadingView.vue`**

```vue
<script setup>
// Reading-kind counterpart to VideoWatchView.vue — "I've read this" replaces
// the YouTube ENDED event as the quiz-unlock gate. Same sessionStorage
// handoff to QuizView.vue, still kind: 'video' in that envelope since
// grading/CPD-hours only key off topic. See
// docs/superpowers/specs/2026-08-13-pharmacist-tag-design.md.
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const course = ref(null)
const loadError = ref('')
const starting = ref(false)

onMounted(async () => {
  try {
    const data = await api.getPharmacistCourses()
    course.value = (data.videoTrainings || []).find(v => String(v.id) === route.params.id)
    if (!course.value) {
      loadError.value = t('readingView.errorNotFound')
    }
  } catch (e) {
    loadError.value = t('readingView.errorNotFound')
  }
})

async function markRead() {
  starting.value = true
  loadError.value = ''
  try {
    const data = await api.getVideoQuestions(course.value.topic)
    const questions = data.questions || []
    if (!questions.length) {
      loadError.value = t('readingView.errorNoQuestions')
      return
    }
    sessionStorage.setItem('lautan_active_quiz', JSON.stringify({ kind: 'video', topic: course.value.topic, questions }))
    router.push('/quiz')
  } catch (e) {
    loadError.value = t('readingView.errorNoQuestions')
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-seafoam">
    <header class="bg-deepsea px-6 py-5">
      <h1 class="font-display text-xl font-semibold text-white">{{ course?.title || t('readingView.title') }}</h1>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8">
      <p v-if="loadError" class="text-coral text-sm mb-4">{{ loadError }}</p>
      <div v-if="course" class="bg-white rounded-xl2 p-5 shadow-sm">
        <p class="text-sm text-ink whitespace-pre-wrap">{{ course.body }}</p>
        <button
          type="button"
          @click="markRead"
          :disabled="starting"
          class="mt-5 bg-aqua text-white font-medium px-5 py-2.5 rounded-lg disabled:opacity-60"
        >
          {{ starting ? t('readingView.starting') : t('readingView.markRead') }}
        </button>
      </div>
    </main>
  </div>
</template>
```

- [ ] **Step 2: Register the route**

In `router/index.js`, add the import after Task 8's `PharmacistCoursesListView` import:

```js
import ReadingView from '../views/ReadingView.vue'
```

Add the route after Task 8's `pharmacist-courses` route:

```js
    { path: '/reading-view/:id', name: 'reading-view', component: ReadingView, meta: { requiresAuth: true, role: 'staff', division: 'retail' } },
```

- [ ] **Step 3: Add EN/MS locale keys**

In `en.json`, add a new top-level block:

```json
  "readingView": {
    "title": "Pharmacist Course",
    "markRead": "I've read this — start the quiz",
    "starting": "Loading quiz...",
    "errorNotFound": "This course could not be found.",
    "errorNoQuestions": "Couldn't load the quiz for this course — refresh and try again."
  },
```

In `ms.json`:

```json
  "readingView": {
    "title": "Kursus Ahli Farmasi",
    "markRead": "Saya telah membaca ini — mula kuiz",
    "starting": "Memuatkan kuiz...",
    "errorNotFound": "Kursus ini tidak ditemui.",
    "errorNoQuestions": "Gagal memuatkan kuiz untuk kursus ini — muat semula dan cuba lagi."
  },
```

- [ ] **Step 4: EN/MS key-parity check + `npm run build`**

Re-run Task 6 Step 5's parity script (expect empty) and `npm run build` (expect clean).

- [ ] **Step 5: Live browser click-through (full end-to-end)**

As the tagged staff member: open Pharmacist Courses → open the reading course from Task 7 → confirm the body text renders → click "I've read this — start the quiz" → confirm it lands on the quiz with real questions → complete the quiz → confirm the result saves and the same 120hr CPD number (Dashboard) increases by the course's set hours.

- [ ] **Step 6: Commit**

```bash
cd lautan-academy-frontend
git add src/views/ReadingView.vue src/router/index.js src/i18n/locales/en.json src/i18n/locales/ms.json
git commit -m "feat: add reading-course watch page with read-then-quiz gate"
```

---

### Task 10: Final whole-feature verification

**Files:** none (verification only)

- [ ] **Step 1: Re-run every curl check from Tasks 2-4 against the final code** (not just right after each task — confirms no later task broke an earlier one, e.g. Task 3's `GET /` filter still excludes pharmacist-only rows after Task 7's form changes).

- [ ] **Step 2: `npm run build` clean, EN/MS parity clean** (final full-file re-check, not per-task).

- [ ] **Step 3: Full live browser click-through** using two real (or disposable test) staff accounts — one tagged Pharmacist, one not:
  - Supervisor tags/untags a staff member in the new directory, confirms it persists.
  - Supervisor adds one video-kind and one reading-kind pharmacist-only course (plus, separately, confirms a normal non-pharmacist video course still works unchanged in general Video Training).
  - Non-tagged staff: confirms no "Pharmacist Courses" nav item, and confirms a direct visit to `/pharmacist-courses` or a raw `GET /video-trainings/pharmacist` call is rejected.
  - Tagged staff (after re-login): sees both courses, completes each, confirms hours land in the existing 120hr CPD number.
  - Confirms general Video Training's own list never shows either pharmacist-only course.

- [ ] **Step 4: Update `MEMORY.md`**

Per this repo's `CLAUDE.md` rule 5, add a `[DONE, NOT PUSHED]` entry to `MEMORY.md` summarizing what shipped (mirror the style of the existing CPD Hours Tracking / Outlet Management entries), and update the `[PENDING] Module quiz question admin` / other pending lines untouched — this sits alongside them as a new completed entry, replacing the old "(B: is_pharmacist tag...) both still unspec'd, not started" note in the CPD Hours Tracking entry with a reference to this plan/spec instead.

- [ ] **Step 5: Prompt the user to `/clear`**

Per `CLAUDE.md` rule 5 — task complete, suggest resetting the session.
