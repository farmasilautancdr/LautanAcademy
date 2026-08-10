# Master User / Super Admin — Subsystem A: role, auth, panel shell

Date: 2026-08-10
Status: Approved design, not yet implemented

## Problem

There's no super-admin role in the new stack. Existing roles (staff,
outlet/warehouse/area manager, supervisor) each have their own scoped
login and permissions — none can override another, reset PINs across
roles, or intervene company-wide in an emergency. The full request
("Master User" role + Control Panel) spans 8 independent subsystems; this
spec covers only the foundation (**A**): the role itself, its auth, and
an empty panel shell. Subsystems B-H (PIN reset override, master bypass,
data purge/hard delete, maintenance kill-switch, audit logs, DB
backup/export, active sessions + force-logout, outlet/role impersonation)
are out of scope here — each gets its own spec later, built on top of
what this one establishes.

## Goals

- A `master` role exists, backend-enforced, fully independent of every
  existing role's session.
- Multiple named Master Users (not one shared password) so future audit
  logs (subsystem E) can attribute actions to a real person.
- No way to create a Master User from inside the running app — CLI seed
  script only, run out-of-band.
- A discoverable entry point (Key icon) reachable from anywhere in the
  app, that doesn't disturb whatever role session (if any) is currently
  active.
- An empty panel shell this round — B-H render as disabled placeholders,
  no functional modules yet.

## Non-goals (this spec)

- Any actual Master capability (PIN reset, overrides, purge, kill-switch,
  audit logs, backup/export, session monitor, impersonation) — B-H.
- A UI to manage/create Master Users — CLI-only, by design (see
  Decisions).
- Password recovery flow for a Master User who forgets their password —
  not addressed yet; today that means re-running the CLI script to
  overwrite their row. Acceptable for a small, trusted set of accounts;
  revisit if this becomes a real pain point.

## Decisions made during brainstorming

**Separate top-level login, not a step-up unlock.** Master gets its own
JWT `scopeType: 'master'`, its own login, fully decoupled from whatever
role token (if any) is currently active in the browser. A step-up model
(elevating the *current* session in place) would need the JWT/session
model to support a session holding two roles at once — a bigger
architecture change for no real benefit here, since Master actions don't
need to inherit context from whatever role you happened to be browsing
as.

**Multiple named users, not one shared password.** Costs a little more
upfront (CLI needs a username, not just a password; new `master_users`
table instead of a single `manager_pins`-style row) but avoids a bigger
migration later when audit logs (subsystem E) need to say *who* did
something, not just "someone with the master password."

**CLI-only creation, no in-panel "add Master User" UI.** Keeps the
attack surface minimal — even a fully compromised Master session can't
mint new super-admin accounts from inside the app. Trade-off: adding a
new Master User needs terminal/server access, not just being logged in
as one. Accepted — this is an emergency/admin role for a small trusted
group, not a self-service feature.

