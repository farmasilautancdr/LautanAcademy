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
- [x] Rate limiter durability — was in-memory (wiped on every
      restart/redeploy, wrong if ever scaled to multiple instances). Now
      Postgres-backed (`rate_limits` table), atomic upsert avoids a
      read-then-write race for concurrent requests on the same key.
      Verified: login lockout still triggers after 5 wrong PINs, survives
      a full process restart (confirmed the old version couldn't), clears
      correctly; check-endpoint throttle confirmed writing/reading
      correctly through a real Railway deploy.
- [x] `attempt_id` added to `results` + `wrong_answers` (mirrors
      `ai_results`/`ai_wrong_answers`). Fixes a real bug: Module Quiz
      wrong-answer review matched by topic only (no per-attempt id
      existed), so retaking a topic mixed every attempt's wrong answers
      together in Quiz History — "got Q2 wrong, review showed Q3's
      content." Migration (`scripts/migrate-add-attempt-id.js`) run
      against production DB; legacy pre-migration rows (no attempt_id)
      fall back to the old topic-only match so they don't silently show
      nothing, new attempts get exact matching. Verified: seeded a real
      throwaway staff account, two real attempts of the same topic
      through the running backend, confirmed each attempt's wrong answer
      maps to itself only, cleaned up test data after.
- [x] Drive files as AI quiz source (`services/drive.js` +
      `services/textExtract.js`) — `sourceType: 'resource'` in
      `POST /quiz/create` was a dead placeholder before (silently skipped
      to the generic-knowledge fallback); now extracts real text live.
      Google Docs/Slides/Sheets via Drive's native export (text/plain or
      csv). PDF/docx/pptx/xlsx via download + parse — docx/pptx/xlsx
      hand-extracted via `jszip` (all three are zip+XML, one dependency
      covers all three instead of one parser library per format), PDF via
      `pdf-parse@1` (pinned — v2 pulls a native-canvas dependency chain
      and has a different API; v1's own `index.js` has an ESM-import bug,
      worked around by importing `lib/pdf-parse.js` directly). Legacy
      binary Office formats (.doc/.ppt/.xls, pre-2007) and images stay
      unsupported — not zip+XML, would need a real binary parser or OCR.
      Verified: `getDriveFileText` against a real live Slides file
      (12.9k chars, coherent real content); docx/pptx/xlsx extractors
      against hand-built synthetic files; PDF extractor against
      `pdf-parse`'s own real fixtures.

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
      (https://lautan-academy.vercel.app) — login, dashboard, and
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
      Fix: Add row + Reset PIN row had `flex-1` inputs beside fixed-width
      siblings (PIN input/buttons) with no `min-w-0` — inputs don't shrink
      below their intrinsic content width by default, so the row exceeded
      phone viewport width and scrolled the whole page sideways. Added
      `min-w-0` to both. Checked rest of the app for the same pattern —
      no other instances. Verified live on phone.
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
- [x] Nav rework — `AppSidebar.vue`: sticky (`sticky top-0`, was scrolling
      away on tall pages), staff's single flat "My Learning" group split
      into 3 named groups (My Learning / Quizzes / Browse Courses)
      mirroring the manager groups' pattern, collapsible per-group
      (existing mechanism, just needed staff to have >1 group). Mobile
      (`<768px`): sidebar hides entirely, fixed bottom icon nav bar takes
      over — including logout, which the hidden sidebar footer would
      otherwise orphan on mobile.
- [x] Staff dashboard rebuilt (`DashboardView.vue`) — dark hero card (avg
      practice score ring, "Join a Quiz" scrolls to the join-code form),
      Browse Courses category grid (deep-links into `ResourcesView` via a
      new `?category=` query param), "Recent Practice" right-rail widget
      from real AI Practice history. CSS Grid with named areas handles
      mobile single-column vs desktop two-column explicitly. Greeting
      shows the first two words of the staff name ("Hi Mohd Hafiz", not
      just "Mohd"), falls back to one word if that's all there is.
- [x] Brand palette + logo — swapped the teal/coral tokens in
      `tailwind.config.js` for the logo's blue/orange (single-file edit,
      propagates everywhere via existing token-based classes). Logo's
      white-card background wasn't real transparency (a "maskable" PWA
      icon export) — stripped via flood-fill from the edges so internal
      highlights survive, verified pixel-by-pixel. Logo placed in
      `AppSidebar.vue` + all 4 login screens (beside the wordmark, not
      stacked above it, sized to match the wordmark's height). Login
      pages: dark `bg-deepsea` → white/`bg-seafoam`, ambient glow removed,
      light-on-dark text flipped to dark-on-light.
- [x] Browse Courses (`ResourcesView.vue`) merges two previously-separate
      systems into one filterable list: Drive-backed referenceDocs
      (`GET /resources`) and Knowledge/Content entries (`GET /content` —
      same data AI quiz creation already draws from). A Knowledge entry's
      Topic fills the same role as a Drive resource's Subcategory (both
      the finer grouping under Category), so they share one
      category/subcategory filter instead of two disconnected taxonomies.
      Knowledge entries expand in-place (`<details>`) to read the body
      text since they're not always a file with a preview URL.
