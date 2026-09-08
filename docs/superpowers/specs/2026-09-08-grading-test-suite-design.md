# Grading Test Suite + CI + Pre-push Hooks — Design

**Date:** 2026-09-08
**Status:** Approved, pending plan

## Purpose

No automated test exists in either repo today (frontend has zero test
framework; backend has zero too). Two real production bugs already shipped
through this gap and were only caught after the fact:

- `standard_questions.id` string/int mismatch caused 0 scoring for every
  submission (node-pg returns bigserial as a string; grading code compared
  it against a numeric client value without coercion).
- Grading trusted a client-submitted answer array instead of the DB's
  authoritative question count/set — a tamperable and/or wrong-count grade.

Both were caught by manual click-through or a lucky ad-hoc review, not by
any repeatable check. This is phase 1 of the broader "Automated test suite"
backlog item ([[project_lautan_academy]] MEMORY.md `[PENDING]`): grading
logic only, backend only. Frontend `vitest`+`@vue/test-utils`, auth/lockout
tests, and a frontend CI workflow are explicitly deferred to a later phase.

## Scope decisions (from brainstorming)

- **Real Postgres via Docker**, not a mock/emulation (`pg-mem` rejected).
  Both shipped bugs were exactly the kind of real-driver-behavior quirk
  (bigserial-as-string) a Postgres emulation could plausibly paper over —
  the whole point of this suite is to catch that class of bug again.
- **Grading endpoints only, this phase**: `POST /results`, `POST
  /ai-results`, `POST /video-results` (and `content-results` if it turns
  out to be a fourth distinct handler, confirm during planning) in
  `src/routes/data.js`. No auth/lockout tests, no frontend tests yet.
- **Both a local pre-push hook and CI**, not just one. Pre-push (via
  husky) gives fast local feedback before code ever leaves the machine;
  CI (GitHub Actions) is the backstop that still runs even if someone
  skips or lacks the local Docker setup.
- **New dev dependencies approved**: `vitest`, `supertest` (backend only),
  `husky` (both repos).
- **Pre-push hook scope**: backend runs the new grading test suite;
  frontend runs its existing `npm run build` (no frontend tests exist yet
  to run). Both block the push on failure.
- **No changes to production code paths** in this phase — this is
  test/CI infrastructure only. If a test uncovers a real bug while being
  written, that's a separate fix, flagged to the user, not silently
  bundled in.

## Architecture

```
Local dev: git push
  -> husky pre-push (backend repo)
     -> docker compose -f docker-compose.test.yml up -d
     -> wait for Postgres healthy
     -> apply sql/schema.sql to the fresh container
     -> npm test (vitest, DATABASE_URL -> local container)
     -> docker compose down
     -> non-zero exit blocks the push
  -> husky pre-push (frontend repo)
     -> npm run build
     -> non-zero exit blocks the push

GitHub push/PR to main (backend repo)
  -> Actions workflow: postgres:15 service container
     -> apply sql/schema.sql
     -> npm ci && npm test
     -> red/green check on the commit/PR, does not block push itself
```

### Components

- `docker-compose.test.yml` (backend repo root) — single disposable
  `postgres:15` service, distinct port from any local dev DB, no named
  volume (throwaway data each run).
- `.env.test` (backend, gitignored) — `DATABASE_URL` pointed at the
  Docker container. Loaded by `vitest.config.js` via `dotenv` before
  tests run.
- `vitest.config.js` (backend) — test file glob `tests/**/*.test.js`,
  loads `.env.test`.
- `tests/grading.test.js` — `supertest` against the Express app (app
  needs to be exported from `src/index.js` separately from the
  `.listen()` call so tests can import it without binding a real port —
  confirm current file shape during planning, this may need a small
  non-behavioral export-only change). Each test seeds its own
  `standard_questions`/`video_questions` rows and mints a disposable
  staff JWT via the existing `issueToken()` helper (same no-real-PIN
  pattern every prior subsystem's verification already used), then
  truncates its own inserted rows in an `afterEach`.
- `.github/workflows/test.yml` (backend repo) — `postgres:15` service
  container, schema applied via a `psql` step, `npm ci`, `npm test`.
  Triggers: push and pull_request targeting `main`.
- `.husky/pre-push` (backend repo) — runs the Docker-based test cycle
  above.
- `.husky/pre-push` (frontend repo) — runs `npm run build`.

## Test cases (grading logic)

Targets the two real past incidents plus core correctness:

1. Server-authoritative grading — submitting an `answers` array with
   extra, missing, or duplicate entries does not change the computed
   score; score is always derived from the DB's `standard_questions`
   row set for the topic.
2. `id` type coercion — a numeric `id` in the client payload correctly
   matches the string-typed bigserial `id` from `standard_questions`.
3. Score/percentage arithmetic and bilingual wrong-answer row content
   (`wrong_answers` insert) are correct for a known mixed right/wrong
   answer set.
4. Same-calendar-day resubmission returns the cached prior score and
   does not insert a second `results` row.
5. 403 when the session's `scopeType`/`scopeKey` doesn't match the
   submitted `outlet`/`name`.
6. `POST /ai-results` and `POST /video-results` equivalents of cases 1
   and 2 where their grading source differs (AI grades from a
   `questions_json` blob by array index, not a joined table by id).

## Error handling

- Docker not installed/running locally: pre-push hook fails with a
  clear message naming the missing prerequisite, does not silently skip
  the check.
- CI workflow failure blocks the PR's merge-readiness check (GitHub's
  own PR UI), but does not block the push itself — matches how CI
  normally behaves, consistent with the earlier "auto remote" vs
  "auto local" distinction discussed with the user.

## Out of scope (this phase)

- Frontend test framework (`vitest` + `@vue/test-utils`) and any
  frontend CI workflow.
- Auth/lockout test coverage.
- A frontend pre-push test step (build-only for now, no tests exist to
  run).
- Any fix to production grading code — this phase is test infrastructure
  only; a real bug found while writing tests gets flagged separately.
