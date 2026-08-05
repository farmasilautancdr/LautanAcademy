# Per-manager passwords for Outlet/Warehouse/Area Manager

Date: 2026-08-06
Status: Approved design, not yet implemented

## Problem

Outlet Manager, Warehouse Manager, and Area Manager logins currently share
one PIN per *role*, company-wide (`manager_pins` table, one row per role,
bcrypt-hashed). Every outlet manager at every outlet uses the same PIN;
every area manager uses the same PIN. There's no way to tell managers
apart, and if the PIN leaks, every outlet in that role is exposed at once.

Supervisor is explicitly out of scope — only one Supervisor account exists
company-wide, so individualizing it wouldn't add anything. It keeps its
current shared-PIN login unchanged.

## Goals

- Outlet Manager, Warehouse Manager, and Area Manager each pick their own
  password, scoped to their specific outlet/region.
- No hard cutover: outlets/regions that haven't registered a personal
  password yet keep working exactly as today, no UI mode switch.
- A manager who forgets their password, and an outlet/region changing
  hands to a new manager, are handled by the same mechanism — no separate
  flows to build or maintain.
- No email. No new external service dependency.

## Non-goals

- Supervisor login (unchanged).
- Per-*individual* manager identity (name, multiple people per outlet).
  This is still one login per outlet/region, same granularity as today —
  just no longer shared *across* outlets/regions.
- Email-based password reset. Explicitly rejected — see Decisions below.

## Decisions made during brainstorming

**Why no email for password recovery:** the shared PIN already provides a
free recovery mechanism once reframed as a permanent master key. Adding
email would mean a new external service dependency (against CLAUDE.md's
"no new libraries without asking"), a new PII surface (stored addresses),
and a recovery path tied to a departed manager's personal inbox — a real
liability given retail/pharmacy staff turnover. A master PIN held by
Supervisor/HQ doesn't have that problem, and is arguably harder to
compromise (would require compromising Supervisor, not phishing an inbox).
Tradeoff accepted: recovery requires reaching Supervisor/HQ rather than
being fully self-service. Acceptable given Supervisor/HQ is reachable
day-to-day (WhatsApp/phone) for this org.

**Why registration doubles as forgot-password and handover:** a single
"(re-)register with the master PIN, set a new password" endpoint that
upserts (insert-or-overwrite) the credential row covers three cases —
first-time signup, forgotten password, outlet reassignment — with one
code path. A separate "delete my login" step was considered but is
unnecessary: overwriting via the master PIN already replaces whatever was
there, so there's nothing to delete first.

**Why the master PIN can't be "retrieved" by Supervisor:** `manager_pins`
stores a bcrypt hash today and will continue to — one-way, not
recoverable, matching how password hashing is supposed to work. There is
currently no write endpoint for `manager_pins` at all (it was set once via
a migration script). Supervisor "stores" the PIN the same way they already
do today: out-of-band, because they're the one who set/distributed it. To
close the loop, this design adds a Supervisor-only action to set/rotate
the master PIN per role going forward, so Supervisor is never dependent on
remembering a PIN set months ago by someone else.

## Data model

New table:

```sql
create table manager_credentials (
  id bigserial primary key,
  role text not null,          -- 'outlet_manager' | 'warehouse_manager' | 'area_manager'
  scope_key text not null,     -- outlet code (uppercase) for outlet/warehouse manager;
                                -- area id (e.g. "R1 - AMIRUL") for area_manager
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (role, scope_key)
);
```

`manager_pins` (existing, unchanged schema) is reframed in meaning only:
it now holds the **master/recovery PIN** per role (`outlet_manager`,
`warehouse_manager`, `area_manager`, plus its existing unrelated
`supervisor`/`resources` rows, untouched). No schema change to this table.

## Backend changes (`lautan-academy-backend`)

### `POST /auth/manager-login` (modified)

Existing request shape unchanged (`role`, `outlet`, `pin`) — the field
named `pin` in the request now serves as "password or master PIN,
whichever applies," no frontend field rename needed.

New logic:
1. Look up `manager_credentials` for `(role, scope_key)`.
2. If a row exists: verify `pin` against its `password_hash`. This is the
   per-outlet personal password path.
3. If no row exists: fall back to verifying `pin` against
   `manager_pins.pin_hash` for that role — the existing shared-PIN path,
   unchanged behavior for anyone who hasn't registered yet.
4. Token issuance (`issueToken(role, scopeKey)`) is unchanged either way —
   the rest of the app doesn't need to know which path was used.