- [x] "Create Quiz" hand-off from Browse Courses to AI quiz creation —
      gated to Outlet/Warehouse Manager (the only roles with a create-quiz
      screen). Knowledge entries hand off `?topic=`; Drive entries hand
      off `?sourceType=resource&sourceValue=<drive file id>`, both
      dashboards read this on mount to prefill the form. The "pick a
      course" picker itself was rebuilt from a flat Content-topics-only
      list (which showed nothing for Drive-only Browse Courses content —
      the common case) into two cascading filters (Category → Topic,
      same shape Browse Courses itself uses) narrowing to a final course
      pick spanning both Knowledge entries and Drive files.
- [x] Add Resources — Supervisor's Content-management UI, split out of
      the "All Outlets" activity page into its own route
      (`/supervisor/add-resources`, `SupervisorAddResourcesView.vue`),
      added as a second item in the sidebar's "Browse Courses" group.
      Category field changed from a hardcoded disconnected list
      (`SOP`/`Training Material`/`Note`/`Guideline`, matched nothing in
      Browse Courses) to a free-text input suggesting (via `datalist`)
      categories that actually exist in Browse Courses.
- [x] Supervisor region filter — All Outlets / Staff Comparison / Cluster
      Reports all gained a region filter ahead of the existing outlet
      filter (region narrows the outlet dropdown to that region's
      roster), same two-step pattern `AreaManagerReviewsView.vue` already
      used. Region→outlet mapping de-duplicated into one shared frontend
      module (`src/config/areas.js`) instead of adding a 3rd copy
      alongside the existing ones in `AreaManagerLoginView.vue` (frontend)
      and `config/areas.js` (backend, canonical).
- [x] Cluster Reports CSV download — exports exactly what's on screen
      (respects region/outlet/window filters), proper CSV escaping,
      UTF-8 BOM so Excel doesn't mangle bilingual (EN/MS) names.
- [x] Mobile responsiveness pass — viewport meta tag (was already
      present), bottom-nav clearance padding set to exactly 80px
      (`pb-20`, was 64px), global fluid-width safety net
      (`overflow-x: hidden` on body, `max-width: 100%` on
      img/svg/video/table) so nothing can force horizontal scroll on a
      small screen regardless of its own intrinsic size.
- [x] i18n Phase 1 (EN/BM) — `vue-i18n` wired app-wide
      (`src/i18n/index.js`, `legacy: false`, persisted to
      `localStorage['lautan_lang']`). `LanguageSwitcher.vue` — segmented
      pill, text-only EN/BM (no flags, dropped after user feedback),
      active side highlighted. Migrated: 6 standalone login/register
      screens (staff, outlet/warehouse manager, area manager, supervisor
      login + manager/area-manager register) and `AppSidebar.vue` (desktop
      nav, mobile bottom nav — same `sections` data, no separate
      translation site needed — role labels, logout). BM text authored
      directly (no paid translation API, per explicit instruction).
      Verified: `npm run build` clean, EN/BM key-parity check clean (no
      keys missing either direction), user confirmed live in browser on
      `/login` and `/manager-login` (switcher toggles, both languages
      render). Remaining ~22 views (dashboards, quiz flow, results, staff
      panels, resources, reports) and `QuizView.vue`'s pre-existing local
      `lang` toggle are Phase 2, not started — see MEMORY.md.
