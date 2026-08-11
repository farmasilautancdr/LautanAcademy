# Master Subsystem H: Outlet/Role Impersonation Switcher ("View As") — Design

**Date:** 2026-08-11
**Status:** Approved, pending plan

## Purpose

Master can view the app exactly as a specific staff member or manager
scope sees it — for support (reproducing a reported issue) and periodic
spot-checks — without knowing/resetting their PIN. View-only: Master can
navigate and read, but cannot perform mutating actions under someone
else's identity.

## Scope decisions (from brainstorming)

- Both support and spot-check use cases matter; design doesn't over-fit to
  either.
- **View-only**, not full interactive. Lowest risk — no accidental real
  writes under a borrowed identity. Enforced backend-wide, not just hidden
  in the UI.
- Target grain = specific account, but "account" means whatever a real
  login already produces — see Scope model below. No new identity concept
  invented.
- Architecture: issue Master a **real scoped JWT** for the target
  (`impersonated: true` claim), enforced GET-only by one global
  middleware. All existing dashboards/history/results views work
  unmodified — this was chosen over building a parallel set of read-only
  Master views, which would mean re-implementing every role's dashboard
  a second time.
- Short fixed expiry (**30 min**) **and** a manual Exit button — both, not
  either/or.
- Impersonation sessions get their own row in the existing `sessions`
  table (Subsystem G) — visible in Active Sessions, force-revocable,
  doesn't collide with a real concurrent login by the same person.
- Roles covered: staff (retail + warehouse) and Outlet/Warehouse/Area
  Manager. **Excluded: Supervisor and Master.** Supervisor login is
  already unscoped/company-wide PIN-only (`scopeKey = 'ALL'`) — there's no
  narrower "account" to view as, and it's the highest-privilege
  non-Master role. Master-as-Master is meaningless.

## Scope model

No new identity table. A target is `{scopeType, scopeKey}`, the exact
shape `issueToken()` already accepts and every existing route already
scopes on:

- `staff_retail` / `staff_warehouse` — scopeKey = `outlet|name`, picked
  from a `staff_roster` search (reuses Subsystem C's
  `GET /master/purge/staff/search` filter pattern: division/outlet/name).
- `outlet_manager` / `warehouse_manager` — scopeKey = outlet code, no
  per-person account exists server-side (confirmed in `auth.js`:
  role+outlet, shared PIN or optional per-outlet `manager_credentials`
  password — either way the scope is role+outlet, not an individual).
  Picked via existing outlet/`WAREHOUSE_LOCATIONS` dropdown convention.
- `area_manager` — scopeKey = area id, picked from `config/areas.js`'s
  `AREAS`.

## Backend

### Token issuance

New `POST /master/impersonate/start` (`requireAuth` + `requireMaster`).
Body `{scopeType, scopeKey}`. Validates the target is real (staff row
exists / outlet or area id is a known value) before issuing anything.

