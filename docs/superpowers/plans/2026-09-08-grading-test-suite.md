# Grading Test Suite + CI + Pre-push Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automated tests for the four grading endpoints (`POST /results`, `/ai-results`, `/video-results`, `/content-results`), running against a real disposable Postgres (not a mock), plus a GitHub Actions CI workflow and local pre-push git hooks in both repos.

**Architecture:** A Docker-based disposable Postgres (`docker-compose.test.yml`) gets the real `sql/schema.sql` applied via a small Node script, then `vitest` + `supertest` exercise the Express app (extracted into `src/app.js` so it can be imported without binding a port) directly against that database. The same `.env.test` connection string is reused by a GitHub Actions Postgres service container for CI, and by a `husky` pre-push hook that spins the container up, runs the suite, and tears it down, all before `git push` leaves the machine.

**Tech Stack:** vitest, supertest, husky (backend + frontend), Docker Compose, GitHub Actions, existing `pg`/`express`/`jsonwebtoken` stack (no new production dependencies).

**Spec:** `docs/superpowers/specs/2026-09-08-grading-test-suite-design.md`

## Global Constraints

- Real Postgres via Docker for tests — no mock/in-memory Postgres emulation (spec: "Real Postgres via Docker").
- This phase covers grading endpoints only: `POST /results`, `/ai-results`, `/video-results`, `/content-results` in `src/routes/data.js`. No auth/lockout tests, no frontend tests, no frontend CI workflow.
- Both a local pre-push hook (fast local feedback) and GitHub Actions CI (backstop) — not just one.
- No changes to production code paths beyond the non-behavioral `src/index.js`/`src/app.js` split needed to make the app importable by tests. Any real bug found while writing tests gets flagged to the user, not silently fixed inline.
- New dev dependencies approved: `vitest`, `supertest` (backend only), `husky` (both repos). No other new libraries.
- Repos are separate git repos: `C:\Projects\my-project\LautanAcademy` (frontend, `master`, this task's docs live here) and `C:\Projects\my-project\LautanAcademy\farmasilautancdr-lautan-academy-backend-` (backend, `main`) — all backend-repo file paths below are relative to that nested repo's own root, and its `git add`/`git commit` steps run with that directory as the working copy.

---

## Task 1: Disposable Test Database (Docker Compose + Schema Apply Script)

**Files:**
- Create: `farmasilautancdr-lautan-academy-backend-/docker-compose.test.yml`
- Create: `farmasilautancdr-lautan-academy-backend-/.env.test`
- Create: `farmasilautancdr-lautan-academy-backend-/scripts/apply-test-schema.js`

**Interfaces:**
- Consumes: `sql/schema.sql` (existing, unmodified).
- Produces: a running Postgres reachable at `postgresql://test:test@localhost:5433/lautan_test` with the full app schema applied. Every later task's tests connect here via `.env.test`'s `DATABASE_URL`.

- [ ] **Step 1: Write `docker-compose.test.yml`**

```yaml
services:
  test-db:
    image: postgres:15
    environment:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: lautan_test
    ports:
      - "5433:5432"
    tmpfs:
      - /var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U test -d lautan_test"]
      interval: 2s
      timeout: 3s
      retries: 20
```

`tmpfs` keeps it fully throwaway (no volume, no leftover data between runs). Port `5433` avoids clashing with any local Postgres already using `5432`.

- [ ] **Step 2: Write `.env.test`**

```
DATABASE_URL=postgresql://test:test@localhost:5433/lautan_test
JWT_SECRET=test-jwt-secret-not-for-production-use
PORT=3001
```

No real secret here — fixed local-only Docker credentials, safe to commit (unlike the real `.env`, which stays gitignored).

- [ ] **Step 3: Write `scripts/apply-test-schema.js`**

```js
// One-off: applies sql/schema.sql to whatever DATABASE_URL currently points
// at. Used before running the grading test suite against the disposable
// Docker test database — see
// docs/superpowers/specs/2026-09-08-grading-test-suite-design.md.
// Safe to re-run (schema.sql is entirely create-if-not-exists /
// add-column-if-not-exists).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.test') });

// Dynamic import: must run after dotenv.config() above sets DATABASE_URL,
// since ../src/config/db.js reads it at import time.
const { pool } = await import('../src/config/db.js');

async function main() {
  const schemaPath = path.join(__dirname, '..', 'sql', 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  // Retry loop: right after `docker compose up`, Postgres can report
  // "starting" for a few seconds before actually accepting connections —
  // a single-attempt connect flakes intermittently in that window.
  const maxAttempts = 15;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pool.query(schemaSql);
      console.log('Test schema applied.');
      await pool.end();
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

main().catch((err) => {
  console.error('apply-test-schema failed:', err.message);
  process.exit(1);
});
```

- [ ] **Step 4: Verify manually**

Run (from `farmasilautancdr-lautan-academy-backend-/`):
```bash
docker compose -f docker-compose.test.yml up -d --wait
node scripts/apply-test-schema.js
```
Expected: `Test schema applied.` printed, exit code 0.

Then confirm tables exist:
```bash
docker compose -f docker-compose.test.yml exec -T test-db psql -U test -d lautan_test -c "\dt" 
```
Expected: a table list including `standard_questions`, `video_questions`, `content_questions`, `results`, `wrong_answers`, `ai_results`, `ai_quizzes`, `sessions`.

Tear down:
```bash
docker compose -f docker-compose.test.yml down -v
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.test.yml .env.test scripts/apply-test-schema.js
git commit -m "test: add disposable Docker Postgres + schema apply script"
```

---

## Task 2: Make the Express App Importable for Tests + Install Test Runner

**Files:**
- Create: `farmasilautancdr-lautan-academy-backend-/src/app.js`
- Modify: `farmasilautancdr-lautan-academy-backend-/src/index.js`
- Create: `farmasilautancdr-lautan-academy-backend-/vitest.config.js`
- Create: `farmasilautancdr-lautan-academy-backend-/tests/setup.js`
- Create: `farmasilautancdr-lautan-academy-backend-/tests/health.test.js`
- Modify: `farmasilautancdr-lautan-academy-backend-/package.json`

**Interfaces:**
- Produces: `export const app` from `src/app.js` — an Express app with every route mounted but not listening on a port. Every later test file imports `{ app }` from `../src/app.js` and drives it with `supertest`.

- [ ] **Step 1: Install `vitest` and `supertest` as dev dependencies**

```bash
npm install --save-dev vitest supertest
```

- [ ] **Step 2: Extract `src/app.js` from `src/index.js`**

Current `src/index.js` (for reference — this is what's being split):
```js
import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { authRouter } from './routes/auth.js';
import { quizRouter } from './routes/quiz.js';
import { dataRouter } from './routes/data.js';
import { contentRouter, contentQuestionsRouter } from './routes/content.js';
import { reportsRouter } from './routes/reports.js';
import { staffRouter } from './routes/staff.js';
import { resourcesRouter } from './routes/resources.js';
import { questionsRouter } from './routes/questions.js';
import { videoTrainingsRouter, videoQuestionsRouter } from './routes/videoTraining.js';
import { outletsRouter, areasRouter } from './routes/outlets.js';
import { masterOutletsRouter } from './routes/masterOutlets.js';
import { masterPurgeRouter } from './routes/masterPurge.js';
import { masterAnnualResetRouter } from './routes/masterAnnualReset.js';
import { maintenanceRouter } from './routes/maintenance.js';
import { auditLogRouter } from './routes/auditLog.js';
import { masterBackupRouter } from './routes/masterBackup.js';
import { masterSessionsRouter } from './routes/masterSessions.js';
import { masterImpersonateRouter } from './routes/masterImpersonate.js';
import { pharmacistComplianceRouter } from './routes/pharmacistCompliance.js';
import { startSessionMaintenanceLoop } from './services/sessionRevocationCache.js';
import { checkMaintenance } from './middleware/auth.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use(maintenanceRouter);
app.use('/auth', authRouter);
app.use('/quiz', checkMaintenance, quizRouter);
app.use('/data', checkMaintenance, dataRouter);
app.use('/content', checkMaintenance, contentRouter);
app.use('/content-questions', checkMaintenance, contentQuestionsRouter);
app.use('/reports', checkMaintenance, reportsRouter);
app.use('/staff-roster-manage', checkMaintenance, staffRouter);
app.use('/resources', checkMaintenance, resourcesRouter);
app.use('/questions', checkMaintenance, questionsRouter);
app.use('/video-trainings', checkMaintenance, videoTrainingsRouter);
app.use('/video-questions', checkMaintenance, videoQuestionsRouter);
app.use('/outlets', outletsRouter);
app.use('/areas', areasRouter);
app.use('/master/purge', masterPurgeRouter);
app.use('/master/annual-reset', masterAnnualResetRouter);
app.use('/master/audit-log', auditLogRouter);
app.use('/master/sessions', masterSessionsRouter);
app.use('/master/impersonate', masterImpersonateRouter);
app.use('/master/outlets', masterOutletsRouter);
app.use('/pharmacist-compliance', checkMaintenance, pharmacistComplianceRouter);
app.use(masterBackupRouter);

app.get('/health', (req, res) => res.json({ ok: true }));

startSessionMaintenanceLoop();

app.listen(env.port, () => {
  console.log(`lautan-academy-backend listening on :${env.port}`);
});
```

New `src/app.js` (everything except env/port/listen/the maintenance loop):
```js
import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { quizRouter } from './routes/quiz.js';
import { dataRouter } from './routes/data.js';
import { contentRouter, contentQuestionsRouter } from './routes/content.js';
import { reportsRouter } from './routes/reports.js';
import { staffRouter } from './routes/staff.js';
import { resourcesRouter } from './routes/resources.js';
import { questionsRouter } from './routes/questions.js';
import { videoTrainingsRouter, videoQuestionsRouter } from './routes/videoTraining.js';
import { outletsRouter, areasRouter } from './routes/outlets.js';
import { masterOutletsRouter } from './routes/masterOutlets.js';
import { masterPurgeRouter } from './routes/masterPurge.js';
import { masterAnnualResetRouter } from './routes/masterAnnualReset.js';
import { maintenanceRouter } from './routes/maintenance.js';
import { auditLogRouter } from './routes/auditLog.js';
import { masterBackupRouter } from './routes/masterBackup.js';
import { masterSessionsRouter } from './routes/masterSessions.js';
import { masterImpersonateRouter } from './routes/masterImpersonate.js';
import { pharmacistComplianceRouter } from './routes/pharmacistCompliance.js';
import { checkMaintenance } from './middleware/auth.js';

export const app = express();
app.use(cors());
app.use(express.json());

app.use(maintenanceRouter);
app.use('/auth', authRouter);
app.use('/quiz', checkMaintenance, quizRouter);
app.use('/data', checkMaintenance, dataRouter);
app.use('/content', checkMaintenance, contentRouter);
app.use('/content-questions', checkMaintenance, contentQuestionsRouter);
app.use('/reports', checkMaintenance, reportsRouter);
app.use('/staff-roster-manage', checkMaintenance, staffRouter);
app.use('/resources', checkMaintenance, resourcesRouter);
app.use('/questions', checkMaintenance, questionsRouter);
app.use('/video-trainings', checkMaintenance, videoTrainingsRouter);
app.use('/video-questions', checkMaintenance, videoQuestionsRouter);
app.use('/outlets', outletsRouter);
app.use('/areas', areasRouter);
app.use('/master/purge', masterPurgeRouter);
app.use('/master/annual-reset', masterAnnualResetRouter);
app.use('/master/audit-log', auditLogRouter);
app.use('/master/sessions', masterSessionsRouter);
app.use('/master/impersonate', masterImpersonateRouter);
app.use('/master/outlets', masterOutletsRouter);
app.use('/pharmacist-compliance', checkMaintenance, pharmacistComplianceRouter);
app.use(masterBackupRouter);

app.get('/health', (req, res) => res.json({ ok: true }));
```

- [ ] **Step 3: Rewrite `src/index.js`**

```js
import { app } from './app.js';
import { env } from './config/env.js';
import { startSessionMaintenanceLoop } from './services/sessionRevocationCache.js';

startSessionMaintenanceLoop();

app.listen(env.port, () => {
  console.log(`lautan-academy-backend listening on :${env.port}`);
});
```

- [ ] **Step 4: Verify the split didn't change runtime behavior**

Run (with a real `.env` present, as before):
```bash
npm start
```
In another terminal:
```bash
curl http://localhost:3000/health
```
Expected: `{"ok":true}`, and the startup log line unchanged. Stop the server after confirming.

- [ ] **Step 5: Write `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.js'],
    fileParallelism: false,
  },
});
```

`fileParallelism: false` serializes test files — several later test files share the same `sessions`/`results`/etc. tables via unique-per-test topic/outlet values, but serializing removes any risk of cross-file connection-pool contention against the single small test container.

- [ ] **Step 6: Write `tests/setup.js`**

```js
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.test') });
```

Vitest runs `setupFiles` to completion before a test file's own imports execute, so by the time `tests/health.test.js` imports `src/app.js` (which imports `src/config/env.js`, which does `import 'dotenv/config'`), `DATABASE_URL`/`JWT_SECRET` are already set from `.env.test` — `dotenv` never overwrites an already-set variable, so the test values win.

- [ ] **Step 7: Write the failing smoke test — `tests/health.test.js`**

```js
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';

describe('GET /health', () => {
  it('returns ok: true', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 8: Add `test`/`pretest` scripts to `package.json`**

Add to the `"scripts"` block:
```json
"pretest": "node scripts/apply-test-schema.js",
"test": "vitest run"
```

- [ ] **Step 9: Start the test DB and run the test**

```bash
docker compose -f docker-compose.test.yml up -d --wait
npm test
```
Expected: `pretest` prints `Test schema applied.`, then vitest reports 1 passed test (`GET /health > returns ok: true`).

- [ ] **Step 10: Tear down and commit**

```bash
docker compose -f docker-compose.test.yml down -v
git add src/app.js src/index.js vitest.config.js tests/setup.js tests/health.test.js package.json package-lock.json
git commit -m "test: extract testable app.js, add vitest+supertest smoke test"
```

---

## Task 3: Test Helpers (Seeding, Token Minting, Cleanup)

**Files:**
- Create: `farmasilautancdr-lautan-academy-backend-/tests/helpers/db.js`
- Test: `farmasilautancdr-lautan-academy-backend-/tests/helpers/db.test.js`

**Interfaces:**
- Consumes: `pool` from `../../src/config/db.js`, `issueToken` from `../../src/middleware/auth.js`.
- Produces (used by every grading test file from Task 4 onward):
  - `uniqueTopic(prefix = 'TESTTOPIC') -> string`
  - `uniqueOutlet(prefix = 'TESTOUTLET') -> string`
  - `insertStandardQuestions(topic, questions) -> Promise<string[]>` (returns inserted row ids, in input order)
  - `insertVideoQuestions(topic, questions) -> Promise<string[]>`
  - `insertContentQuestions(topic, questions) -> Promise<string[]>`
  - `insertAiQuiz(outlet, passcode, topic, questions) -> Promise<void>`
  - `mintStaffToken(scopeType, outlet, name) -> Promise<string>` (JWT)
  - `cleanupByOutlet(outlet) -> Promise<void>`
  - `cleanupByTopic(topic) -> Promise<void>`

  Each `questions` entry has the shape `{ questionEn, questionMs, opt1En, opt2En, opt3En, opt4En, opt1Ms, opt2Ms, opt3Ms, opt4Ms, correct }`.

- [ ] **Step 1: Write the failing test — `tests/helpers/db.test.js`**

```js
import { describe, it, expect } from 'vitest';
import {
  uniqueTopic, uniqueOutlet, insertStandardQuestions, cleanupByTopic,
} from './db.js';
import { pool } from '../../src/config/db.js';

describe('test db helpers', () => {
  it('insertStandardQuestions inserts rows and returns their real (string) ids', async () => {
    const topic = uniqueTopic();
    const ids = await insertStandardQuestions(topic, [
      { questionEn: 'Q1', questionMs: 'S1', opt1En: 'A', opt2En: 'B', opt3En: 'C', opt4En: 'D', opt1Ms: 'A', opt2Ms: 'B', opt3Ms: 'C', opt4Ms: 'D', correct: 0 },
    ]);
    expect(ids).toHaveLength(1);
    // bigserial comes back as a string from node-pg — the helper must not
    // coerce it, since the whole point of these tests is exercising that
    // real behavior (see standard_questions.id lesson in project memory).
    expect(typeof ids[0]).toBe('string');

    const { rows } = await pool.query('select topic from standard_questions where id=$1', [ids[0]]);
    expect(rows[0].topic).toBe(topic);

    await cleanupByTopic(topic);
    const after = await pool.query('select id from standard_questions where topic=$1', [topic]);
    expect(after.rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
docker compose -f docker-compose.test.yml up -d --wait
npm test
```
Expected: FAIL — `tests/helpers/db.js` doesn't exist yet.

- [ ] **Step 3: Write `tests/helpers/db.js`**

```js
import { randomUUID } from 'crypto';
import { pool } from '../../src/config/db.js';
import { issueToken } from '../../src/middleware/auth.js';

export function uniqueTopic(prefix = 'TESTTOPIC') {
  return `${prefix}_${randomUUID()}`;
}

export function uniqueOutlet(prefix = 'TESTOUTLET') {
  return `${prefix}${randomUUID().slice(0, 8)}`.toUpperCase();
}

async function insertQuestions(table, topic, questions) {
  const ids = [];
  for (const q of questions) {
    const { rows } = await pool.query(
      `insert into ${table}
        (topic, question_en, question_ms, opt1_en, opt2_en, opt3_en, opt4_en, opt1_ms, opt2_ms, opt3_ms, opt4_ms, correct)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       returning id`,
      [topic, q.questionEn, q.questionMs, q.opt1En, q.opt2En, q.opt3En, q.opt4En, q.opt1Ms, q.opt2Ms, q.opt3Ms, q.opt4Ms, q.correct]
    );
    ids.push(rows[0].id);
  }
  return ids;
}

// table name is always one of 3 fixed literals below, never user input.
export const insertStandardQuestions = (topic, questions) => insertQuestions('standard_questions', topic, questions);
export const insertVideoQuestions = (topic, questions) => insertQuestions('video_questions', topic, questions);
export const insertContentQuestions = (topic, questions) => insertQuestions('content_questions', topic, questions);

export async function insertAiQuiz(outlet, passcode, topic, questions) {
  await pool.query(
    `insert into ai_quizzes (outlet, passcode, topic, count, questions_json) values ($1,$2,$3,$4,$5)`,
    [outlet, passcode, topic, questions.length, JSON.stringify(questions)]
  );
}

export async function mintStaffToken(scopeType, outlet, name) {
  return issueToken(scopeType, `${outlet}|${name}`);
}

export async function cleanupByOutlet(outlet) {
  await pool.query('delete from wrong_answers where outlet=$1', [outlet]);
  await pool.query('delete from results where outlet=$1', [outlet]);
  await pool.query('delete from ai_wrong_answers where outlet=$1', [outlet]);
  await pool.query('delete from ai_results where outlet=$1', [outlet]);
  await pool.query('delete from ai_quizzes where outlet=$1', [outlet]);
  await pool.query('delete from sessions where scope_key like $1', [`${outlet}|%`]);
}

export async function cleanupByTopic(topic) {
  await pool.query('delete from standard_questions where topic=$1', [topic]);
  await pool.query('delete from video_questions where topic=$1', [topic]);
  await pool.query('delete from content_questions where topic=$1', [topic]);
}
```

- [ ] **Step 4: Run the test again to verify it passes**

```bash
npm test
```
Expected: PASS.

- [ ] **Step 5: Tear down and commit**

```bash
docker compose -f docker-compose.test.yml down -v
git add tests/helpers/db.js tests/helpers/db.test.js
git commit -m "test: add seeding/token/cleanup helpers for grading tests"
```

---

## Task 4: `POST /data/results` Grading Tests

**Files:**
- Create: `farmasilautancdr-lautan-academy-backend-/tests/grading.results.test.js`

**Interfaces:**
- Consumes: `app` (Task 2), helpers from Task 3.

- [ ] **Step 1: Write `tests/grading.results.test.js`**

```js
import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/config/db.js';
import {
  uniqueTopic, uniqueOutlet, insertStandardQuestions, mintStaffToken,
  cleanupByOutlet, cleanupByTopic,
} from './helpers/db.js';

const NAME = 'JOHN';

const twoQuestions = [
  { questionEn: 'Q1 En', questionMs: 'Q1 Ms', opt1En: 'A', opt2En: 'B', opt3En: 'C', opt4En: 'D', opt1Ms: 'A', opt2Ms: 'B', opt3Ms: 'C', opt4Ms: 'D', correct: 0 },
  { questionEn: 'Q2 En', questionMs: 'Q2 Ms', opt1En: 'A', opt2En: 'B', opt3En: 'C', opt4En: 'D', opt1Ms: 'A', opt2Ms: 'B', opt3Ms: 'C', opt4Ms: 'D', correct: 1 },
];

describe('POST /data/results', () => {
  let topic;
  let outlet;

  afterEach(async () => {
    await cleanupByOutlet(outlet);
    await cleanupByTopic(topic);
  });

  async function setup(questions = twoQuestions) {
    topic = uniqueTopic();
    outlet = uniqueOutlet();
    const ids = await insertStandardQuestions(topic, questions);
    const token = await mintStaffToken('staff_retail', outlet, NAME);
    return { ids, token };
  }

  it('ignores an unknown extra id in the submitted answers array', async () => {
    const { ids, token } = await setup();
    const res = await request(app)
      .post('/data/results')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outlet, name: NAME, topic,
        answers: [
          { id: ids[0], chosen: 0 },
          { id: ids[1], chosen: 1 },
          { id: '999999999', chosen: 3 }, // not a real question id
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', score: 2, total: 2, percentage: 100 });
  });

  it('grades an omitted question as wrong instead of shrinking the total', async () => {
    const { ids, token } = await setup();
    const res = await request(app)
      .post('/data/results')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outlet, name: NAME, topic,
        answers: [{ id: ids[0], chosen: 0 }], // ids[1] never answered
      });
    expect(res.status).toBe(200);
    // total must stay 2 (DB question count), not 1 (submitted array length).
    expect(res.body).toEqual({ status: 'ok', score: 1, total: 2, percentage: 50 });
  });

  it('uses the last submitted value when the client sends a duplicate id', async () => {
    const { ids, token } = await setup();
    const res = await request(app)
      .post('/data/results')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outlet, name: NAME, topic,
        answers: [
          { id: ids[0], chosen: 0 }, // correct, but overwritten below
          { id: ids[0], chosen: 1 }, // wrong — this is the one that counts
          { id: ids[1], chosen: 1 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', score: 1, total: 2, percentage: 50 });
  });

  it('grades correctly when the DB id is a string and the client sends it as a JSON number (regression: standard_questions.id string/int mismatch)', async () => {
    const { ids, token } = await setup();
    expect(typeof ids[0]).toBe('string');
    const res = await request(app)
      .post('/data/results')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outlet, name: NAME, topic,
        answers: [
          { id: Number(ids[0]), chosen: 0 },
          { id: Number(ids[1]), chosen: 1 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', score: 2, total: 2, percentage: 100 });
  });

  it('writes a bilingual wrong_answers row for each incorrect answer', async () => {
    const { ids, token } = await setup();
    await request(app)
      .post('/data/results')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outlet, name: NAME, topic,
        answers: [
          { id: ids[0], chosen: 1 }, // wrong (correct is 0)
          { id: ids[1], chosen: 1 }, // correct
        ],
      });
    const { rows } = await pool.query('select * from wrong_answers where outlet=$1 and topic=$2', [outlet, topic]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      question_en: 'Q1 En', question_ms: 'Q1 Ms',
      chosen_en: 'B', chosen_ms: 'B',
      correct_en: 'A', correct_ms: 'A',
    });
  });

  it('returns the cached prior score on a same-day resubmission without inserting a new row', async () => {
    const { ids, token } = await setup();
    const first = await request(app)
      .post('/data/results')
      .set('Authorization', `Bearer ${token}`)
      .send({ outlet, name: NAME, topic, answers: [{ id: ids[0], chosen: 0 }, { id: ids[1], chosen: 1 }] });
    expect(first.body).toEqual({ status: 'ok', score: 2, total: 2, percentage: 100 });

    const second = await request(app)
      .post('/data/results')
      .set('Authorization', `Bearer ${token}`)
      .send({ outlet, name: NAME, topic, answers: [{ id: ids[0], chosen: 1 }, { id: ids[1], chosen: 0 }] }); // deliberately different, should be ignored
    expect(second.body).toEqual({ status: 'ok', score: 2, total: 2, percentage: 100 });

    const { rows } = await pool.query('select count(*)::int as n from results where outlet=$1 and topic=$2', [outlet, topic]);
    expect(rows[0].n).toBe(1);
  });

  it('returns 403 when the session scope does not match the submitted outlet/name', async () => {
    const { ids } = await setup();
    const wrongToken = await mintStaffToken('staff_retail', outlet, 'SOMEONE_ELSE');
    const res = await request(app)
      .post('/data/results')
      .set('Authorization', `Bearer ${wrongToken}`)
      .send({ outlet, name: NAME, topic, answers: [{ id: ids[0], chosen: 0 }] });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run and verify all pass**

```bash
docker compose -f docker-compose.test.yml up -d --wait
npm test
```
Expected: all 7 new tests in `POST /data/results` pass. If any fail unexpectedly (not because of a typo in the test), stop and report the failure to the user before changing production code — this phase is test-writing, not bug-fixing.

- [ ] **Step 3: Tear down and commit**

```bash
docker compose -f docker-compose.test.yml down -v
git add tests/grading.results.test.js
git commit -m "test: cover POST /data/results grading logic"
```

---

## Task 5: `POST /data/ai-results` Grading Tests

**Files:**
- Create: `farmasilautancdr-lautan-academy-backend-/tests/grading.aiResults.test.js`

**Interfaces:**
- Consumes: `app` (Task 2), helpers from Task 3.

- [ ] **Step 1: Write `tests/grading.aiResults.test.js`**

```js
import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/config/db.js';
import { uniqueTopic, uniqueOutlet, insertAiQuiz, mintStaffToken, cleanupByOutlet } from './helpers/db.js';

const NAME = 'JOHN';

const twoQuestions = [
  { question_en: 'Q1 En', question_ms: 'Q1 Ms', opt1_en: 'A', opt2_en: 'B', opt3_en: 'C', opt4_en: 'D', opt1_ms: 'A', opt2_ms: 'B', opt3_ms: 'C', opt4_ms: 'D', correct: 0 },
  { question_en: 'Q2 En', question_ms: 'Q2 Ms', opt1_en: 'A', opt2_en: 'B', opt3_en: 'C', opt4_en: 'D', opt1_ms: 'A', opt2_ms: 'B', opt3_ms: 'C', opt4_ms: 'D', correct: 1 },
];

describe('POST /data/ai-results', () => {
  let outlet;
  let topic;

  afterEach(async () => {
    await cleanupByOutlet(outlet);
  });

  async function setup(questions = twoQuestions, passcode = '1234') {
    outlet = uniqueOutlet();
    topic = uniqueTopic();
    await insertAiQuiz(outlet, passcode, topic, questions);
    const token = await mintStaffToken('staff_retail', outlet, NAME);
    return { token, passcode };
  }

  it('ignores an unknown extra index in the submitted answers array', async () => {
    const { token, passcode } = await setup();
    const res = await request(app)
      .post('/data/ai-results')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outlet, name: NAME, topic, passcode,
        answers: [{ index: 0, chosen: 0 }, { index: 1, chosen: 1 }, { index: 99, chosen: 2 }],
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', score: 2, total: 2, percentage: 100 });
  });

  it('grades an omitted index as wrong instead of shrinking the total', async () => {
    const { token, passcode } = await setup();
    const res = await request(app)
      .post('/data/ai-results')
      .set('Authorization', `Bearer ${token}`)
      .send({ outlet, name: NAME, topic, passcode, answers: [{ index: 0, chosen: 0 }] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', score: 1, total: 2, percentage: 50 });
  });

  it('returns 410 when the outlet\'s ai_quizzes row is gone (regenerated or expired)', async () => {
    const { token } = await setup();
    const res = await request(app)
      .post('/data/ai-results')
      .set('Authorization', `Bearer ${token}`)
      .send({ outlet, name: NAME, topic, passcode: 'WRONG-CODE', answers: [{ index: 0, chosen: 0 }] });
    expect(res.status).toBe(410);
  });

  it('returns the cached prior score on a same-day resubmission without inserting a new row', async () => {
    const { token, passcode } = await setup();
    const first = await request(app)
      .post('/data/ai-results')
      .set('Authorization', `Bearer ${token}`)
      .send({ outlet, name: NAME, topic, passcode, answers: [{ index: 0, chosen: 0 }, { index: 1, chosen: 1 }] });
    expect(first.body).toEqual({ status: 'ok', score: 2, total: 2, percentage: 100 });

    const second = await request(app)
      .post('/data/ai-results')
      .set('Authorization', `Bearer ${token}`)
      .send({ outlet, name: NAME, topic, passcode, answers: [{ index: 0, chosen: 1 }] });
    expect(second.body).toEqual({ status: 'ok', score: 2, total: 2, percentage: 100 });

    const { rows } = await pool.query('select count(*)::int as n from ai_results where outlet=$1 and passcode=$2', [outlet, passcode]);
    expect(rows[0].n).toBe(1);
  });

  it('returns 403 when the session scope does not match the submitted outlet/name', async () => {
    const { passcode } = await setup();
    const wrongToken = await mintStaffToken('staff_retail', outlet, 'SOMEONE_ELSE');
    const res = await request(app)
      .post('/data/ai-results')
      .set('Authorization', `Bearer ${wrongToken}`)
      .send({ outlet, name: NAME, topic, passcode, answers: [{ index: 0, chosen: 0 }] });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run and verify all pass**

```bash
docker compose -f docker-compose.test.yml up -d --wait
npm test
```
Expected: all 5 new tests pass.

- [ ] **Step 3: Tear down and commit**

```bash
docker compose -f docker-compose.test.yml down -v
git add tests/grading.aiResults.test.js
git commit -m "test: cover POST /data/ai-results grading logic"
```

---

## Task 6: `POST /data/video-results` and `POST /data/content-results` Grading Tests

**Files:**
- Create: `farmasilautancdr-lautan-academy-backend-/tests/grading.videoAndContentResults.test.js`

**Interfaces:**
- Consumes: `app` (Task 2), helpers from Task 3 (`insertVideoQuestions`, `insertContentQuestions`, and the rest from Task 3).

Both endpoints are near-identical copies of `POST /results`' logic (per `src/routes/data.js`'s own comments), reading from `video_questions`/`content_questions` instead of `standard_questions`. Per spec, this task covers the two cases where a shared bug already bit the project (ignoring extra client ids, DB-string-id vs client-number-id) plus one happy-path check per endpoint — full same-day/403/wrong_answers coverage already exists for the shared logic via Task 4.

- [ ] **Step 1: Write `tests/grading.videoAndContentResults.test.js`**

```js
import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import {
  uniqueTopic, uniqueOutlet, insertVideoQuestions, insertContentQuestions,
  mintStaffToken, cleanupByOutlet, cleanupByTopic,
} from './helpers/db.js';

const NAME = 'JOHN';

const twoQuestions = [
  { questionEn: 'Q1 En', questionMs: 'Q1 Ms', opt1En: 'A', opt2En: 'B', opt3En: 'C', opt4En: 'D', opt1Ms: 'A', opt2Ms: 'B', opt3Ms: 'C', opt4Ms: 'D', correct: 0 },
  { questionEn: 'Q2 En', questionMs: 'Q2 Ms', opt1En: 'A', opt2En: 'B', opt3En: 'C', opt4En: 'D', opt1Ms: 'A', opt2Ms: 'B', opt3Ms: 'C', opt4Ms: 'D', correct: 1 },
];

function runSharedGradingCases(endpoint, insertQuestions) {
  describe(`POST ${endpoint}`, () => {
    let topic;
    let outlet;

    afterEach(async () => {
      await cleanupByOutlet(outlet);
      await cleanupByTopic(topic);
    });

    async function setup() {
      topic = uniqueTopic();
      outlet = uniqueOutlet();
      const ids = await insertQuestions(topic, twoQuestions);
      const token = await mintStaffToken('staff_retail', outlet, NAME);
      return { ids, token };
    }

    it('grades correctly and ignores an unknown extra id in the submitted answers array', async () => {
      const { ids, token } = await setup();
      const res = await request(app)
        .post(endpoint)
        .set('Authorization', `Bearer ${token}`)
        .send({
          outlet, name: NAME, topic,
          answers: [{ id: ids[0], chosen: 0 }, { id: ids[1], chosen: 1 }, { id: '999999999', chosen: 3 }],
        });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', score: 2, total: 2, percentage: 100 });
    });

    it('grades correctly when the DB id is a string and the client sends it as a JSON number', async () => {
      const { ids, token } = await setup();
      expect(typeof ids[0]).toBe('string');
      const res = await request(app)
        .post(endpoint)
        .set('Authorization', `Bearer ${token}`)
        .send({ outlet, name: NAME, topic, answers: [{ id: Number(ids[0]), chosen: 0 }, { id: Number(ids[1]), chosen: 1 }] });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', score: 2, total: 2, percentage: 100 });
    });

    it('returns 404 when no active questions exist for the topic', async () => {
      outlet = uniqueOutlet();
      topic = uniqueTopic(); // never seeded
      const token = await mintStaffToken('staff_retail', outlet, NAME);
      const res = await request(app)
        .post(endpoint)
        .set('Authorization', `Bearer ${token}`)
        .send({ outlet, name: NAME, topic, answers: [] });
      expect(res.status).toBe(404);
    });
  });
}

runSharedGradingCases('/data/video-results', insertVideoQuestions);
runSharedGradingCases('/data/content-results', insertContentQuestions);
```

- [ ] **Step 2: Run and verify all pass**

```bash
docker compose -f docker-compose.test.yml up -d --wait
npm test
```
Expected: all 6 new tests pass (3 per endpoint).

- [ ] **Step 3: Tear down and commit**

```bash
docker compose -f docker-compose.test.yml down -v
git add tests/grading.videoAndContentResults.test.js
git commit -m "test: cover POST /data/video-results and /data/content-results grading logic"
```

---

## Task 7: GitHub Actions CI Workflow (Backend)

**Files:**
- Create: `farmasilautancdr-lautan-academy-backend-/.github/workflows/test.yml`

**Interfaces:**
- Consumes: `.env.test` (Task 1), `package.json`'s `test`/`pretest` scripts (Task 2).

- [ ] **Step 1: Write `.github/workflows/test.yml`**

```yaml
name: Backend Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: lautan_test
        ports:
          - 5433:5432
        options: >-
          --health-cmd "pg_isready -U test -d lautan_test"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm test
```

This reuses the same `5433` port and `test`/`test`/`lautan_test` credentials as `docker-compose.test.yml`, so the committed `.env.test` works unchanged in CI — no extra secrets or env wiring needed.

- [ ] **Step 2: Verify the YAML is well-formed**

```bash
node -e "console.log(require('js-yaml') ? '' : '')" 2>/dev/null; python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/test.yml'))" 2>&1 || node -e "const fs=require('fs'); fs.readFileSync('.github/workflows/test.yml','utf8')"
```
(If neither `python3`'s `yaml` module nor Node is convenient, visually re-check indentation — this is a simple sanity check, not a strict requirement.) Real verification happens on the next push to `main`/next PR: confirm the "Backend Tests" check appears and goes green.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: run grading test suite on push/PR via GitHub Actions"
```

---

## Task 8: Backend Pre-push Hook (Husky)

**Files:**
- Create: `farmasilautancdr-lautan-academy-backend-/.husky/pre-push`
- Modify: `farmasilautancdr-lautan-academy-backend-/package.json`

**Interfaces:**
- Consumes: `docker-compose.test.yml` (Task 1), `npm test` (Task 2).

- [ ] **Step 1: Install husky**

```bash
npm install --save-dev husky
```

- [ ] **Step 2: Add the `prepare` script to `package.json`**

Add to `"scripts"`:
```json
"prepare": "husky"
```

Run it once to initialize `.husky/` and set `core.hooksPath`:
```bash
npx husky
```

- [ ] **Step 3: Write `.husky/pre-push`**

```sh
#!/usr/bin/env sh
set -e

echo "Starting disposable test database..."
docker compose -f docker-compose.test.yml up -d --wait

npm test
status=$?

echo "Stopping test database..."
docker compose -f docker-compose.test.yml down -v

exit $status
```

Make it executable:
```bash
chmod +x .husky/pre-push
```

- [ ] **Step 4: Verify it blocks on failure and passes on success**

Temporarily break a test (e.g. change an `expect(...).toBe(100)` to `101` in `tests/grading.results.test.js`), then:
```bash
git add -A
git commit -m "temp: break a test to verify pre-push hook"
git push --dry-run
```
Expected: the hook runs, `npm test` fails, `git push` is blocked with the test failure output shown.

Revert the temporary breakage:
```bash
git reset --soft HEAD~1
git checkout -- tests/grading.results.test.js
```

Then verify the real, working suite passes the hook:
```bash
git push --dry-run
```
Expected: hook runs, all tests pass, dry-run push proceeds (no actual push happens with `--dry-run`).

- [ ] **Step 5: Commit**

```bash
git add .husky/pre-push package.json package-lock.json
git commit -m "chore: add husky pre-push hook running grading tests"
```

---

## Task 9: Frontend Pre-push Hook (Husky, Build Only)

The frontend git repo's root is `C:\Projects\my-project\LautanAcademy` itself (confirmed via `git rev-parse --show-toplevel`) — but the buildable Vue app, and its `package.json`/`npm run build`, live one level down in `lautan-academy-frontend/`, and there is no `package.json` at the repo root today. Git hooks (`core.hooksPath`) must be anchored at the repo root, not a subfolder, so this task adds a small root-level `package.json` whose only jobs are hosting `husky` and delegating `build` into the subfolder — it does not touch or duplicate `lautan-academy-frontend/package.json`.

**Files:**
- Create: `package.json` (repo root)
- Modify: `.gitignore` (repo root)
- Create: `.husky/pre-push` (repo root)

**Interfaces:**
- Consumes: `lautan-academy-frontend/package.json`'s existing `build` script (unchanged).

- [ ] **Step 1: Add `node_modules` to the root `.gitignore`**

Append to `.gitignore`:
```
node_modules/
```

- [ ] **Step 2: Create a minimal root `package.json`**

```json
{
  "name": "lautan-academy-repo-tooling",
  "private": true,
  "version": "1.0.0",
  "scripts": {
    "build": "cd lautan-academy-frontend && npm run build",
    "prepare": "husky"
  },
  "devDependencies": {}
}
```

- [ ] **Step 3: Install husky at the repo root**

```bash
npm install --save-dev husky
```

- [ ] **Step 4: Initialize husky**

```bash
npx husky
```
This creates `.husky/` at the repo root and points git's `core.hooksPath` there.

- [ ] **Step 5: Write `.husky/pre-push`**

```sh
#!/usr/bin/env sh
set -e

npm run build
```

Make it executable:
```bash
chmod +x .husky/pre-push
```

- [ ] **Step 6: Verify it blocks on a build failure and passes on success**

Temporarily introduce a syntax error into any `.vue` file under `lautan-academy-frontend/`, then:
```bash
git add -A
git commit -m "temp: break build to verify pre-push hook"
git push --dry-run
```
Expected: hook runs, `cd lautan-academy-frontend && npm run build` fails, push is blocked.

Revert:
```bash
git reset --soft HEAD~1
git checkout -- lautan-academy-frontend/<the file you broke>
```

Verify the real build passes the hook:
```bash
git push --dry-run
```
Expected: hook runs, build succeeds, dry-run push proceeds.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore .husky/pre-push
git commit -m "chore: add husky pre-push hook running production build"
```

---

## Post-plan note

This closes the "grading first" slice of the broader `[PENDING]` "Automated test suite" backlog item in `MEMORY.md`. Remaining, explicitly deferred: auth/lockout backend tests, frontend `vitest`+`@vue/test-utils`, and a frontend CI workflow — each is its own future brainstorm→spec→plan cycle, not part of this plan.