- [x] i18n Phase 2 Batch 1 (staff quiz flow) — DashboardView, ModuleQuizView,
      QuizView, ResultView, QuizHistoryView, ResourcesView migrated to
      `vue-i18n` (212 keys/side, EN+BM). Also closed Phase 1's flagged open
      risk: `QuizView.vue`'s separate local `lang` toggle (drove question
      `_en`/`_ms` text) removed, replaced by the shared `useI18n().locale` +
      `<LanguageSwitcher />` — question-content language and UI-chrome
      language are now one switch, not two. Plan:
      `docs/superpowers/plans/2026-08-10-i18n-phase2-batch1.md`. Verified:
      `npm run build` clean after each of 6 tasks, EN/BM key-parity check
      clean, user confirmed live in browser across all 6 views (both
      languages, including the reconciled quiz-taking switch) — all
      switching correctly. 3 more Phase 2 batches (Outlet Manager group,
      Warehouse+Area Manager group, Supervisor group) not started.

## ✅ Frontend — vanilla (`index.html`) — repointed to new backend, tested

- [x] Staff login, all 4 manager role logins, quiz create/redeem/active/end
      routed through the new backend instead of GAS
- [x] Results/wrong-answers/AI-history routed through new backend
- [x] Reports and Manage Staff repointed off the GAS bridge onto the new
      backend. Manage Staff: passcode display replaced with a Reset PIN
      button (hashed storage can't show an existing passcode the way GAS
      could). Reports: assessment-date field stays in the form, not sent
      (matches the Vue app's existing behavior).
      Found and fixed two real bugs while doing this, both deployed:
      (1) vanilla's Area Manager login sent a plain outlet code, which the
      backend now rejects since Area Manager region-scoping — login was
      fully broken until fixed; (2) `POST /reports` compared
      `scopeKey !== outlet` directly, but scopeKey has been the area id
      since that same region-scoping change — **every Area Manager report
      submission had been silently 403ing in the already-shipped Vue app
      too**, not just something the vanilla work would have hit.
      Also added `id_note` to `staff_roster` (was missing entirely —
      matches GAS's IDNote column for disambiguating duplicate names,
      would have been a silent feature loss otherwise).
- [x] Resources/Content — the last remaining GAS bridge — repointed to the
      new backend, dual-token setup removed entirely (`gasSessionToken`
      gone, one `sessionToken` for everything except a separate
      `resourceManagerToken` scoped just to Manage Resources mutations).
      Two real backend gaps found and closed rather than routed around:
      `POST /auth/verify-pin` added (boolean-only PIN check, no token —
      backs the shared Manager-category gate and the standalone Knowledge
      Base unlock, neither of which map onto `/auth/manager-login`'s
      4-role model); `manager_pins` had no `resources` row seeded despite
      the app expecting one — seeded (`FLT2026`, confirmed still correct).
      `POST /resources/upload` added — uploads straight into the matching
      Drive category folder (finds it by name, creates it if it doesn't
      exist yet), same behavior as the old GAS action, chosen over
      matching Vue's Supabase-backed upload to keep vanilla's exact
      existing behavior. Also fixed a real data-consistency bug found
      along the way: vanilla's Knowledge Base category dropdown still
      saved the old internal codes (`SOP`/`Training Material`/`Note`) that
      predate this session's Vue-side category cleanup — now saves the
      real category names directly, matching Vue, and 3 of 6 Browse
      Courses sections (Warehousing Handbook/eLearning Courses/Halal
      Certificate) that could never show Knowledge content at all
      (`matchContent: () => false`) now can.
      Verified: `/auth/verify-pin` tested with correct/incorrect PIN;
      full Content add → appears in GET → delete → confirmed gone
      roundtrip tested through the running backend with a real Supervisor
      token, cleaned up after; extracted vanilla's script and syntax-
      checked it.
      **In-app file upload dropped from the UI — a real Google platform
      constraint, not fixable in code.** Chased two layers deep: (1) the
      service account only had Viewer access — granted Editor, confirmed
      fixed (no more "Insufficient permissions"); (2) hit Google's actual
      hard limit next — **service accounts have zero storage quota on a
      regular Drive folder**, full stop, regardless of sharing level. Real
      error: *"Service Accounts do not have storage quota. Leverage shared
      drives, or use OAuth delegation instead."* Both real fixes
      (migrating the folder to a Shared Drive, or OAuth delegation acting
      as a real user) need a Google Workspace account, which isn't
      available right now. Rather than ship a button that always fails,
      removed the "Upload a File" UI block and its now-unreachable
      `uploadResourceFile()` function from vanilla entirely — Supervisors
      upload into the Drive folder directly, same as before this session.
      **`POST /resources/upload` stays in the backend, dormant but
      correct** — re-enable the UI block (removed cleanly, not commented
      out) if the folder ever moves to a Shared Drive; the endpoint itself
      needs no changes for that, Shared Drive support is purely a Drive
      API flag (`supportsAllDrives: true`) not yet added since it isn't
      needed until the folder actually moves.
      Not touched, explicitly out of scope: `fetchData()`'s pre-login bulk
      questions+staffRoster fetch still goes through GAS — the new
      backend's equivalents are shaped differently (staff-roster needs
      division+outlet per call, not one bulk list), a separate piece of
      work from the Resources/Content bridge this was scoped to.

