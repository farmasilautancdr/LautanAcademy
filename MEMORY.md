# MEMORY.md

# MEMORY
*Update autonomously. Keep ultra-brief. Move old data to ARCHIVE.md.*

[STACK]: Vue 3, Vite, Tailwind | Node.js, Express, Postgres (Supabase) | JWT auth, native bcrypt.
[STRUCTURE]: Monorepo (`/frontend` and `/backend`). Vercel root -> `frontend`. Railway root -> `backend`. Branch -> `master`.
[RULES]: Bilingual (EN/MS) for UI strings. No new frameworks/libs without asking. Match existing file styles. Old GAS version remains authoritative until full migration.
[DECISIONS]: Switched to native bcrypt to prevent single-thread blocking during concurrent logins. Unified repository into monorepo (`LautanAcademy-App`).
[MISTAKES]: 
- `standard_questions.id` string/int mismatch caused 0 scoring (Fixed).
- Grading trusted client arrays instead of DB authoritative row count (Fixed).
- Area Manager scoping bypassed in vanilla login (Fixed).
[FRAGILITY]: In-app Drive resource upload UI is dormant due to Google Workspace service account storage quotas.
[ACTIVE TASK]: None.
[NEXT STEPS]: User to visually verify PasswordField eye-toggle in browser (dev server running at localhost:5173) — no browser tool available this session, only verified via Vite compile (no errors) + code review.
[DECISIONS]: Added shared `src/components/PasswordField.vue` (eye-toggle show/hide) for Manager/Area Manager/Supervisor PIN+password fields (7 views, 10 inputs). Spec: `docs/superpowers/specs/2026-08-09-password-visibility-toggle-design.md`. NOT applied to ManageStaffPanel.vue (staff PIN, out of scope).