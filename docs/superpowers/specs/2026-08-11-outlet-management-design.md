# Outlet & Area Management — Design

**Date:** 2026-08-11
**Status:** Approved, pending plan

## Purpose

Outlet codes, area (R1-R9) groupings, and warehouse location names are
currently hardcoded and duplicated across ~10 frontend files
(`config/areas.js`, 3 copies of `OUTLET_LIST`, 8 copies of
`WAREHOUSE_LOCATIONS`) plus a separate backend `config/areas.js` copy.
Adding, removing, or reassigning an outlet today means editing multiple
files correctly in sync and redeploying. As the company grows (new
outlets, new regions), this needs to be editable by Master from the app,
with zero code changes or redeploys.

## Scope decisions (from brainstorming)

- **Master only** can create/edit/deactivate outlets and areas — not
  Area Managers. Matches how the other Master subsystems (purge, audit,
  impersonation) are scoped: sensitive, single privileged role.
- **Soft-delete, not hard delete.** Removing an outlet/area sets
  `active = false`. It disappears from dropdowns and new registration,
  but existing logins, `staff_roster`, `results`, `reports`, etc. that
  already reference the code keep working unchanged. No hard-delete
  endpoint exists at all — deliberately, to avoid needing to check
  referential integrity across the 6+ tables that reference an outlet
  code by free text.
- **Both areas and outlets are editable**, not just outlets within fixed
  areas — the real growth scenario includes opening a whole new region
  (e.g. R10), not only adding an outlet to an existing one.
- **Warehouse locations are included** in the same system (not left
  hardcoded) — one underlying table fixes all the duplication in one
  pass instead of leaving 8 files still hardcoded.
- **Area id/label split.** Today an area's id doubles as its label
  (`"R1 - AMIRUL"` — region code + manager name baked together), so a
  manager change forces an id change everywhere it's referenced. New
  `areas` table splits this into a stable `id` (`'R1'`) and an editable
  `label` (`'AMIRUL'`) — renaming the area's manager only touches the
  label, outlets keep pointing at the same stable id.

## Data model

```sql
create table areas (
  id text primary key,        -- 'R1'..'R9', new ones added freely by Master
  label text not null,        -- 'AMIRUL' — the editable part
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table store_outlets (
  code text primary key,      -- 'DG', 'AJ', or 'Taskforce' for warehouse —
                               -- stored with the exact casing today's
                               -- arrays already use (retail uppercase,
                               -- warehouse title-case); auth.js's existing
                               -- uppercase-on-write for scope_key is
                               -- unchanged/orthogonal to this table.
  division text not null,     -- 'retail' | 'warehouse' — mirrors
                               -- staff_roster.division
  area_id text references areas(id),  -- null for warehouse (no area
                                       -- concept for warehouse today)
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index store_outlets_area_idx on store_outlets (area_id);
```

