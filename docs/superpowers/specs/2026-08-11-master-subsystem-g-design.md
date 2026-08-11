# Master Subsystem G: Active Sessions + Force-Logout — Design

**Date:** 2026-08-11
**Status:** Approved, pending plan

## Purpose

Master can see active staff/manager sessions and kill one (or a filtered
group) on demand — e.g. a lost phone, a leaked shared manager PIN, or a
staff member who needs to be logged out immediately.

## Constraints found during design

- Current auth is **fully stateless JWT** — `requireAuth`
  (`middleware/auth.js`) only calls `jwt.verify()`, no DB round-trip, no
  session concept exists anywhere. This is a real architecture change, not
  a UI-only addition like most prior subsystems.
- Client-side "logout" today (`store/auth.js`) only clears `localStorage` —
  there is no backend call, so a stolen/leaked token stays valid until its
  JWT naturally expires (12h for staff/managers) regardless of what the
  legitimate owner does on their own device.
- Master's own login/token (Subsystem A, `issueMasterToken`) is explicitly
  **out of scope** — decided during brainstorming: too few Master accounts
  to justify the self-lockout risk, and force-logging-out yourself is a
  real failure mode with no upside here.
- Force-logout is meaningless unless something checks revocation status on
  requests made *after* the JWT was issued but *before* it naturally
  expires — otherwise "force logout" only prevents future logins, not the
  thing actually being asked for.

## Approach

**In-memory revocation cache**, not a live DB check per request — decided
during brainstorming after the tradeoff was raised explicitly: a live DB
query on every authenticated request was rejected in favor of this lighter
option. Backend is a single Railway instance (confirmed: no multi-instance
scaling anywhere in this project), so an in-process cache carries no
cross-instance sync risk.

### Data model

New `sessions` table (bigserial id, matching this project's existing PK
convention — no uuid extension in use anywhere in `schema.sql`):

```sql
create table if not exists sessions (
  id bigserial primary key,
  scope_type text not null,        -- 'staff_retail' | 'staff_warehouse' |
                                    -- 'outlet_manager' | 'warehouse_manager' |
                                    -- 'area_manager' | 'supervisor'
  scope_key text not null,         -- outlet code | area id | 'ALL'
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null, -- issued_at + 12h, matches JWT expiry
  revoked_at timestamptz,
  revoked_by text,                 -- master username
  ip text,
  user_agent text
);
create index if not exists sessions_active_idx on sessions (revoked_at, expires_at);
create index if not exists sessions_scope_idx on sessions (scope_type, scope_key);
```

`master` tokens get no row here and no `sid` claim — untouched, same as
today.

### Session issuance

