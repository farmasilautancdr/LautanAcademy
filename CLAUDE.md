# Lautan Academy — Project Instructions

## About this project
Lautan Academy (formerly PharmAcademy) is an internal PWA for Farmasi Lautan,
a Malaysian pharmacy retail chain (50+ outlets, R1–R9 clusters). It's a
staff training/quiz platform: role-scoped sessions, AI-generated quizzes,
per-attempt tracking, outlet-scoped data access.

Stack: vanilla JS + Tailwind CDN (frontend), Google Apps Script + Sheets
(backend), Gemini API for quiz generation. No framework, no build step —
keep it that way unless explicitly told otherwise.

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

## Style
- Terse. No filler, no "Great question!" preambles.
- Code comments in English; user-facing strings need both `_en` and `_ms`
  variants where the pattern already exists.
- Match existing code conventions in the file you're editing over
  "best practice" conventions from elsewhere — consistency with this
  codebase matters more than textbook style.
