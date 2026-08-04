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
      region; Reports: file/edit with duplicate detection + wrong-manager
      block, outlet-then-staff picker (names aren't unique across the
      region), Skill Level computed client-side from quiz percentage
      (matches GAS). Region→outlet mapping is now canonical server-side
      (`config/areas.js`, backend), not just a client-side dropdown copy.
      Verified: region mapping logic (9 regions, no outlet in >1 region,
      unknown area rejected) and the `ANY($1)` scoping query against the
      real schema. **Not yet verified**: a real area_manager login end-to-
      end — `results`/`wrong_answers`/`reports` are all empty in the DB
      right now, so there's no real cross-outlet data to prove the join
      against, and I didn't touch the real (hashed, production) PIN to
      manufacture a test case.
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
- [x] Resources browsing UI — category + subcategory filter dropdowns,
      staff dashboard only (deliberate scope decision, not yet built for
      manager dashboards)
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
- [ ] Standard Quiz question bank (topic-based, non-AI quizzes) — GAS's
      Questions sheet was never migrated; no endpoint exists for it at all
- [ ] Rate limiter is in-memory only — resets on restart, not safe across
      multiple instances if ever scaled horizontally

### Frontend (Vue)
- [ ] Resources browsing UI on manager dashboards (staff-only today, by
      explicit scope decision — not a bug, just not built)

### Data migration
- [x] Results/WrongAnswers/AIResults/AIWrongAnswers/Content — done, verified
- [x] Staff roster — 20 real staff migrated (names/outlets/divisions only —
      GAS never exposes passcodes in bulk, only per-outlet behind manager
      auth). Each needs an explicit Reset PIN via Manage Staff UI before
      that account can log in — intentional, not a bug
      (`scripts/migrate-staff-roster-names.js`, safe to re-run)
- [x] Reports data — synced, GAS had 0 historical rows (feature was
      apparently unused there too) (`scripts/sync-reports-from-gas.js`)

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
- [ ] Load test with realistic concurrent usage before any real cutover

## Known fragility (see CLAUDE.md hard rule 5)

- Vanilla `index.html` juggles two session tokens (new backend JWT +
  GAS-issued token) to bridge features that haven't migrated yet. Real fix
  is finishing the backend endpoints above so the GAS bridge — and the
  second token — can be removed entirely.
- `GAS_URL` and `BACKEND_URL` are hardcoded constants in `index.html`;
  already caused one real outage this session (stale deployment ID). Now
  also true of `VITE_API_URL` baked into the Vercel build — if the Railway
  URL ever changes, the frontend needs a rebuild, not just a var change.
- **`BACKEND_URL` in `index.html` is currently `http://localhost:3000`**
  (line 720) — the new-backend calls in vanilla (staff login, quiz
  create/redeem/active/end, results) only work when opened on this dev
  machine with the local backend running. Not yet repointed to the Railway
  URL. Unclear if vanilla is meant to hit the new backend in production at
  all yet — needs a decision, not an assumption.
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
route-split, security hardening, Area Manager region-scoping, and Supervisor
Cross-Outlet pages are all done. Remaining, unordered — ask before picking
one:

1. Decide vanilla `index.html`'s `BACKEND_URL` — point it at Railway for
   real staff use, or leave it dev-only if GAS stays authoritative for now
2. Standard Quiz question bank migration (topic-based, non-AI) — no plan
   exists yet, GAS's Questions sheet was never even inventoried
3. Resources UI on manager dashboards (currently staff-only by choice)
4. Rate limiter durability (in-memory, resets on restart)
5. Load test before any real cutover
6. Real end-to-end test of Area Manager region-scoping once real usage (or
   a deliberately-authorized test PIN reset) makes that possible — logic is
   verified in isolation but not proven against real cross-outlet data
