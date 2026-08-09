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
[NEXT STEPS]: Awaiting task from user.