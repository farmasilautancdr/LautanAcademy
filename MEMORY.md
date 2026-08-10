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

[ACTIVE TASK]: i18n (EN/BM) rollout — Phase 1 COMPLETE (2026-08-10), Phase 2 not started.
[DECISIONS]:
- `vue-i18n` (Composition API, `legacy: false`) wired app-wide. `src/i18n/index.js`, locale files `src/i18n/locales/{en,ms}.json` (flat, one top-level namespace per view). `LanguageSwitcher.vue` toggles + persists to `localStorage['lautan_lang']`.
- BM text authored directly by Claude (no paid translation API) — spot-check by native speaker recommended.
- Phase 1 scope (done, 9 commits, `521b194`..`0405f7a`): infra, LanguageSwitcher, 6 standalone login/register views (staff/manager/area-manager/supervisor login, manager/area-manager register), AppSidebar.vue (desktop + mobile nav, role labels, logout).
- Verified: `npm run build` clean, EN/BM key-parity check clean (no missing/extra keys either direction). User confirmed live in browser on `/login` and `/manager-login` — switcher works both directions.
- `LanguageSwitcher.vue` redesigned post-ship per user feedback: segmented pill (was single toggle button), then flags (🇬🇧/🇲🇾) dropped — text-only EN/BM per explicit instruction. Commits `7852f61`, `3f21739`.
[NEXT STEPS]: Phase 2 (not started, not planned) — remaining ~22 views (dashboards for all 5 roles, quiz flow, results, staff panels, resources, reports) + reconcile `QuizView.vue`'s pre-existing local `lang` toggle onto the shared `vue-i18n` mechanism. Write a fresh plan per batch right before executing (translation accuracy). Spec: `docs/superpowers/specs/2026-08-09-i18n-design.md`. Phase 1 plan (reference/done): `docs/superpowers/plans/2026-08-09-i18n-phase1.md`.
[CAVEAT]: No test framework in this frontend (no vitest/jest) — verification is build + manual click-through, not automated tests.
