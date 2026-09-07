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
[FRAGILITY]:
- In-app Drive resource upload is **permanently** out of scope (Google service accounts have zero storage quota on a regular Drive folder — real Google platform limit). User decided 2026-08-11 not to pursue Shared Drive/OAuth delegation. Supervisors upload to Drive directly, outside the app, permanently. `POST /resources/upload` stays in backend, dormant/correct/unreachable — leave as-is.
- `BACKEND_URL`/`VITE_API_URL` are hardcoded/baked-in constants (vanilla `index.html` and the Vite build respectively) — a Railway URL change needs a manual edit + rebuild, not just an env var change.
- Vanilla `index.html`'s real production hosting is **GitHub Pages** (`https://farmasilautancdr.github.io/LautanAcademy/`, built from `master`), undocumented until 2026-08-11. Depends on `.nojekyll` at repo root staying in place — don't delete it, and don't assume a red Pages Actions run means it's dead without checking first.
- Local dev backend on `C:\Users\Client`'s machine can't reach Supabase's Direct-connection host (IPv6-only, this network has no IPv6 egress) — use the Session Pooler connection string (`aws-0-<region>.pooler.supabase.com`) for any local `npm run dev`, not the Direct host. Railway production already uses the pooler; this is a local-machine-only gap, not a prod issue.
- No separate test/staging DB exists for this project — local dev and "testing" both point at the same production Supabase DB. Be careful with any destructive/bulk-write test (see Annual Data Reset in ARCHIVE.md for why that endpoint's real delete path has never actually been executed).

[PENDING] (still open, not started):
- Automated test suite — backend `vitest`/`node --test`+`supertest` w/ a real separate test DB, frontend `vitest`+`@vue/test-utils`, GitHub Actions CI. Priority if picked up: grading logic first (already bit us once), then auth/lockout. No scope/spec cycle started.
- Supabase Storage free-tier usage — `POST /content/upload` caps 20MB/file, no total-usage guard. Check Supabase dashboard → Storage → Usage before this becomes a real problem; add a guard if picked up.
- Outlet region reassign rule — when an outlet's area/region changes, Master should be able to freely reassign it to any area with no restriction. User-stated 2026-08-11, not yet coded — apply when touching `store_outlets.area_id` reassignment logic.
- iOS Safari <16.4 doesn't support `fetch keepalive` — Module Quiz's tab/app-close abandon-catch silently doesn't fire on older iPhones (in-app nav-away guard still works everywhere). User: leave as-is unless revisited (would need a `sendBeacon` fallback + backend support for unauthenticated-body requests).

[STATE as of 2026-09-07]: Both repos confirmed clean and fully pushed to origin — frontend `e9948cd` (master), backend `8ab5061` (main). No uncommitted or unpushed local work found (prior MEMORY.md entries claiming otherwise were stale — that work shipped in commits between 2026-08-13 and 2026-08-28, see ARCHIVE.md). Most recent shipped work (2026-08-26 to 2026-08-28, undocumented in prior MEMORY.md, titles only — no detailed entries exist for these, re-derive from `git log`/diff if context is needed): mobile nav redesign + Staff Activity dashboards, PIC Outlet role rename (was "Outlet Manager"), colored stat cards on staff/Supervisor/Area Manager dashboards, Course page reshuffle (renamed from "Browse Courses", category ordering, "already attempted" badges), Module Quiz topic fuzzy-match to Course materials, Rename Topic action (Manage Module Quiz Questions, cascades into historical results).
[NEXT STEPS]: Nothing in progress. Await next task from user. Before claiming any future work "done", verify against real `git status`/`git log` rather than trusting this file alone — it drifted badly stale between 2026-08-28 and 2026-09-07 (no session touched it for ~10 days of real shipped work).
