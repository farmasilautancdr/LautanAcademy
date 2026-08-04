# Lautan Academy — Vue + Node/Postgres Rewrite Scope Tracker

Reflects verified state as of this migration's current session — every
checked item has been tested end-to-end (curl and/or real browser), not
just written. See CLAUDE.md hard rule 6: don't check an item until it's
built AND verified.

## ✅ Backend (`lautan-academy-backend`, Express + Postgres/Supabase) — built & tested

- [x] Postgres schema: `staff_roster`, `manager_pins`, `content`, `results`,
      `wrong_answers`, `ai_results`, `ai_wrong_answers`, `ai_quizzes`,
      `reports` (real schema now — matches GAS's live report form fields)
- [x] Staff login — division + outlet + name + PIN, bcrypt-hashed PINs, JWT,
      5-fail/5-min lockout (`POST /auth/staff-login`)
- [x] Manager login — role + PIN (+ outlet unless supervisor), same lockout
      pattern. All 4 roles seeded and tested: outlet_manager, warehouse_manager,
      area_manager, supervisor (`POST /auth/manager-login`)
- [x] Public staff-roster names lookup for login picker, no PIN exposed
      (`GET /auth/staff-roster`)
- [x] AI quiz generation — real Gemini call, bilingual EN/MS, matches GAS's
      exact prompt/schema (`POST /quiz/create`)
- [x] AI quiz redeem by outlet + passcode (`POST /quiz/redeem`)
- [x] AI quiz active-check + end-early (`GET/POST /quiz/:outlet/active`, `/end`)
- [x] Scoped results/history by role — staff/outlet/warehouse/area/supervisor,
      supervisor supports a `windowMonths` filter (`GET /data/scoped-data`)
- [x] Save Standard Quiz result + wrong answers (`POST /data/results`)
- [x] Save AI Practice result + wrong answers (`POST /data/ai-results`)
- [x] One-time historical migration script — pulled all Results/WrongAnswers/
      AIResults/AIWrongAnswers/Content out of GAS via Supervisor scope,
      verified row counts and spot-checked data format after
      (`scripts/migrate-from-gas.js` — no longer safe to re-run wholesale,
      see Known Fragility)
- [x] Content (Knowledge Base) CRUD — list/add/delete, add/delete gated to
      Supervisor matching GAS. Tested against an empty table (GAS's Content
      sheet has 0 rows too — infra works, no data exists yet either side)
      (`GET/POST /content`, `DELETE /content/:id`)
- [x] Content-only GAS sync, safe to re-run (`scripts/sync-content-from-gas.js`)
- [x] Reports — `POST /reports`, matches GAS's save_report exactly: one
      report per outlet+staff+topic, duplicate blocked unless `isEdit` set,
      edit blocked across a different manager's report. Area Manager only.
      Included in `/data/scoped-data` for staff/outlet-manager/area-manager/
      supervisor (warehouse excluded, matches GAS)
- [x] Manage Staff CRUD — list (names + who-added, never the PIN), add,
      reset-pin (explicit reset instead of GAS's plaintext lookup — not
      possible with hashed PINs, see note below), remove. Outlet/warehouse
      manager scoped. Verified: add, duplicate-block (409), reset (old PIN
      rejected/new PIN works), delete (`/staff-roster-manage*`)
- [x] Content file upload — `POST /content/upload`, Supervisor only,
      multipart, 20MB max (PDF/Word/PowerPoint/Excel/images), uploads to a
      Supabase Storage bucket (`content-files`, public) via the service-role
      key (server-side only, never reaches the browser), returns a public
      URL for the entry's link field. New capability beyond GAS — GAS had
      no file upload, only a manually-typed link. Verified end-to-end: real
      upload, public URL reachable without auth, delete.
- [x] Resources — Google Drive integration via service-account auth
      (`googleapis`), recursive folder walk, category + one-level subfolder
      grouping (e.g. a "Housebrand Modules" main folder with "Allife"/
      "Biomerit" subfolders tags both levels), 5-min in-memory cache
      (`GET /resources`). Verified against the real Drive folder.
- [x] Standard Quiz question bank — `standard_questions` table (mirrors
      GAS's Questions sheet exactly: topic, bilingual question/options,
      0-indexed `correct`, `status`), `scripts/migrate-questions-from-gas.js`
      pulled the real 133 questions/8 topics from GAS's public doGet(),
      `GET /questions` (public, no auth, matches GAS serving this
      pre-login). Reuses the existing `/data/results` endpoint to save
      attempts — no new save endpoint needed. Verified: migrated data
      matches GAS row-for-row (spot-checked + per-topic counts), full save
      flow tested end-to-end via curl (real staff login → save → confirmed
      correct rows in `results`+`wrong_answers` → cleaned up).
      **Named `standard_questions`, not `questions`** — this Supabase
      project already has an unrelated, unused `questions` table (different
      shape: `topic_id` FK, jsonb options, `correct_index`) plus a whole
      parallel unused schema (`topics`, `quizzes`, `attempts`,
      `attempt_answers`, `outlets`, `staff`, `resources`, `manager_reviews`)
      — confirmed leftover from an earlier abandoned attempt, not touched.
- [x] Server-side quiz grading — both quiz types. `GET /questions` and
      `POST /quiz/redeem` no longer send `correct` to the client at all;
      `POST /questions/:id/check` and `POST /quiz/:outlet/check` grade one
      answer live (for instant reveal — not authoritative); `POST
      /data/results` and `POST /data/ai-results` now take a raw
      `answers: [{id or index, chosen}]` array and grade the *entire*
      attempt server-side (Standard: looked up by id+topic in
      `standard_questions`; AI: looked up by index against the quiz's own
      stored `ai_quizzes.questions_json`) — the client's own score is never
      trusted for what gets saved. Supersedes the earlier "accepted
      tradeoff, don't touch" call on answer disclosure — that tradeoff no
      longer exists, this closes it for both quiz types at once.
      Known edge case: if a manager regenerates an outlet's AI quiz code
      while someone is still mid-attempt on the old code, that old code's
      row is gone (one-row-per-outlet, overwritten in place) and the
      submission fails with a clear 410 instead of silently saving a
      score for a quiz that no longer matches — a real but rare race,
      flagged rather than fixed (would need an append-only quiz table).
      Verified end-to-end via curl for both types: real Standard Quiz
      question set (2 correct + 1 wrong → confirmed exact 2/3, 67%, correct
      DB rows) and a synthetic AI quiz row (no Gemini call spent — 1
      correct + 1 wrong → confirmed exact 1/2, 50%). Found and fixed one
      real bug during this: `standard_questions.id` comes back as a string
      from node-pg (bigserial), but was being used as a `Map` key against a
      `parseInt`'d lookup — silently matched nothing, scored everyone 0
      until fixed.
      **Second round, found by automated security review of the push**:
      grading originally used `total = answers.length` — the client's own
      claim of how many questions it was answering, not the real bank/quiz
      size. Submitting a cherry-picked subset (e.g. only your one
      known-correct answer) inflated the percentage; a duplicated id could
      do the same. Fixed by grading against the *authoritative* question
      set (topic's real rows from `standard_questions`, or the AI quiz's
      full stored `questions_json`) and only ever consulting the client for
      "what did you pick for question X", never "how many questions counted".
      Also: the new live check endpoints had no rate limit and
      `/quiz/:outlet/check` had no auth at all — either could be scripted
      to loop every id/option and rebuild the exact answer key this change
      was meant to stop exposing, just via many small calls instead of one
      response. Both endpoints are now `requireAuth` + capped at 80
      calls/10 min per staff session (`hitRateLimit`, new generic counter in
      `middleware/rateLimit.js` — separate from the login-lockout one,
      since a real quiz needs far more than 5 calls). Re-verified end-to-
      end: normal grading still exact, the specific bypass (submit 1 of 3
      answers) now correctly returns 1/3 not 1/1, unauthenticated check
      correctly 401s.
- [x] PIN/passcode hardcoding removed — `checkPinInternal()` in
      `Code_v1.35.gs` no longer has a `defaultPins` fallback; requires
      `PropertiesService` Script Property or returns a clear "not
      configured" error. `index.html`'s visible `(SV2026)` hint text
      removed. New backend already stored PINs bcrypt-hashed, no change
      needed there.

## ✅ Frontend — Vue (`lautan-academy-frontend`) — built & tested

- [x] Staff login — outlet + name dropdowns (outlet list static, names from
      the public roster endpoint), division + PIN
- [x] AI Practice: join-by-passcode from dashboard
- [x] Module Quiz (Standard Quiz) — topic picker (`ModuleQuizView.vue`),
      retail staff only (sidebar item hidden for warehouse, matches GAS),
      uses the topic's **entire** question bank per attempt — deliberately
      not GAS's old fixed-10 cap, overridden per request — client-side
      "already attempted today" warning before starting (backend already
      no-ops the duplicate silently; this adds the explicit heads-up GAS
      gave). Reuses `QuizView.vue` for the actual quiz-taking screen — same
      question shape as AI Practice, just branches which endpoint saves the
      result (`/data/results` vs `/data/ai-results`). `/module-quiz` route
      guard checks `auth.staff.division === 'retail'`, not just sidebar
      hiding — a warehouse account typing the URL directly used to reach
      the quiz screen before hitting the backend's 403 on save; found by
      automated security review, fixed
- [x] Quiz History — Module Quiz and AI Practice shown as two separate
      sections (Module Quiz was previously invisible here entirely), each
      row expandable to review wrong answers + correct answer. Module Quiz
      matches wrong answers by topic only (no shared attempt id in that
      table — a topic retaken on a different day shows all its wrong
      answers together, not just one attempt's); AI Practice matches by
      the real `AttemptID`, exact per-attempt
- [x] Quiz taking — bilingual toggle, instant correct/wrong reveal per answer
      (locked in once picked, matches vanilla app's behavior)
- [x] Result screen — score, pass/fail state, missed-questions breakdown
- [x] Recent-attempts list on dashboard (from `/data/scoped-data`)
- [x] Outlet Manager dashboard — login (role+outlet+PIN), create-quiz with
      optional existing-content dropdown, active-code display + countdown,
      end-early, outlet-wide Standard+AI history
- [x] Warehouse Manager dashboard — same as above, scoped to the 4 fixed
      locations (Taskforce/Warehouse/Inventory/Logistic), AI-Practice-only
      history (matches GAS: that scope never included Standard Quiz results)
- [x] Area Manager dashboard — area picker (9-region fixed roster) + PIN
      login, scoped to the manager's **whole region** (all outlets in that
      area), not a single outlet — a deliberate improvement beyond GAS,
      which never scoped Area Manager past one outlet either. Standard Quiz
      results + wrong answers now show per-row outlet since they span the
      region, plus an outlet filter dropdown (matches Supervisor's existing
      filter pattern) since an unfiltered region-wide list wasn't a real
      improvement on its own; Reports: file/edit with duplicate detection + wrong-manager
      block, outlet-then-staff picker (names aren't unique across the
      region), Skill Level computed client-side from quiz percentage
      (matches GAS). Region→outlet mapping is now canonical server-side
      (`config/areas.js`, backend), not just a client-side dropdown copy.
      Verified: region mapping logic (9 regions, no outlet in >1 region,
      unknown area rejected), the `ANY($1)` scoping query against the real
      schema, and a real Area Manager login end-to-end on production
      (https://lautan-academy-frontend.vercel.app) — login, dashboard, and
      Reviews' outlet-then-staff picker all confirmed working.
- [x] Supervisor dashboard — unscoped PIN-only login, `windowMonths` filter
      (3/6/12 months/all-time), company-wide stats (staff/outlets/avg score)
      + combined Standard+AI activity log, outlet filter
- [x] Supervisor Cross-Outlet pages — Staff Comparison (per-staff rollup
      across all outlets, sortable by avg score/attempts/name, outlet +
      window filters) and Cluster Reports (company-wide filed Reports,
      read-only, outlet + window filters). Both built from data already in
      `/data/scoped-data`, no new backend endpoints needed. "All Outlets"
      already pointed at the real `/supervisor` page. All 3 sidebar nav
      items are now real, no dead links.
- [x] Router branches staff vs. each of the 4 manager roles, each with its
      own login screen and home redirect
- [x] Manage Staff UI — shared `ManageStaffPanel` component (division prop
      differs) on Outlet + Warehouse Manager dashboards: list, add, Reset
      PIN, remove. Tested in both.
- [x] Knowledge Base editor UI on Supervisor dashboard — list/add/remove
      Content entries, category picker, file upload (phone storage, not
      just a link — uploads immediately, fills the link field with the
      resulting URL). Tested end-to-end including a real file upload.
- [x] Resources browsing UI — category + subcategory filter dropdowns.
      Now on staff AND all 4 manager roles — one shared `ResourcesView.vue`
      (GET /resources is company-wide/unscoped, matches GAS, so no backend
      change was needed to extend it)
- [x] Outlet Manager results — Module Quiz/AI Practice split into two
      sections (was one merged list) + wrong-answer review per attempt.
      Warehouse Manager results — wrong-answer review added (no
      segregation needed, warehouse only ever has AI Practice)
- [x] Sidebar wording — "Assign to Staff" → "Staff Roster", moved into its
      own "Assign Staff" group (was under "Quiz Management"). Area
      Manager's "Reviews" → "Assessment" (sidebar + page header)
- [x] `AppSidebar.vue` — role-aware nav drawer (staff / outlet-manager /
      warehouse-manager / area-manager / supervisor), wired into `App.vue`,
      replaced redundant per-page headers
- [x] Staff dashboard and all 4 manager-role dashboards split from one
      bundled page per role into distinct routed pages matching each
      sidebar nav item (e.g. Outlet Manager: `/manager` create-quiz,
      `/manager/staff`, `/manager/results` as separate routes)
- [x] Dashboard delight pass — count-up ring animation on load (opt-in,
      other ring usages unaffected), first-use auto-focus + settling cue on
      the join-code form, error message paired with an icon

## ✅ Frontend — vanilla (`index.html`) — repointed to new backend, tested

- [x] Staff login, all 4 manager role logins, quiz create/redeem/active/end
      routed through the new backend instead of GAS
- [x] Results/wrong-answers/AI-history routed through new backend
- [x] Dual-token bridge to GAS for whatever isn't migrated yet (Reports,
      Resources, Manage Staff) — known stopgap, see Known Fragility below

## ❌ Not built yet

### Backend
- [ ] Rate limiter is in-memory only — resets on restart, not safe across
      multiple instances if ever scaled horizontally

### Data migration
- [x] Results/WrongAnswers/AIResults/AIWrongAnswers/Content — done, verified
- [x] Staff roster — 20 real staff migrated (names/outlets/divisions only —
      GAS never exposes passcodes in bulk, only per-outlet behind manager
      auth). Each needs an explicit Reset PIN via Manage Staff UI before
      that account can log in — intentional, not a bug
      (`scripts/migrate-staff-roster-names.js`, safe to re-run)
- [x] Reports data — synced, GAS had 0 historical rows (feature was
      apparently unused there too) (`scripts/sync-reports-from-gas.js`)
- [x] Standard Quiz question bank — 133 questions/8 topics migrated from
      GAS's live Questions sheet, verified row-for-row
      (`scripts/migrate-questions-from-gas.js`, safe to re-run — nothing
      else writes to `standard_questions`)

### Infra
- [x] Postgres — deployed (Supabase)
- [x] Express backend — deployed to Railway:
      https://lautan-academy-backend-production.up.railway.app
      Env vars set there (DATABASE_URL uses the Session Pooler connection,
      not Direct — see Known Fragility). Verified: health check, staff
      login, scoped-data, content — all real DB round-trips.
- [x] Vue frontend — deployed to Vercel:
      https://lautan-academy-frontend.vercel.app
      `VITE_API_URL` set to the Railway URL above. Verified: bundle
      contains the correct backend URL (not localhost), CORS confirmed
      working between the two live origins.
- [x] Load test — 20 concurrent simulated staff (seeded throwaway
      LOADTEST01-20 accounts, deleted after) against **production Railway**:
      login, `GET /questions`, `GET /data/scoped-data`, per-question
      check-answer, and a real graded submission on "Medsy Products" (7
      questions, real DB writes). No Gemini calls made (cost), no real
      staff/manager credentials touched. 19/20 flows succeeded end-to-end.
      Every endpoint held up under load *except* login: min 2.9s, but
      **worst case 134 seconds** for the last of 20 concurrent logins —
      `bcryptjs` (pure JS) does CPU-bound hashing that blocks Node's single
      event loop, so concurrent logins serialize behind each other instead
      of running in parallel. Real risk for a shift-change burst.
      **Fixed**: switched to native `bcrypt` (thread-pool based, doesn't
      block the loop) — same hash format, verified compatible with
      existing bcryptjs-created PIN hashes (no resets needed), and Railway
      builds the native module fine. Re-ran the 20-concurrent-login test
      against production after deploying: **worst case dropped from 134s
      to 2.15s**, 20/20 succeeded. Test accounts deleted after both runs.

## Known fragility (see CLAUDE.md hard rule 5)

- Vanilla `index.html` juggles two session tokens (new backend JWT +
  GAS-issued token) to bridge features that haven't migrated yet. Real fix
  is finishing the backend endpoints above so the GAS bridge — and the
  second token — can be removed entirely.
- `GAS_URL` and `BACKEND_URL` are hardcoded constants in `index.html`;
  already caused one real outage this session (stale deployment ID). Now
  also true of `VITE_API_URL` baked into the Vercel build — if the Railway
  URL ever changes, the frontend needs a rebuild, not just a var change.
- `BACKEND_URL` in `index.html` now points at the Railway URL (was
  `localhost:3000`, dev-only). Same fragility as `GAS_URL` above: it's a
  hardcoded constant, so a future Railway URL change needs a manual edit
  here too, not just an env var.
- Supabase's Direct connection (`db.<ref>.supabase.co`) does not work from
  Railway — it resolves to an IPv6 address Railway can't route, and even
  after forcing IPv4-first DNS + disabling Node's Happy Eyeballs
  (`net.setDefaultAutoSelectFamily(false)`), the IPv4 path still hung
  (likely a firewalled egress, not just an address-family issue). Fixed by
  switching to Supabase's **Session Pooler** connection string instead
  (`aws-0-<region>.pooler.supabase.com`) — that's what's actually set in
  Railway's `DATABASE_URL` now, not what's in this repo's `.env.example`.
  Local dev keeps using Direct connection since it works fine here; the
  pooler is only required for Railway specifically.

## Suggested build order (next)

Backend + Vue frontend are both deployed and live (Railway + Vercel).
Reports, Manage Staff, Content/Knowledge Base, Resources, sidebar nav,
route-split, security hardening, Area Manager region-scoping (+ outlet
filter), Supervisor Cross-Outlet pages, vanilla's `BACKEND_URL`, the
Standard Quiz question bank + Module Quiz UI, Quiz History's Module
Quiz/AI Practice segregation, server-side grading for both quiz types
(+ the follow-up integrity/rate-limit fixes a second security review
caught), a load test, and the native-bcrypt fix it surfaced are all done
and deployed. Remaining:

1. Rate limiter durability (in-memory, resets on restart) — now covers
   both login lockout and the new check-endpoint throttling, same
   per-process-only limitation for both
