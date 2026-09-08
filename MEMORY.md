# MEMORY.md

# MEMORY
*Update autonomously. Keep ultra-brief. Move old data to ARCHIVE.md.*

[STACK]: Vue 3, Vite, Tailwind | Node.js, Express, Postgres (Supabase) | JWT auth, native bcrypt.
[STRUCTURE]: This working copy lives at `C:\Projects\my-project\LautanAcademy` — frontend repo (root, `origin/master`, github.com/farmasilautancdr/LautanAcademy). Backend is a separate sibling repo checked out inside it at `farmasilautancdr-lautan-academy-backend-/` (`origin/main`, github.com/farmasilautancdr/farmasilautancdr-lautan-academy-backend-). A second, older frontend-only clone also exists at `C:\Users\Client\LautanAcademy` (same remote, kept in sync — not a separate project). Branch -> `master`(frontend)/`main`(backend), direct commits, no feature-branch workflow.
[RULES]: Bilingual (EN/MS) for UI strings. No new frameworks/libs without asking. Match existing file styles. GAS→Postgres migration COMPLETE (2026-08-11) — Postgres is sole source of truth, no code path anywhere talks to GAS (full cutover detail in ARCHIVE.md).
[DECISIONS]: Switched to native bcrypt (was bcryptjs) to prevent single-thread blocking during concurrent logins.
[LESSONS] (full incident narrative for each in ARCHIVE.md):
- Any `item.disabled ? null : someHandler` ternary in a `@click` must call `someHandler()` explicitly — a bare reference inside a ternary silently never fires (bit the whole sidebar once).
- Never hardcode padding/margin against a fixed-position element whose size is role/data-driven — measure it (`ResizeObserver` + CSS var), don't guess a fixed px value.
- Any new router/nav work must keep Vue Router's `scrollBehavior` in mind — no inner scroll container in this app, `window` itself is it.
- Any future `results`-table topic split must check both `videoHoursByTopic` AND `contentHoursByTopic` — 3 topic-namespace sources share that table, not 2.
- DB-stored ids from node-pg (bigserial) come back as strings — don't use them as numeric Map keys without matching types on both sides.
- Grade quizzes only against the authoritative server-side question set/count, never trust a client-submitted array length or id list.
- `useCpdHours.js`'s `videoHoursByTopic`/`contentHoursByTopic` expect specific field casing (`topic`/`hours` lowercase for video_trainings, `Topic`/`QuizRequired`/`Hours` for content) — a mock/test payload with wrong casing silently misclassifies Video Training rows as Module Quiz instead of erroring.
[FRAGILITY]:
- In-app Drive resource upload is **permanently** out of scope (Google service accounts have zero storage quota on a regular Drive folder — real Google platform limit). User decided 2026-08-11 not to pursue Shared Drive/OAuth delegation. Supervisors upload to Drive directly, outside the app, permanently. `POST /resources/upload` stays in backend, dormant/correct/unreachable — leave as-is.
- `BACKEND_URL`/`VITE_API_URL` are hardcoded/baked-in constants (vanilla `index.html` and the Vite build respectively) — a Railway URL change needs a manual edit + rebuild, not just an env var change.
- Vanilla `index.html`'s real production hosting is **GitHub Pages** (`https://farmasilautancdr.github.io/LautanAcademy/`, built from `master`), undocumented until 2026-08-11. Depends on `.nojekyll` at repo root staying in place — don't delete it, and don't assume a red Pages Actions run means it's dead without checking first.
- Local dev backend on `C:\Users\Client`'s machine can't reach Supabase's Direct-connection host (IPv6-only, this network has no IPv6 egress) — use the Session Pooler connection string (`aws-0-<region>.pooler.supabase.com`) for any local `npm run dev`, not the Direct host. Railway production already uses the pooler; this is a local-machine-only gap, not a prod issue.
- No separate test/staging DB exists for this project — local dev and "testing" both point at the same production Supabase DB. Be careful with any destructive/bulk-write test (see Annual Data Reset in ARCHIVE.md for why that endpoint's real delete path has never actually been executed).

[DONE 2026-09-08] Automated test suite, grading-first slice — ALL 9 TASKS COMPLETE, verified for real, pushed, PRs open: backend PR farmasilautancdr/farmasilautancdr-lautan-academy-backend-#1, frontend PR farmasilautancdr/LautanAcademy#1. Not yet merged — awaiting review/green CI. Spec: `docs/superpowers/specs/2026-09-08-grading-test-suite-design.md`. Plan: `docs/superpowers/plans/2026-09-08-grading-test-suite.md`.
Commits (backend worktree, `farmasilautancdr-lautan-academy-backend-/.worktrees/grading-test-suite`, branch `grading-test-suite`):
- `7d8fb4c` Task 1 — disposable Docker Postgres + schema apply script
- `59a13cf` Task 2 — extracted `src/app.js`, vitest+supertest smoke test
- `ab968f6` Task 3 — seeding/token/cleanup test helpers
- `a5837e8` Task 4 — `POST /data/results` grading tests (7)
- `0a7c710` Task 5 — `POST /data/ai-results` grading tests (5)
- `b24d7a7` Task 6 — video/content-results grading tests (6)
- `2c3e0e0` Task 7 — GitHub Actions CI workflow
- `43d7337` Task 8 — backend husky pre-push hook (runs grading suite)
Full grading suite: 20 tests, all passing (`npm test` in backend worktree). No production grading-logic bugs found across all 4 endpoints.
Commit (frontend worktree, `.worktrees/grading-test-suite`, branch `grading-test-suite`):
- `5e6a401` Task 9 — root `package.json` + husky pre-push hook (build only)
Two real bugs found and fixed during verification (both flagged, not silently patched):
1. `src/config/db.js` hardcoded `ssl: { rejectUnauthorized: false }` — broke against local Docker Postgres (no SSL listener). Fixed: ssl conditional on `localhost`/`127.0.0.1` in the connection string, zero behavior change for Supabase/prod. Part of Task 1's commit.
2. Backend `.husky/pre-push`'s plan-specified script combined `set -e` with `npm test; status=$?` — `set -e` kills the script the instant `npm test` fails, so the teardown after `status=$?` never runs, leaking the disposable test container on every failed push attempt. Fixed: `trap cleanup EXIT` instead. Confirmed via a real broken-test dry-run push (blocked + tore down correctly) and a real passing dry-run push (proceeded + tore down correctly). Part of Task 8's commit.
This machine has no real backend `.env` at all — any future work needing "a real `.env` present" should use `.env.test` + the disposable Docker DB instead (proven pattern from Task 2/8).
[NEXT STEPS]: Ask user whether to push `grading-test-suite` branches to origin and open PRs (or merge direct-to-trunk per this project's usual convention), now that all 9 tasks are verified complete. Remaining, explicitly deferred per the plan's own post-plan note: auth/lockout backend tests, frontend `vitest`+`@vue/test-utils`, frontend CI workflow — each its own future brainstorm→spec→plan cycle.

[PENDING] (still open, not started):
- Automated test suite, remaining phases (deferred, not part of the active task above): frontend `vitest`+`@vue/test-utils`, auth/lockout backend tests, frontend CI workflow. No scope/spec cycle started for these.
- Supabase Storage free-tier usage — `POST /content/upload` caps 20MB/file, no total-usage guard. Check Supabase dashboard → Storage → Usage before this becomes a real problem; add a guard if picked up.
- Outlet region reassign rule — when an outlet's area/region changes, Master should be able to freely reassign it to any area with no restriction. User-stated 2026-08-11, not yet coded — apply when touching `store_outlets.area_id` reassignment logic.
- iOS Safari <16.4 doesn't support `fetch keepalive` — Module Quiz's tab/app-close abandon-catch silently doesn't fire on older iPhones (in-app nav-away guard still works everywhere). User: leave as-is unless revisited (would need a `sendBeacon` fallback + backend support for unauthenticated-body requests).

[STATE as of 2026-09-08]: Frontend pushed to origin — `44b2b48` (master). Supervisor CSV export of quiz results shipped in 3 passes, each on real user/prod feedback: v1 (`a9f6277`) put it on Staff Comparison exporting all 4 quiz types. v2 (`285aa6c`) reverted Staff Comparison and moved it to `SupervisorDashboard.vue` (sidebar "All Outlets" → "Module Quiz Review"), scoped to Module Quiz only, fixed Score values like "15/15" opening in Excel as dates ("10/15" → "Oct-15", now renders "15 of 15") — but the page's on-screen activity log/stat tiles still mixed in Video Training/eLearning/AI Practice (only the CSV was Module-Quiz-scoped), and the Topic filter only affected the CSV, not the visible list. v3 (`44b2b48`) fixed both: `moduleQuizResults`/`filteredModuleQuiz` (via splitByVideoTopic+splitByContentTopic) is now the single source for stat tiles, activity log, AND CSV, so the page is Module-Quiz-only end-to-end and the Topic filter affects everything visible, not just the download. Page header retitled "Module Quiz Review" to match. Staff Comparison keeps all 4 quiz types on its own leaderboards, untouched since v2's revert. Frontend-only, no backend changes throughout. Verification: v1 live via Playwright; v2 and v3's filtering/split logic verified by importing the real `useCpdHours.js` composable into standalone Node scripts and checking output against expected rows (Playwright MCP was disconnected all session, no live browser check possible from this side). User manually checked Module Quiz Review live in production after `44b2b48` deployed and confirmed it's all working (nav rename, Module-Quiz-only scoping, topic filter now affecting the visible list, CSV). Feature considered closed. Backend repo untouched this session, last known state `8ab5061` (main) — not re-verified.
[NEXT STEPS]: Nothing in progress. Await next task from user. Before claiming any future work "done", verify against real `git status`/`git log` rather than trusting this file alone.