Rate limiting: split into two lockout keys instead of today's single
`mgr_${role}`:
- `mgr_${role}_${scopeKey}` — counts attempts against a registered
  outlet's personal password.
- `mgr_master_${role}` — counts attempts against the master PIN (used by
  both the login fallback in step 3, and registration below). Shared
  between those two call sites deliberately, for the same reason the
  `/auth/verify-pin` + `/auth/manager-login` lockout was unified earlier
  this session: a separate counter per endpoint would let an attacker
  double their guess budget by alternating between logging in and
  registering.

### `POST /auth/manager-register` (new)

Request: `{ role, outlet, masterPin, newPassword }` (`outlet` carries the
area id for `area_manager`, same convention as `manager-login`'s existing
`outlet` field).

1. Validate `role` is one of `outlet_manager` / `warehouse_manager` /
   `area_manager` (not `supervisor` — that role has no registration path).
2. For `area_manager`, validate `outlet` against `outletsForArea()`
   (existing helper in `config/areas.js`), same check `manager-login`
   already does.
3. Rate limit against `mgr_master_${role}` (shared key, see above).
4. Verify `masterPin` against `manager_pins.pin_hash` for that role.
5. Validate `newPassword` is at least 6 characters (existing PINs are
   4-digit; a personal password should be allowed to be longer/stronger
   than that, but no other complexity rule — keep it as low-friction as
   the rest of this app's auth).
6. Upsert `manager_credentials (role, scope_key)` with the bcrypt hash of
   `newPassword` — `insert ... on conflict (role, scope_key) do update`.
7. Issue a token immediately on success (log them in right after
   registering), same as `manager-login`'s response shape.

### `POST /auth/rotate-master-pin` (new, Supervisor-only)

Request: `{ role, newMasterPin }`. Guarded by `requireAuth,
requireScope('supervisor')`. Validates `role` is one of the three
in-scope roles, hashes `newMasterPin`, upserts `manager_pins` for that
role. Write-only — no endpoint ever returns the current PIN or its hash.

### Unchanged

- `POST /auth/verify-pin` — confirmed only ever called with
  `role: 'resources'` (vanilla's Manager-category gate) across the whole
  codebase (grepped both `lautan-academy-frontend/src` and `index.html`).
  Never called with `outlet_manager`/`warehouse_manager`/`area_manager`.
  No change needed.
- `manager_pins` schema, `staff_login`, `staff-roster` endpoints — untouched.

## Frontend changes (`lautan-academy-frontend`)

### `ManagerLoginView.vue`, `AreaManagerLoginView.vue`

No change to the login form itself — same fields (division/outlet or
area, PIN/password), same submit behavior. The backend's transparent
fallback (registered password → master PIN) means the existing single
input just keeps working for both cases.

Add a link below the existing form: "First time? Register your
outlet/region" → new registration view.

### New: `ManagerRegisterView.vue` (or split per role — TBD during
implementation planning, not a design-affecting choice)

Form: outlet/region picker (same options list as the login view),
master PIN field, new password field, confirm password field. On submit,
calls the new `manager-register` endpoint; on success, routes straight
into that role's dashboard (already logged in via the returned token).

### Supervisor dashboard: new "Manager Access" section

One row per in-scope role (Outlet Manager, Warehouse Manager, Area
Manager), each with a "Set new master PIN" action — input + confirm,
calls `rotate-master-pin`. No current-value display (can't — see
Decisions above).

## Rollout

No migration script needed to seed `manager_credentials` — it starts
empty and fills in as managers register. No cutover date: outlets that
never register keep using the master PIN indefinitely, exactly like
today's behavior, forever if that's how it ends up. This is intentional,
not a temporary transition state.

## Testing plan

Mirrors this session's established pattern for backend changes — mint a
JWT locally (have `JWT_SECRET` in `.env`) and hit production directly for
read-scoped verification where possible; for anything that requires a
real login round-trip (registration, master-PIN rotation), test against
local dev first, then verify the deployed bundle/endpoint shape matches
before calling it done. Specifically:
- Register a real outlet with a throwaway password, confirm login works
  with the new password, confirm login still fails with the old master
  PIN for that specific outlet (proves the credential row takes priority).
- Confirm an *unregistered* outlet still logs in with the master PIN
  (proves the fallback path).
- Confirm the shared lockout key actually blocks across both
  `manager-login`'s fallback path and `manager-register` (repeat the same
  verification approach used for the `verify-pin`/`manager-login` lockout
  fix earlier this session).
- Confirm `rotate-master-pin` is rejected for non-Supervisor tokens.
- Clean up all test credentials/rows after (matches this session's
  practice of never leaving test data in production).
