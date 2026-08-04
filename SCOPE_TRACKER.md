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
- [x] Area Manager dashboard — area/outlet picker matching GAS's fixed
      roster (9 areas), Standard Quiz results + wrong answers, and Reports:
      file/edit with duplicate detection + wrong-manager block, Skill Level
      computed client-side from quiz percentage (matches GAS)
- [x] Supervisor dashboard — unscoped PIN-only login, `windowMonths` filter
      (3/6/12 months/all-time), company-wide stats (staff/outlets/avg score)
      + combined Standard+AI activity log, outlet filter
- [x] Router branches staff vs. each of the 4 manager roles, each with its
      own login screen and home redirect
- [x] Manage Staff UI — shared `ManageStaffPanel` component (division prop
      differs) on Outlet + Warehouse Manager dashboards: list, add, Reset
      PIN, remove. Tested in both.

## ✅ Frontend — vanilla (`index.html`) — repointed to new backend, tested

- [x] Staff login, all 4 manager role logins, quiz create/redeem/active/end
      routed through the new backend instead of GAS
- [x] Results/wrong-answers/AI-history routed through new backend
- [x] Dual-token bridge to GAS for whatever isn't migrated yet (Reports,
      Resources, Manage Staff) — known stopgap, see Known Fragility below

## ❌ Not built yet

### Backend
- [ ] Resources (Google Drive-backed reference docs) — lives in Drive, not a
      table. Needs its own Drive API integration if ever migrated; no plan
      to yet.
- [ ] Standard Quiz question bank (topic-based, non-AI quizzes) — GAS's
      Questions sheet was never migrated; no endpoint exists for it at all
- [ ] Rate limiter is in-memory only — resets on restart, not safe across
      multiple instances if ever scaled horizontally

### Frontend (Vue)
- [ ] Resources browsing UI
- [ ] Content/Knowledge Base editor UI (backend CRUD exists, no UI consumes
      the write side yet — quiz-create only reads it)

### Data migration
- [x] Results/WrongAnswers/AIResults/AIWrongAnswers/Content — done, verified
- [ ] Staff roster — only 3 test rows seeded manually so far; real roster
      still lives only in GAS's Sheet
- [ ] Reports data — schema now exists; historical GAS Reports rows still
      not migrated (separate from the schema-rebuild blocker, now resolved)

### Infra
- [x] Postgres — deployed (Supabase)
- [ ] Express backend — local dev only, not deployed anywhere reachable
- [ ] Vue frontend — local dev only (Vite), not deployed
- [ ] Load test with realistic concurrent usage before any real cutover

## Known fragility (see CLAUDE.md hard rule 5)

- Vanilla `index.html` juggles two session tokens (new backend JWT +
  GAS-issued token) to bridge features that haven't migrated yet. Real fix
  is finishing the backend endpoints above so the GAS bridge — and the
  second token — can be removed entirely.
- `GAS_URL` and `BACKEND_URL` are hardcoded constants in `index.html`;
  already caused one real outage this session (stale deployment ID).

## Suggested build order (next)

Reports and Manage Staff (backend + Vue UI, both) done. Remaining:

1. Content/Knowledge Base editor UI (Supervisor-only, backend already there)
2. Staff roster full migration (GAS Sheet → `staff_roster` table)
3. Reports historical data migration (GAS Reports sheet → `reports` table)
4. Deploy backend + frontend somewhere reachable, run parallel to GAS
5. Cutover only once staff have used the new stack for real without issues