`issueToken(scopeType, scopeKey, opts)` gains an optional
`{ expiresInMinutes, impersonatedBy }` param — default stays the existing
12h (`SESSION_TTL_HOURS`) for real logins (both existing call sites
unchanged, param omitted). Impersonation calls it with
`expiresInMinutes: 30` and `impersonatedBy: req.session.scopeKey` (the
Master username). Internally this builds the SQL interval as
`'30 minutes'` and the JWT's `expiresIn` as `'30m'` — explicit minutes,
not a fractional-hour string (`jsonwebtoken`'s `expiresIn` uses the `ms`
package to parse the string, which does not reliably parse `"0.5h"`).
`impersonated_by` is written into a new nullable `sessions.
impersonated_by` column (same pattern as Subsystem G's `revoked_by`), and
the JWT gets an added `impersonated: true` claim.

```sql
alter table sessions add column if not exists impersonated_by text;
```

No new search endpoint needed — `GET /master/sessions/search` (Subsystem
G) already returns all columns; `MasterActiveSessions.vue` just renders
`impersonatedBy` as a tag when present.

### View-only enforcement

New `blockIfImpersonating` middleware, mounted once globally (same place
as `checkMaintenance`, ahead of every router except `/auth` and
`/master/*`):

```js
export function blockIfImpersonating(req, res, next) {
  if (req.session?.impersonated && req.method !== 'GET') {
    return res.status(403).json({ authorized: false, error: 'View-only — action not permitted while impersonating.' });
  }
  next();
}
```

This is the real security boundary — a single blanket check, not
per-route edits. Frontend hiding (below) is UX only, not relied on for
enforcement.

### Ending impersonation

`POST /master/impersonate/end` (`requireAuth` + `requireMaster`, body
`{sessionId}`) revokes that specific `sessions` row — reuses Subsystem
G's exact revoke path (`revoked_at`, `addRevokedSid`). Force-revoking the
same row via the existing Active Sessions "Force Logout" button works
identically; both converge on one revoke path, so there's exactly one way
a row stops being valid, triggered from two UI entry points.

### Audit logging

Two new `logAudit` call sites (`services/auditLog.js`, existing pattern):
- `impersonation.start` — actor master, summary `Started viewing as
  {scopeType}/{scopeKey}`.
- `impersonation.end` — actor master, summary `Ended impersonation of
  {scopeType}/{scopeKey}` — fired on manual exit, explicit revoke, or
  natural 30-min expiry (the frontend's auto-exit call, see below, hits
  the same `/end` route).

## Frontend

### Session stash (contained to `store/auth.js`)

Real constraint: `api/client.js`'s `getToken()` reads
`localStorage['lautan_token']` directly, and every existing staff/manager
view keys off `useAuthStore`'s `token`/`staff`/`manager`. To reuse those
views unmodified, impersonation must write into those same keys — which
would otherwise clobber a real concurrent session in the same browser.

Fix, entirely inside `store/auth.js`, no other file touched:

- New state: `impersonating: false`.
- New action `startImpersonation(token, staff, manager, sessionId)`:
  copies the current real `token`/`staff`/`manager` (if any) into a
  stash key (`lautan_stash`, JSON), then overwrites `lautan_token`/
  `lautan_staff`/`lautan_manager` with the impersonated identity, sets
  `impersonating = true` and stores `sessionId` (needed for the `/end`
  call).
- New action `exitImpersonation()`: calls `POST /master/impersonate/end`
  with the stored `sessionId`, then restores the stash (or clears to
  logged-out if none existed), clears `impersonating`.

### Auto-exit on expiry

`api/client.js` gains one more special-response branch, same shape as
the existing maintenance-503 handler: on a 401 while
`auth.impersonating` is true, dynamically import `store/auth.js` and
call `exitImpersonation()`, then redirect to `/`. This is the natural
30-min-expiry path — no separate frontend timer needed, the JWT's own
`exp` is authoritative.

### UI

- Fixed top banner while impersonating: "Viewing as {role/staff} — Exit".
  Exit button calls `exitImpersonation()`.
- Hide the primary mutating entry points per role while impersonating
  (`auth.impersonating` gate) — Join/Start Quiz (staff), Create Quiz +
  Manage Staff add/reset/remove (outlet/warehouse manager), File/Edit
  Report (area manager). This avoids a confusing 403 on click; the
  backend's blanket GET-only block is what's actually relied on.
- `MasterImpersonation.vue`, wired into `MasterPanel.vue`'s already-
  reserved `impersonation` tab (`TABS` array already has the key — add to
  `ENABLED_TABS`). Role/type select → staff search or outlet/area
  dropdown → Start button → calls `startImpersonation()`, closes the
  Master Panel, banner appears.

EN/MS strings per existing bilingual convention.

## Edge cases

- Revoking via Active Sessions and expiring naturally both converge on
  the same `/end`-equivalent revoke path (see Ending impersonation
  above) — one behavior, two triggers.
- Logging into a real staff/manager account *while* impersonating (not
  blocked) writes into the same `lautan_token` key impersonation
  currently occupies; exiting afterward would restore the wrong
  (pre-impersonation) stash. Rare, flagged rather than fixed — matches
  this project's existing convention for edge cases like this (see
  Subsystem C/F's similar flagged-not-fixed notes).
- Master's own token (`lautan_master_token`) is never touched by any of
  this — only the shared staff/manager keys are stashed/restored, same
  isolation guarantee Subsystem A already established.

## Testing / verification plan

- `curl`: `impersonate/start` with a real staff target → confirm a
  `sessions` row with `impersonated_by` set, JWT decodes with
  `impersonated: true` and a 30-min `exp`.
- `curl`: any mutating route (e.g. `POST /data/results`) with an
  impersonation token → 403 with the view-only message; the same
  route's matching `GET` still works.
- `curl`: `impersonate/end` → confirm the very next request on that
  token 401s immediately (same direct-cache-write path Subsystem G
  proved).
- `curl`: force-revoke an impersonation session via
  `POST /master/sessions/:id/revoke` (existing Subsystem G route) →
  confirm it also 401s immediately, and an `audit_log` row exists for
  both `impersonation.start` and the revoke.
- `curl`: `impersonate/start` with an invalid outlet/area/staff target →
  400, nothing issued.
- `curl`: attempt manager-role targets against Supervisor/Master
  scopeType → rejected (400, not a valid target).
- `npm run build` clean (frontend).
- EN/BM key-parity script clean.
- Live browser click-through: start impersonation as a real throwaway
  staff/manager test account (not live production credentials — same
  caution as prior subsystems), confirm the dashboard/history renders as
  that identity, mutating buttons are hidden, Exit restores Master's own
  panel state, a real concurrent session (if any) survives the
  stash/restore round-trip, both EN and MS.