Named `store_outlets`, not `outlets` — this Supabase project already has an
unrelated `outlets` table (with dependent `staff`/`quizzes`/`attempts`/
`manager_reviews` tables belonging to a different app entirely, none of
which match this codebase's own `schema.sql`) sharing the same DB.
Discovered during implementation, not anticipated when this spec was first
written — left untouched, same reasoning as `schema.sql`'s existing
`standard_questions` table (renamed away from a similar unrelated `questions`
table). This only affects the Postgres identifier — every HTTP route,
JSON field, and frontend name in this spec (`GET /outlets`, `useOutlets`,
etc.) is unaffected.

## Backend

### Public read endpoints

New `routes/outlets.js`, mounted **without** `requireAuth` (same pattern
as the existing public `questionsRouter`, mounted with only
`checkMaintenance`):

- `GET /outlets?division=retail|warehouse` — active outlets only.
- `GET /areas` — active areas only, each with its active outlet codes
  (replaces `outletsForArea()`).

These back every login/registration dropdown
(`LoginView`, `ManagerLoginView`, `ManagerRegisterView`) and any other
call site that currently imports the static `AREAS`/`OUTLET_LIST`/
`WAREHOUSE_LOCATIONS` arrays.

### Master write endpoints

New `routes/masterOutlets.js`, mounted at `/master/outlets` with
`requireAuth, requireMaster` (same as `masterPurgeRouter`,
`masterSessionsRouter`):

- `POST /master/outlets/areas` — create area `{id, label}`. 409 on
  duplicate id.
- `PATCH /master/outlets/areas/:id` — edit `label`, and/or toggle
  `active` true/false (reactivating a mistakenly-deactivated area is
  just setting `active=true` again — same endpoint, no separate
  "restore" route). Setting `active=false` on an area with any active
  outlets under it is blocked (400: "deactivate/reassign its outlets
  first") rather than silently orphaning them.
- `POST /master/outlets` — create outlet `{code, division, area_id}`.
  409 on duplicate code. `area_id` required if `division='retail'`,
  must be null if `division='warehouse'`.
- `PATCH /master/outlets/:code` — toggle `active` true/false (covers
  both deactivate and reactivate). No rename endpoint, since `code` is
  the primary key other tables reference by text; renaming would
  silently break those joins.

Every write calls `logAudit()` (`services/auditLog.js`, existing
pattern) — actor `master`, actions `area.create` / `area.update` /
`outlet.create` / `outlet.deactivate`.

### Existing call sites refactored

`auth.js`'s `outletsForArea(areaId)` import becomes a DB query
(`select code from store_outlets where area_id=$1 and active`) used the same
way it is today for area-manager PIN/registration validation.
`reports.js`, `data.js`, `masterImpersonate.js` get the same swap
wherever they currently import `AREAS`. Backend `config/areas.js` is
deleted once nothing imports it.

## Frontend

- Frontend `config/areas.js` deleted.
- New shared composable `useOutlets()` (division-filtered fetch from
  `GET /outlets`, plus `useAreas()` or a combined fetch for the area-
  grouped view) replaces the 3 `OUTLET_LIST` copies and 8
  `WAREHOUSE_LOCATIONS` copies. This is the one new abstraction in this
  design — justified because it's collapsing an already-duplicated
  pattern (11 copies), not introducing a speculative one.
- No client-side caching layer beyond component-local state — the table
  is ~60 rows total, a plain fetch on mount is cheap enough; no TTL/
  invalidation logic needed (YAGNI).
- New Master panel tab `outlets`, component `MasterOutletsPanel.vue`,
  added to `MasterPanel.vue`'s existing `TABS`/`ENABLED_TABS` arrays
  (same pattern as `auditLogs`, `dataPurge`, `sessions`, etc.). UI:
  areas listed with their outlets nested underneath, inline
  add-outlet/deactivate-outlet per area, "Add Area" action at the top,
  deactivate-area action per area (blocked server-side if it still has
  active outlets, per above).
- EN/MS strings added per the existing bilingual convention.

## Migration / seed

One-time script (run once against the DB, not a code path that ships)
inserts the current 9 areas (`R1..R9` + label parsed from today's
combined id strings), the 50 retail outlet codes with their `area_id`,
and the 4 warehouse locations (`division='warehouse'`, `area_id=null`)
— copied verbatim from the existing arrays so nothing changes for users
on cutover day.

## Edge cases

- Deactivating an outlet that a manager is currently logged into: their
  existing session/JWT keeps working until it naturally expires (same
  as today — nothing currently force-logs-out on outlet changes); they
  just can't be selected again from a dropdown or re-register against
  afterward.
- `outlets.code` has no rename — only create and deactivate. If a code
  was genuinely mistyped at creation, the fix is deactivate the wrong
  one and create the correct one (mirrors the "no hard delete" simplicity
  choice rather than adding rename-with-cascade logic).
- Area deactivation blocked while active outlets exist under it (see
  Backend section) — prevents silently orphaning outlets with a null
  reference to a hidden area.

## Testing / verification plan

- `curl`: `GET /outlets`, `GET /areas` with no auth header → 200,
  active-only results.
- `curl`: `POST /master/outlets` / `/master/outlets/areas` without a
  Master token → 401/403; with a Master token → 200, row created,
  `audit_log` entry written.
- `curl`: duplicate `code`/`id` on create → 409.
- `curl`: `PATCH /master/outlets/areas/:id` with `active=false` on an
  area that still has active outlets → 400, area untouched.
- `curl`: area-manager login (`POST /auth/manager-login` with an area
  id) still scopes correctly using the DB-backed `outletsForArea`
  equivalent — same behavior as before the migration, verified against
  a real area id.
- `npm run build` clean (frontend).
- EN/BM key-parity script clean.
- Live browser click-through: Master adds a new outlet via the panel,
  confirms it appears in `ManagerLoginView`'s dropdown with no redeploy;
  deactivates an existing (non-production) test outlet, confirms it
  disappears from dropdowns while an already-logged-in session and its
  historical results/reports are unaffected.
- Grep the repo post-refactor for `OUTLET_LIST`, `WAREHOUSE_LOCATIONS`,
  and `config/areas` to confirm zero leftover hardcoded copies.
