# MEMORY.md

# MEMORY
*Update autonomously. Keep ultra-brief. Move old data to ARCHIVE.md.*

[STACK]: Vue 3, Vite, Tailwind | Node.js, Express, Postgres (Supabase) | JWT auth, native bcrypt.
[STRUCTURE]: Frontend repo `lautan-academy-frontend/` (this repo). Backend is a SEPARATE sibling repo `C:\Users\Hafiz\projects\lautan-academy-backend` (not `/backend` in this repo, despite CLAUDE.md). Branch -> `master`, direct commits (no feature-branch workflow used).
[RULES]: Bilingual (EN/MS) for UI strings. No new frameworks/libs without asking. Match existing file styles. Old GAS version remains authoritative until full migration.
[DECISIONS]: Switched to native bcrypt to prevent single-thread blocking during concurrent logins.
[MISTAKES]:
- `standard_questions.id` string/int mismatch caused 0 scoring (Fixed).
- Grading trusted client arrays instead of DB authoritative row count (Fixed).
- Area Manager scoping bypassed in vanilla login (Fixed).
[FRAGILITY]: In-app Drive resource upload UI is dormant due to Google Workspace service account storage quotas.

[ACTIVE TASK]: i18n (EN/BM) rollout — Phase 1 COMPLETE (2026-08-10). Phase 2 Batch 1 (staff quiz flow) COMPLETE (2026-08-10). Phase 2 Batch 2 (Outlet Manager group) COMPLETE (2026-08-10) — build-verified after every task, key-parity clean (278/278), user-confirmed live in browser (all switches working correctly). 2 more Phase 2 batches not started.
[DECISIONS]:
- `vue-i18n` (Composition API, `legacy: false`) wired app-wide. `src/i18n/index.js`, locale files `src/i18n/locales/{en,ms}.json` (flat, one top-level namespace per view). `LanguageSwitcher.vue` toggles + persists to `localStorage['lautan_lang']`.
- BM text authored directly by Claude (no paid translation API) — spot-check by native speaker recommended, still outstanding across all batches.
- Phase 1 scope (done, 9 commits, `521b194`..`0405f7a`): infra, LanguageSwitcher, 6 standalone login/register views (staff/manager/area-manager/supervisor login, manager/area-manager register), AppSidebar.vue (desktop + mobile nav, role labels, logout).
- `LanguageSwitcher.vue` redesigned post-ship per user feedback: segmented pill (was single toggle button), then flags (🇬🇧/🇲🇾) dropped — text-only EN/BM per explicit instruction. Commits `7852f61`, `3f21739`.
- Phase 2 Batch 1 (done, 6 commits `c25f489`..`1576f65`, plan `docs/superpowers/plans/2026-08-10-i18n-phase2-batch1.md`): DashboardView, ModuleQuizView, QuizView, ResultView, QuizHistoryView, ResourcesView. Also closed the Phase 1 spec's flagged "open risk": `QuizView.vue`'s separate local `lang` ref (drove question `_en`/`_ms` text) is gone, replaced by the shared `useI18n().locale` + `<LanguageSwitcher />` — question-content language and UI-chrome language are now one switch, not two.
- Vue-i18n pluralization pattern established for count strings: `en.json` uses `"{count} thing | {count} things"` (pipe syntax, vue-i18n picks form from `t(key, count)`); `ms.json` uses one form only (BM doesn't inflect for plural) — vue-i18n falls back to it regardless of count, this is correct, not a gap.
- `ResourcesView.vue`'s manager-role header label reuses Phase 1's `sidebar.roleOutletManager`/etc. keys instead of a duplicate copy — pattern to reuse for any future view needing the same 4 role labels.
- Verified (Batch 1): `npm run build` clean after every task, EN/BM key-parity check clean (212 keys each side, no missing either direction), user confirmed live in browser (dashboard/module quiz/quiz taking incl. reconciled lang switch/result/quiz history/resources) — all switching correctly both directions.
- Phase 2 Batch 2 (done, 5 commits `72ebd4a`..`dc38d83`, plan `docs/superpowers/plans/2026-08-10-i18n-phase2-batch2.md`): OutletManagerDashboard, OutletManagerResultsView, ManageStaffPanel (shared component — also used by WarehouseManagerDashboard, so that usage's Manage Staff section is now bilingual too as a side effect; WarehouseManagerDashboard's own page chrome is still Batch 3), OutletManagerStaffView, OutletManagerStaffReviewView. All 4 views' "Outlet Manager" header label reuses Phase 1's `sidebar.roleOutletManager` key (same pattern as Batch 1's ResourcesView). `confirm()` dialog strings (End quiz code, Remove staff) also translated via `t()`. Verified: `npm run build` clean after each of 5 tasks, EN/BM key-parity clean (278 keys/side), user confirmed live in browser (all 4 views + ManageStaffPanel, all switches working correctly).
[NEXT STEPS]: 2 more Phase 2 batches planned but not written/executed: Warehouse+Area Manager group (WarehouseManagerDashboard, WarehouseManagerResultsView, WarehouseManagerStaffView, AreaManagerDashboard, AreaManagerReviewsView), Supervisor group (SupervisorDashboard, SupervisorAddResourcesView, SupervisorReportsView, SupervisorStaffComparisonView, SupervisorManagerAccessView). Write a fresh plan per batch right before executing (translation accuracy) — same process as Batch 1/2. Spec: `docs/superpowers/specs/2026-08-09-i18n-design.md`. Plans: Phase 1 `docs/superpowers/plans/2026-08-09-i18n-phase1.md`, Phase 2 Batch 1 `docs/superpowers/plans/2026-08-10-i18n-phase2-batch1.md`, Phase 2 Batch 2 `docs/superpowers/plans/2026-08-10-i18n-phase2-batch2.md`.
[CAVEAT]: No test framework in this frontend (no vitest/jest) — verification is build + manual click-through, not automated tests.
