# CLAUDE.md

# CORE
1. Read MEMORY.md and SCOPE_TRACKER.md on boot.
2. Auto-write to MEMORY.md without asking. Keep text ultra-brief to save tokens.
3. Move old/resolved items from MEMORY.md to ARCHIVE.md to prevent token bloat.
4. Log all mistakes & fixes. Never repeat them.
5. Upon task completion, summarize outcomes to MEMORY.md, check off the item in SCOPE_TRACKER.md (ONLY after verifying programmatically), then prompt the user to `/clear` chat history to reset token burn.
6. Target: Lautan Academy (Internal PWA for Farmasi Lautan. Lautan Academy (formerly PharmAcademy) is an internal PWA for Farmasi Lautan,
a Malaysian pharmacy retail chain (50+ outlets, R1–R9 clusters). It's a staff training/quiz platform: role-scoped sessions, AI-generated quizzes, per-attempt tracking, outlet-scoped data access. Full production migration from GAS to Vue/Node/Postgres).
7. Stack (new): Vue 3 + Vite + Tailwind (frontend), Node.js + Express + Postgres (backend), Supabase for hosted DB. No other frameworks/libraries added without asking first.

# About me
I'm a self-taught "vibe coder" — no formal CS background, learned by
building this in production. I work fast and expect direct, no-filler
answers. I primarily work in Bahasa Malaysia for business context, but
this codebase is bilingual (BM/EN) — keep both in sync when editing
user-facing text.

# PATHS & COMMANDS
- Frontend Root: `/frontend` -> `cd frontend && npm run dev`
- Backend Root: `/backend` -> `cd backend && npm run dev`
- Root Files: `CLAUDE.md`, `MEMORY.md`, `SCOPE_TRACKER.md`

# ACTIVE INITIATIVES
- Master User / Super Admin role + Control Panel — 8-subsystem build (A-H), see MEMORY.md for breakdown + order. Security-sensitive: RBAC bypass, hard delete, impersonation. Full brainstorm/spec/plan cycle per subsystem, no shortcuts.

# HARD RULES
- **Ask First:** Never assume ambiguous fields, data shapes, or locations.
- **Show the Plan:** Before touching files for anything beyond a 1-line fix, explain the changes and wait for clearance.
- **Verify Programmatically:** Test end-to-end (curl/browser/DB checks), don't just eyeball. State exactly *how* it was verified.
- **Scope Strictness:** Don't touch unrelated code/bugs unless asked. Don't expand scope silently.
- **Honesty:** Flag fragile workarounds explicitly. Don't present hacks as clean fixes.
- **Style:** Terse, no filler. Code comments in English, user-facing text in EN & MS (Bahasa Malaysia). Match existing file conventions over textbook best practices.

# PLUGINS
- /frontend-design: High-speed, efficient UI matching existing Tailwind tokens (blue/orange).
- /superpowers: Anticipate edge cases (e.g., auth lockouts, state sync). Architect robust systems.
- /context7: Global codebase awareness (Frontend + Backend + DB).
- /caveman: Zero fluff. Extreme brevity. Direct answers only. No "Great question!" preambles.