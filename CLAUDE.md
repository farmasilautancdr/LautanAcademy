# CLAUDE.md

# CORE
1. Read MEMORY.md and SCOPE_TRACKER.md on boot.
2. Auto-write to MEMORY.md without asking. Keep text ultra-brief to save tokens.
3. Move old/resolved items from MEMORY.md to ARCHIVE.md to prevent token bloat.
4. Log all mistakes & fixes. Never repeat them.
5. Upon task completion, summarize outcomes to MEMORY.md, check off the item in SCOPE_TRACKER.md (ONLY after verifying programmatically), then prompt the user to `/clear` chat history to reset token burn.
6. Target: Lautan Academy (Internal PWA for Farmasi Lautan. Lautan Academy (formerly PharmAcademy) is an internal PWA for Farmasi Lautan, a Malaysian pharmacy retail chain (50+ outlets, R1–R9 clusters). It's a staff training/quiz platform: role-scoped sessions, AI-generated quizzes, per-attempt tracking, outlet-scoped data access. **Migration from GAS to Vue/Node/Postgres is COMPLETE as of 2026-08-11** — GAS web app deployment decommissioned, Postgres is sole source of truth, no code path anywhere talks to GAS.
7. Stack (new): Vue 3 + Vite + Tailwind (frontend), Node.js + Express + Postgres (backend), Supabase for hosted DB. No other frameworks/libraries added without asking first.

# About me
I'm a self-taught "vibe coder" — no formal CS background, learned by building this in production. I work fast and expect direct, no-filler answers. I primarily work in Bahasa Malaysia for business context, but this codebase is bilingual (BM/EN) — keep both in sync when editing user-facing text.

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

# DELEGATION & WORKFLOWS
- **Model Tiers:** Explicitly set model parameter on EVERY delegated call (Agent-tool or Workflow `agent()`). Never omit.
  - `haiku`: Mechanical bulk work (renames, boilerplate, format conversion, log triage).
  - `sonnet`: Default for well-specified implementation with clear acceptance criteria.
  - `opus`: Tricky work (concurrency, subtle algorithms, adversarial verify/judge panels, gnarly debugging).
  - `fable`: Rare; for context-independent review. ALWAYS ask user first before spawning.
  - *Rule of thumb:* When unsure, pick cheaper model and escalate on failure.
- **Dynamic Workflows (Workflow Tool):**
  - Use when task has 3+ independent parallelizable subtasks or needs a pipeline/judge panel.
  - **Opt-in Rule:** If "ultracode" is NOT active (no keyword/toggle/orchestration request), ask user first with 1–2 sentence shape & cost pitch. If active, invoke directly.
  - **Workflow Agents:** Every `agent()` call MUST specify model explicitly (`haiku`, `sonnet`, or `opus`).
  - **NEVER use `fable` inside a workflow script.** Fable reviews must occur AFTER workflow completes as a standalone Agent-tool call (ask first).

# PLUGINS
- /frontend-design: High-speed, efficient UI matching existing Tailwind tokens (blue/orange).
- /superpowers: Anticipate edge cases (e.g., auth lockouts, state sync). Architect robust systems.
- /context7: Global codebase awareness (Frontend + Backend + DB).
- /caveman: Zero fluff. Extreme brevity. Direct answers only. No "Great question!" preambles.
- playwright: Browser automation MCP. Use to drive the running app (navigate/click/fill/screenshot) and verify a change actually works in-browser, not just eyeball the code.
- impeccable: Design work skill (`/impeccable <command>`). `PRODUCT.md` at repo root has confirmed product truth (users, purpose, positioning, principles) — read it before design work instead of re-asking the user. No `DESIGN.md` yet — run `/impeccable document` to record the incumbent visual system before a redesign, or let a narrow refinement command (`polish`, `critique`, `clarify`, etc.) read the existing CSS/tokens/components directly.

## Frontend & Design Guidelines (Impeccable Rules)

### Core Rules & Anti-Slop Policy
- **No AI Slop:** Strictly avoid purple/blue default gradients, unnecessary card-in-card nesting, generic drop shadows, and default Inter font implementations unless explicitly part of the design system.
- **Token Alignment:** Before modifying or adding UI components, inspect `DESIGN.md` (or Tailwind/CSS config) for existing colors, spacing scale, font weights, and border radii. Never invent arbitrary values (e.g., use `p-4` or `--spacing-md`, not `p-[17px]`).
- **Simplicity First:** Default to cleaner, quieter UI. Remove excess borders, decorative background shapes, and superfluous dividers.
- **Accessibility:** Ensure all text/background combinations pass WCAG AA contrast standards.

### Automatic Workflow on UI Tasks
Whenever editing or creating UI components:
1. **Audit:** Scan the target component against Impeccable design rules.
2. **Normalize:** Reuse existing UI primitives and design tokens.
3. **Polish:** Ensure clear typographic hierarchy, micro-interactions (hover/focus states), and mobile responsiveness.

### Custom Slash Commands Available
- `/impeccable audit <path>` - Static analysis for UI anti-patterns
- `/impeccable polish <target>` - Visual refinement and hierarchy pass
- `/impeccable extract <target>` - Pull reusable tokens/components into the design system