**Key icon shown everywhere (every login screen + every logged-in
role's dashboard), not just pre-login.** Matches the original ask
literally. Discoverability was chosen over minimizing exposure to
regular staff — flagged during brainstorming, user confirmed everywhere.

**2-hour token expiry, shorter than the 12h everyone else gets.**
Elevated-privilege session — shorter blast radius if a device or token
leaks. This isn't meant to be a daily-driver login, so more frequent
re-auth is an acceptable cost.

**CLI prompts for username/password interactively, never as argv.**
Command-line arguments land in shell history and process listings;
interactive prompts (or piped stdin) don't.

## Data model

New table (`lautan-academy-backend`):

```sql
create table master_users (
  id bigserial primary key,
  username text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);
```

No relation to any existing table — Master is fully outside the
staff/manager scoping model, by design.

## Backend changes (`lautan-academy-backend`)

### CLI script: `scripts/create-master-user.js`

Interactive prompt for username + password (no argv). Bcrypt-hashes the
password (cost 10, matching existing `bcrypt.hash(x, 10)` calls
elsewhere in the codebase). Upserts into `master_users` by username
(`on conflict (username) do update set password_hash = excluded.password_hash`)
— re-running it for an existing username resets that user's password,
same "overwrite is the reset path" pattern already used by
`manager-register`/`rotate-master-pin`. Safe to re-run.

### `POST /auth/master-login` (new)

Request: `{ username, password }`.

1. Look up `master_users` by `username`.
2. `bcrypt.compare(password, row.password_hash)`.
3. Lockout: own failKey namespace `master_${username}`, reuses the
   existing `isLockedOut`/`recordFailure`/`clearFailures` helpers
   (`middleware/rateLimit.js`) — same 5-fail/5-min pattern as
   staff/manager login, no new rate-limit mechanism needed.
4. On success: issue a JWT with `{ scopeType: 'master', scopeKey:
   username }`, **2h** expiry — needs a second signer alongside the
   existing `issueToken` (which is hardcoded to 12h), e.g.
   `issueMasterToken(username)` in `middleware/auth.js`.
5. Response shape matches existing login endpoints:
   `{ authorized: true, token }` / `{ authorized: false, error }`.

### `requireMaster` middleware (new, `middleware/auth.js`)

```js
export function requireMaster(req, res, next) {
  if (req.session?.scopeType !== 'master') {
    return res.status(403).json({ authorized: false, error: 'Not authorized for this action.' });
  }
  next();
}
```

Used after `requireAuth` (which decodes whichever token was sent).
Every Master-only route added in B-H is gated with
`requireAuth, requireMaster`. Nothing else uses this in subsystem A —
there are no Master-only data routes yet, only the login endpoint
itself.

## Frontend changes (`lautan-academy-frontend`)

### Master auth state

New small store/composable, e.g. `src/stores/masterAuth.js` — separate
from the existing `auth` store entirely. Own localStorage key
(`lautan_master_token`), own login/logout functions. Never reads from or
writes to the existing staff/manager session state — the two coexist
independently in the same browser tab.

### Key icon

Lucide `Key` icon, placed beside `LanguageSwitcher.vue`:
- In `AppSidebar.vue`, both desktop nav and mobile bottom bar (same
  `sections` pattern already used for role-aware nav — this icon is
  role-agnostic, shows regardless of which role is logged in).
- In each of the 6 standalone login/register views (staff, manager,
  area-manager, supervisor login + manager/area-manager register) —
  wherever `LanguageSwitcher` currently renders on those screens.

Click behavior:
- No valid cached master token → open `MasterLoginModal.vue`
  (username + password fields, posts to `/auth/master-login`).
- Valid cached master token (not expired) → open `MasterPanel.vue`
  directly, skip the login step.

### `MasterPanel.vue` (new)

Slide-over/drawer. This round: header with logout button, and a tab list
for the eventual B-H modules (PIN Reset, Overrides, Data Purge,
Maintenance Mode, Audit Logs, Backup/Export, Sessions, Impersonation) —
each rendered disabled with a "coming soon" state, no functional content
behind them yet. Logout clears only `lautan_master_token`; whatever
role session (if any) is active in the background is untouched.

### i18n

New `masterPanel` namespace in `en.json`/`ms.json` — login modal labels,
error strings, panel shell (header, tab names, "coming soon" text,
logout). Follows the existing flat-namespace-per-view convention.

## Testing plan

- `create-master-user.js`: run against local dev DB, confirm row
  inserted with a real bcrypt hash (not plaintext); re-run same username
  with a new password, confirm it overwrites (old password now rejected,
  new one works).
- `POST /auth/master-login`: curl with correct credentials (confirm
  `authorized: true` + a token that decodes to `scopeType: 'master'`,
  `exp` ~2h out), wrong password (confirm `authorized: false`), 6 rapid
  wrong attempts (confirm 429 lockout matches existing pattern).
- `requireMaster`: temporarily wire it to one throwaway test route,
  confirm a staff/manager token gets 403, a master token gets through;
  remove the throwaway route after (no real Master-only routes exist
  yet in this subsystem).
- Browser: Key icon renders on all 6 login screens + AppSidebar
  (desktop + mobile) regardless of logged-in role; click → modal → login
  → panel shell opens with disabled placeholder tabs; logout clears the
  master session only, confirmed by checking the other role's session
  (if any) still works unaffected; both EN/BM render correctly for all
  new strings.
- Clean up any test `master_users` rows created during verification
  before calling this done, per this project's established practice.