## ❌ Not built yet

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
      https://lautan-academy.vercel.app
      (domain changed from lautan-academy-frontend.vercel.app after initial
      deploy — same Vercel project, just the custom domain)
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
- [x] **Deploy pipeline was silently broken on both platforms** — found
      while debugging "my phone still shows the old UI" after several
      `git push`es. Neither `git push` was actually deploying anything;
      every real deploy this whole time (including ones earlier sessions
      recorded as "verified on production") had been manual CLI pushes
      (`vercel --prod` / `railway up`).
      **Vercel**: Production Branch was set to `main` (the repo's default,
      old pre-Vue-migration vanilla content — 49 commits of unrelated
      history), while all real work has only ever lived on `master`.
      Fixed via Project Settings → Environments → Production → Branch
      Tracking → `master`. A second issue surfaced once that was fixed:
      Root Directory wasn't set, so git-triggered builds ran from the
      repo root (no `package.json` there) instead of
      `lautan-academy-frontend/` — `vite: command not found`. Fixed via
      `vercel project update --root-directory lautan-academy-frontend`.
      **Railway**: the backend service had *no* GitHub connection at all
      (not a branch mismatch — genuinely unconnected, CLI-deploy-only
      since creation). Fixed via
      `railway service source connect --repo farmasilautancdr/farmasilautancdr-lautan-academy-backend- --branch main`.
      Verified end-to-end on both: real `git push` → confirmed via each
      platform's API/CLI that a fresh Production deployment was created
      and the live domain served the new build (bundle content diffed,
      not just trusted).

## Known fragility (see CLAUDE.md hard rule 5)

- **In-app resource file upload is dormant, not built into any UI** —
  `POST /resources/upload` exists and is correct, but the Drive service
  account has zero storage quota on the current (regular, non-Shared)
  Drive folder — a real Google platform limit, not fixable in code (see
  the vanilla Resources/Content item above for the full story). Needs the
  folder moved to a Shared Drive (or OAuth delegation set up) before any
  UI can call this. Until then, Supervisors upload into the Drive folder
  directly, outside the app.
- `BACKEND_URL` is a hardcoded constant in `index.html` (`GAS_URL` no
  longer exists — removed 2026-08-11, vanilla no longer talks to GAS at
  all); already caused one real outage this session (stale deployment
  ID). Now also true of `VITE_API_URL` baked into the Vercel build — if
  the Railway URL ever changes, the frontend needs a rebuild, not just a
  var change.
- **Vanilla `index.html`'s real production hosting is GitHub Pages**
  (`https://farmasilautancdr.github.io/LautanAcademy/`, built from
  `master`) — undocumented anywhere until 2026-08-11, discovered only
  after Pages was mistakenly disabled mid-session (see MEMORY.md's
  "Two real production incidents" entry) and staff reported they
  couldn't log in. Depends on a `.nojekyll` file at repo root staying in
  place — without it, GitHub's default Jekyll build fails on every push
  (confirmed: it was failing before this session touched anything) and
  Pages serves nothing. Don't delete `.nojekyll`, and don't assume this
  repo's GitHub Pages setting is dead weight just because a workflow run
  shows red — check what actually depends on it first.