`issueToken(scopeType, scopeKey)` in `middleware/auth.js` changes from a
sync JWT sign to: insert a `sessions` row (`expires_at = now() + 12h`,
matching the JWT's own `expiresIn: '12h'`), then sign the JWT with an added
`sid` claim (the new row's id). All three existing call sites already run
inside `async` route handlers (`staff-login`, `manager-login`,
`manager-register`), so `await`-ing this is a mechanical change, not a
structural one. `issueMasterToken` is untouched.

### Revocation check

`requireAuth` gets one added step after `jwt.verify()` succeeds: if
`req.session.scopeType !== 'master'`, check `req.session.sid` against a
module-level in-memory `Set` of currently-revoked-and-not-yet-naturally-
expired session ids. If present, respond 401 with the **same** message as
natural expiry (`'Your session has expired — please log in again.'`) — no
new frontend error state needed, a force-logged-out client behaves exactly
like an expired one.

New `services/sessionRevocationCache.js`:
- Module-level `Set<number>`.
- `refreshRevocationCache()` — `SELECT id FROM sessions WHERE revoked_at IS
  NOT NULL AND expires_at > now()`, replaces the Set wholesale. Run once at
  server startup (no blind window on a fresh deploy) and every ~25s via
  `setInterval` after that.
- `addRevokedSid(id)` — direct synchronous add, called by the revoke routes
  themselves so the *process that handled the revoke* enforces it
  immediately, not after the next poll tick. The periodic refresh remains
  the source of truth / self-healing mechanism (handles restarts, and
  correctly prunes ids once they age past their own `expires_at`, keeping
  the Set bounded).

### Retention

Same interval tick also runs `DELETE FROM sessions WHERE expires_at < now()
- interval '30 days'` — bounds table growth without a separate cron/
scheduled-job mechanism (this app has none today).

### New routes (`routes/masterSessions.js`, mounted `/master/sessions`, all `requireAuth` + `requireMaster`)

- `GET /search` — filters: `scopeType`, `scopeKey` (dropdown-sourced like
  Subsystem E's audit log — `config/areas.js` for outlets/areas, plus the
  4 manager roles and 2 staff types), `activeOnly` (default true: not
  revoked, not yet expired).
- `POST /:id/revoke` — sets `revoked_at = now()`, `revoked_by =
  <master username>`; calls `addRevokedSid(id)`; writes `audit_log`
  (`session.force_logout`, one row).
- `POST /revoke-all` — bulk version of the above, scoped to a **required**
  `scopeType` + `scopeKey` filter (no filter = 400, rejected — prevents an
  accidental "kill every session in the building" click). Revokes every
  currently-active session matching the filter in one transaction, one
  `audit_log` row summarizing the count affected (`affected_count`, an
  existing column on `audit_log` already used elsewhere).

Staff/manager login itself is **not** newly audit-logged — consistent with
Subsystem E's deliberate exclusion of routine, high-volume shared-PIN
logins from the audit trail. Only the force-logout action is.

### Frontend

`MasterActiveSessions.vue`, wired into `MasterPanel.vue`'s already-reserved
`sessions` tab (`TABS` array already has the key at line 18 — just needs
adding to `ENABLED_TABS`, plus the drawer-width class list
`['dataPurge', 'auditLogs']` extended to include `'sessions'`, same pattern
Subsystem C/E established for the wider table UI).

Same search-table shell as `MasterAuditLog.vue`: filter row, results table.
Per-row: scope type + scope key, issued/expires timestamps, a "Force
Logout" button. Single-row revoke uses a lightweight inline confirm (this
is reversible — the person just logs back in — unlike Data Purge's
irreversible hard delete). The bulk "Force Logout All (filtered)" action,
shown only once a scope filter is set, reuses `MasterDeleteConfirmModal.vue`'s
typed-confirm pattern — higher blast radius, same safety bar as a purge
action.

EN/MS strings per existing bilingual convention.

## Testing / verification plan

- `curl`: staff login → confirm a `sessions` row was created with correct
  `scope_type`/`scope_key`/`expires_at`, JWT decodes with a numeric `sid`.
- `curl`: revoke that session as Master → confirm the very next
  staff-authenticated request 401s **immediately** (proves the direct
  `addRevokedSid` path, not just eventual poll-driven consistency).
- `curl`: `revoke-all` with a scope filter matching 2+ synthetic sessions →
  confirm all matching sessions revoked, a differently-scoped session left
  untouched, one `audit_log` row with the right `affected_count`.
- `curl`: `revoke-all` with no filter → confirm 400, nothing revoked.
- Confirm a Master's own session is never written to `sessions` and is
  unaffected by any of the above (login, use the panel, force-logout other
  sessions — Master's own token keeps working throughout).
- Confirm 401/403 on all new routes without a valid master token.
- Restart the backend process mid-test with a pending revoked-but-cached
  session still inside its `expires_at` window → confirm
  `refreshRevocationCache()`'s startup run repopulates it correctly (no
  blind window).
- `npm run build` clean (frontend).
- EN/BM key-parity script clean.
- Live browser click-through: open the Sessions tab, filter, force-logout a
  real throwaway staff/manager session (own disposable test account, not
  live production credentials — same caution as Subsystems B/C/D), confirm
  that session's own browser tab gets logged out, bulk revoke-all on a
  filter, both EN and MS.
