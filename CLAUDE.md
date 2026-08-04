# Lautan Academy — Project Instructions

## About this project
Lautan Academy (formerly PharmAcademy) is an internal PWA for Farmasi Lautan,
a Malaysian pharmacy retail chain (50+ outlets, R1–R9 clusters). It's a
staff training/quiz platform: role-scoped sessions, AI-generated quizzes,
per-attempt tracking, outlet-scoped data access.

Currently mid-migration from Google Apps Script + Sheets to Vue + Node.js/
Express + Postgres, as a full production replacement (not a side experiment).
Old GAS version stays live and authoritative until the new stack fully
matches its feature set and is proven with real staff usage.

Stack (new): Vue 3 + Vite + Tailwind (frontend), Node.js + Express + Postgres
(backend), Supabase for hosted DB. No other frameworks/libraries added
without asking first.

## Current build order
Follow `SCOPE_TRACKER.md` in this repo. At the start of a session, check it
first. Work through unchecked items top to bottom unless I say otherwise.
Check items off as they're completed AND verified — not just written.
If an item turns out bigger than expected, stop and tell me before
continuing, don't silently expand scope.

## About me
I'm a self-taught "vibe coder" — no formal CS background, learned by
building this in production. I work fast and expect direct, no-filler
answers. I primarily work in Bahasa Malaysia for business context, but
this codebase is bilingual (BM/EN) — keep both in sync when editing
user-facing text.

## Hard rules — do not violate these

1. **Do not assume. Ask first.**
   If something is ambiguous — a field name, a data shape, which file
   owns a piece of logic, what "done" means for a task — ask me before
   writing code. Don't guess and proceed.

2. **Show the plan before you build.**
   For anything beyond a one-line fix: tell me which files you'll touch
   and what you'll change, before you touch them. Wait for my go-ahead
   on anything non-trivial.

3. **Verify programmatically, not visually.**
   After making a change, don't just eyeball the code and declare it
   done. Run actual checks: syntax validation, ID cross-referencing
   between frontend/backend, trace the data flow end-to-end. Tell me
   what you verified and how.

4. **Don't touch scope I didn't ask about.**
   If you spot an unrelated bug or improvement while working, mention
   it — don't fix it inline unless I say to.

5. **Be honest about fragility.**
   If a fix is a workaround rather than a real solution, say so
   explicitly. Don't present hacky patches as clean fixes.

6. **Don't mark SCOPE_TRACKER.md items done prematurely.**
   A checkbox only gets checked after the feature is built AND verified
   working — not just scaffolded.

## Style
- Terse. No filler, no "Great question!" preambles.
- Code comments in English; user-facing strings need both `_en` and `_ms`
  variants where the pattern already exists.
- Match existing code conventions in the file you're editing over
  "best practice" conventions from elsewhere — consistency with this
  codebase matters more than textbook style.