- **RESOLVED 2026-08-11** — Railway's GitHub auto-deploy was broken, not
  just slow: `railway status --json`'s deployment history showed the
  `e6eabff` push had exactly one deployment record, timestamped to match
  a manual `railway up`, not the git push — proof the push never
  triggered anything. Root cause: Railway's GitHub App had lost repo
  access (confirmed via Railway's dashboard reporting "GitHub repo not
  found" once actually checked) — a permissions/installation issue on
  GitHub's side, not a Railway config problem. `service.source.repo`
  still correctly *reported* the linked repo name throughout, which is
  why `railway service source connect` (the CLI-side reconnect, same
  command that fixed the original "no GitHub connection at all" incident
  from earlier this project) did NOT fix it on its own — confirmed by a
  real test push (`a389ad8`) that still didn't auto-deploy after
  reconnecting via CLI. Fixed by reinstalling/reconfiguring Railway's
  GitHub App to include this repo in its access list (GitHub →
  Settings → Installed GitHub Apps → Railway → Configure), then re-
  running the same `service source connect` command once GitHub-side
  access was restored. Verified with two real pushes (`533b601`,
  `b999978`) — both auto-deployed within ~10s, no manual `railway up`
  needed. If this recurs, check GitHub App repo access first, not just
  Railway's own connection command.
- `BACKEND_URL` in `index.html` now points at the Railway URL (was
  `localhost:3000`, dev-only). Same fragility as `GAS_URL` above: it's a
  hardcoded constant, so a future Railway URL change needs a manual edit
  here too, not just an env var.
- **RESOLVED, not a live bug** — Supabase's Direct connection
  (`db.<ref>.supabase.co`) does not work from Railway — it resolves to an
  IPv6 address Railway can't route, and even after forcing IPv4-first DNS +
  disabling Node's Happy Eyeballs (`net.setDefaultAutoSelectFamily(false)`),
  the IPv4 path still hung (likely a firewalled egress, not just an
  address-family issue). Root cause is a Railway network limitation, not
  our code — not fixable from our side. Fixed by switching to Supabase's
  **Session Pooler** connection string instead
  (`aws-0-<region>.pooler.supabase.com`) — that's what's actually set in
  Railway's `DATABASE_URL` now (confirmed working in production), not what's
  in this repo's `.env.example`. Local dev deliberately keeps using Direct
  connection since it works fine here; the pooler is only required for
  Railway specifically — an intentional environment difference, not drift
  to fix.

- Both deploy pipelines were silently disconnected/misconfigured until
  this session (see the Load test section above) — `git push` alone now
  actually deploys, but if either platform ever needs its project
  re-created or re-imported, re-check: Vercel's Production Branch
  (Environments → Production → Branch Tracking) and Root Directory
  (`lautan-academy-frontend`), Railway's service source connection
  (`railway service source connect`). Don't assume a green `git push`
  means it shipped — verify against the live bundle/API, the same way
  this session caught it being broken.
- AI quiz creation from a Drive-backed Browse Courses file only works for
  Google Docs/Slides/Sheets and PDF/docx/pptx/xlsx — legacy binary Office
  formats (.doc/.ppt/.xls, pre-2007) and images silently fall back to the
  generic-knowledge prompt instead of using the file's real content
  (`services/textExtract.js` returns `''` for anything it doesn't
  recognize, by design — not a bug, just an honest gap).
- Quiz History's per-attempt wrong-answer matching only works exactly for
  Module Quiz attempts saved *after* the `attempt_id` migration. Older
  rows (no `attempt_id`) still fall back to matching by topic only,
  which can mix a retaken topic's wrong answers together for that old
  data specifically — new attempts are unaffected.

## Suggested build order (next)

Every item that was tracked as unbuilt is now done, tested, and deployed —
no open checkboxes remain anywhere in this document. Reports and Manage
Staff have also been repointed off the GAS bridge in vanilla, and two real
bugs that surfaced along the way are fixed and deployed (Area Manager
login in vanilla, and a report-submission 403 that had been silently
broken in the already-shipped Vue app since region-scoping). Resources/
Content is the one remaining GAS bridge in vanilla, deliberately deferred.

Since that was last written, the Vue frontend went through a full UI
rework (nav, mobile responsiveness, brand palette/logo, Browse Courses
merged with Knowledge entries, AI quiz creation can now source from Drive
files directly, Supervisor region filters + CSV export), a real Quiz
History data bug got fixed (`attempt_id`), and both deploy pipelines got
fixed after being silently broken (see Known Fragility). Vanilla
`index.html`'s Resources/Content GAS bridge — the one item deliberately
deferred above — is now also repointed; **vanilla no longer talks to GAS
for anything except one pre-login bulk fetch** (see the vanilla section
above for what's still open there).

That's still not the same as "ready to cut over": GAS stays authoritative
until the new stack is proven with real staff usage (see CLAUDE.md). The
honest next step now is real-staff usage before calling any of this
proven — not more build work, a decision about when/how to start relying
on this in production.

Since that was last written, real staff usage surfaced two more issues in
the Vue app, both fixed and verified live:
- Manage Staff's Add row and Reset PIN row overflowed the viewport on
  phones (flex-item `<input>` doesn't shrink below its intrinsic content
  width without an explicit `min-w-0` — see the Manage Staff UI item
  above). Checked the rest of the app for the same pattern; no other
  instances.
- The Vue app had zero PWA setup (no manifest, icons, or service
  worker), so "Add to Home Screen" only ever produced a bare browser
  shortcut, and — separately — reloading or deep-linking to any
  non-root route (e.g. a mid-scroll pull-to-refresh) 404'd on Vercel
  because there was no SPA rewrite for the router's history mode. Fixed
  with `vite-plugin-pwa` (manifest + service worker, reusing the
  existing app icons) and a `vercel.json` catch-all rewrite to
  `index.html`. Verified live: manifest and service worker serve
  correctly, and deep-linked routes return 200 instead of 404.
- New: Assessment Review section added to Quiz History, retail staff
  only — surfaces each staff member's own Area Manager-filed reports
  (topic, skill level, competency, quiz score, product knowledge/gaps/
  recommendations), with year + topic filters and a month/day badge per
  entry. The backend already scoped and returned this data in
  `getScopedData()` for `staff_retail` sessions (`reports.js`/`data.js`
  were untouched) — only the frontend was missing. Warehouse staff have
  no report capability end-to-end (data.js doesn't query reports for
  `staff_warehouse`, and the report form can only target retail staff),
  so the section is gated to retail. Verified live against a real
  filed report. Also fixed a display bug caught right after shipping:
  Quiz Score already includes `%` from the backend, template was
  appending a second one ("73%%").
- Explicitly declined for now: moving "Join a Practice Quiz" off the
  Dashboard into the Quizzes nav group — no page under that group is
  visible to both retail and warehouse staff without further changes,
  so it stays on Dashboard as-is.
- New: topic/year filters + month/day date badges added to Staff Results
  on all three manager roles (Outlet Manager, Warehouse Manager, Area
  Manager — Area Manager's is cascading, year/topic options narrow to
  the outlet filter's current selection), matching the pattern already
  shipped in staff's Assessment Review. New: "Staff Review" page for
  Outlet Manager only (sidebar-gated, not shown to Warehouse Manager) —
  read-only view of Area Manager-filed assessment reports for that
  outlet's staff, same year/topic filter + date badge pattern, each card
  also shows Staff Name since it spans the whole outlet. No backend
  changes — reused `getScopedData()`'s already-outlet-scoped `reports`
  array. Label fix: Area Manager's Assessment form dropped the stray
  "— comments" suffix on the Product Knowledge field. Final whole-branch
  review caught two real runtime bugs the no-test-framework build-only
  verification couldn't have: Area Manager's cascading filter left a
  stale year/topic selection after switching outlets (blank dropdown,
  empty list); the year filter narrowed the visible list but not the
  wrong-answer detail lookup, which still scanned unfiltered data by
  name+topic instead of the real `AttemptID` the backend already
  provides — fixed by porting Quiz History's existing AttemptID-based
  match. A second review pass then caught the fix itself dropping the
  staff-name check in the legacy fallback (cross-staff wrong-answer leak
  for pre-migration rows) — fixed and re-verified. Verified live on
  phone across all 3 manager roles + the new Staff Review page.
