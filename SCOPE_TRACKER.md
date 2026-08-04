# Lautan Academy — Vue + Node/Postgres Rewrite Scope Tracker

Reflects verified state as of this migration's current session — every
checked item has been tested end-to-end (curl and/or real browser), not
just written. See CLAUDE.md hard rule 6: don't check an item until it's
built AND verified.

## ✅ Backend (`lautan-academy-backend`, Express + Postgres/Supabase) — built & tested

- [x] Postgres schema: `staff_roster`, `manager_pins`, `content`, `results`,
      `wrong_answers`, `ai_results`, `ai_wrong_answers`, `ai_quizzes`,
      `reports` (stub — see gaps below)
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
      verified row counts and spot-checked data format after (`scripts/migrate-from-gas.js`)

## ✅ Frontend — Vue (`lautan-academy-frontend`) — built & tested

- [x] Staff login — outlet + name dropdowns (outlet list static, names from
      the public roster endpoint), division + PIN
- [x] AI Practice: join-by-passcode from dashboard
- [x] Quiz taking — bilingual toggle, instant correct/wrong reveal per answer
      (locked in once picked, matches vanilla app's behavior)
- [x] Result screen — score, pass/fail state, missed-questions breakdown
- [x] Recent-attempts list on dashboard (from `/data/scoped-data`)

## ✅ Frontend — vanilla (`index.html`) — repointed to new backend, tested

- [x] Staff login, all 4 manager role logins, quiz create/redeem/active/end
      routed through the new backend instead of GAS
- [x] Results/wrong-answers/AI-history routed through new backend
- [x] Dual-token bridge to GAS for whatever isn't migrated yet (Reports,
      Resources, Manage Staff) — known stopgap, see Known Fragility below

## ❌ Not built yet

### Backend
- [ ] Reports (Area Manager write-ups) — GAS's Reports sheet has ~15 columns
      (skill level, competency comments, fluency, housebrand focus, etc.);
      this backend's `reports` table is a 3-column stub. Real schema work,
      not a quick add.
- [ ] Resources (Google Drive-backed reference docs) — lives in Drive, not a
      table. Needs its own Drive API integration if ever migrated; no plan
      to yet.
- [ ] Content management writes (add/delete Knowledge Base entries) — reads
      exist in schema but nothing populates `content` going forward; GAS
      Content sheet still the only place entries are added/removed
- [ ] Manage Staff roster CRUD + passcode lookup — GAS shows managers the
      plaintext passcode for lookup; this backend hashes PINs (correct
      practice) so that specific feature can't be replicated as-is, would
      need a "reset" UX instead of "look up"
- [ ] Standard Quiz question bank (topic-based, non-AI quizzes) — GAS's
      Questions sheet was never migrated; no endpoint exists for it at all
- [ ] Rate limiter is in-memory only — resets on restart, not safe across
      multiple instances if ever scaled horizontally

### Frontend (Vue)
- [ ] Outlet Manager dashboard (create quiz, view outlet results/roster)
- [ ] Warehouse Manager dashboard
- [ ] Area Manager dashboard (cross-staff reporting)
- [ ] Supervisor dashboard (company-wide view, `windowMonths` filter)
- [ ] Reports UI
- [ ] Resources browsing UI
- [ ] Manage Staff UI
- [ ] Content/question bank editor UI

### Data migration
- [x] Results/WrongAnswers/AIResults/AIWrongAnswers/Content — done, verified
- [ ] Staff roster — only 3 test rows seeded manually so far; real roster
      still lives only in GAS's Sheet
- [ ] Reports data — blocked on the schema rebuild above

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

1. Outlet Manager dashboard in Vue (create-quiz flow, mirrors what's already
   working in the vanilla app) — highest-value next step, backend's ready
2. Warehouse/Area Manager, then Supervisor dashboards in Vue
3. Reports schema rebuild (backend) + Reports UI (Vue)
4. Manage Staff CRUD (backend, passcode-reset UX not lookup) + UI
5. Staff roster full migration (GAS Sheet → `staff_roster` table)
6. Deploy backend + frontend somewhere reachable, run parallel to GAS
7. Cutover only once staff have used the new stack for real without issues
