# Master Subsystem H: Outlet/Role Impersonation Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Master can view the app exactly as a specific staff member or manager sees it — view-only, backend-enforced, 30-minute auto-expiry — for support/troubleshooting and periodic spot-checks.

**Architecture:** Master gets a real scoped JWT for the target (same shape a real login produces), tagged `impersonated: true`, tracked in the existing `sessions` table (Subsystem G) with a new `impersonated_by` column. A single check inside the existing `requireAuth` middleware blocks any non-GET request carrying that claim — one enforcement point, no per-route edits. The frontend stashes the current real session (if any) into a separate localStorage key before overwriting the live session keys with the impersonated identity, so every existing dashboard/history view works completely unmodified; exiting (manually, or automatically on 401) restores the stash.

**Tech Stack:** Node.js/Express/`pg` (backend), Vue 3 + `vue-i18n` + Pinia (frontend). No new dependencies either side.

## Global Constraints

- Scope model: a target is `{scopeType, scopeKey}` — the exact shape `issueToken()` already accepts. No new identity table. Staff: `scopeKey = "OUTLET|NAME"` (both uppercase, must match a real `staff_roster` row). Outlet/Warehouse/Area Manager: `scopeKey` = outlet code / warehouse location / area id — these roles have no per-person account server-side (confirmed in `auth.js`: role+outlet, shared PIN), so this is the real account grain.
- **Excluded: Supervisor and Master.** Supervisor login is already unscoped/company-wide (`scopeKey = 'ALL'`) — no narrower account exists to view as. Master-as-Master is meaningless.
- **View-only, backend-enforced.** Refinement found during planning: the design spec described a separate global middleware, but `requireAuth` is the actual single choke point every authenticated route already passes through (mutating routes aren't otherwise centrally mounted) — the check lives inside `requireAuth` itself, right next to the existing revocation check, not as a new standalone middleware file. Frontend hiding of mutating buttons is UX only, not relied on for enforcement.
- **30-minute expiry, minutes not hours.** `jsonwebtoken`'s `expiresIn` string is parsed by the `ms` package, which does not reliably parse a fractional-hour string like `"0.5h"` — `issueToken()`'s TTL is expressed in minutes throughout (`720` for the existing 12h default, `30` for impersonation), not hours.
- Impersonation sessions get their own `sessions` row (same table Subsystem G already tracks staff/manager logins in), tagged via a new nullable `impersonated_by` column (same pattern as that table's existing `revoked_by`). Ending impersonation (manual Exit, or the frontend's 401-triggered auto-exit) revokes that row through the exact same path Subsystem G's force-logout already uses (`revoked_at`, `addRevokedSid`).
- Frontend session stash: contained entirely to `store/auth.js`. New localStorage keys `lautan_stash` (JSON snapshot of the real token/staff/manager, or absent if there was none), `lautan_impersonating`, `lautan_impersonation_session_id`. `api/client.js`'s `getToken()` and every existing view read `lautan_token`/`lautan_staff`/`lautan_manager` directly — those are what get temporarily overwritten and later restored. Master's own token (`lautan_master_token`) is never touched by any of this.
- `sessions.id` is `bigserial` → node-pg returns it as a JS **string**. Keep it a string everywhere (JWT `sid`, revocation cache, `sessionId` passed between frontend/backend) — this project has a logged past bug (`standard_questions.id`) from exactly this kind of string/number mismatch.
- Bilingual EN/MS strings required for all new UI text, following the exact key-nesting pattern already used under `masterPanel.*` in `src/i18n/locales/{en,ms}.json`. The tab label itself (`masterPanel.tab.impersonation`, "View As"/"Lihat Sebagai") already exists (seeded when Subsystem A built the tab shell) — only the panel-body strings are new.
- No test framework exists in either repo — verification is `curl` + `npm run build` + live browser click-through, matching every prior Master subsystem (A–G).
- This project is a single git repo rooted at `C:\Users\Hafiz\projects\lautan-academy`; the backend lives in the sibling directory `C:\Users\Hafiz\projects\lautan-academy-backend` (separate repo, independent commits), the frontend lives in `lautan-academy-frontend/` inside this repo.
- Every new/changed Master route stays gated `requireAuth` + `requireMaster`, matching every prior subsystem.

---

## Task 1: Backend — `sessions.impersonated_by` column migration

**Files:**
- Create: `C:\Users\Hafiz\projects\lautan-academy-backend\scripts\migrate-add-impersonated-by.js`
- Modify: `C:\Users\Hafiz\projects\lautan-academy-backend\sql\schema.sql`

**Interfaces:**
- Consumes: `pool` from `../src/config/db.js` (existing).
- Produces: `sessions.impersonated_by` column (nullable text), consumed by Task 2 (`issueToken`) and Task 3 (`/master/impersonate/start`).

- [ ] **Step 1: Write `scripts/migrate-add-impersonated-by.js`**

```js
// One-off: adds sessions.impersonated_by (Master Subsystem H) — set to the
// Master username on impersonation-issued session rows, null for every
// ordinary staff/manager login. Lets Active Sessions (Subsystem G) show
// which rows are impersonation sessions without a separate table. See
// docs/superpowers/specs/2026-08-11-master-subsystem-h-design.md.
// Safe to re-run (add-if-not-exists).
import { pool } from '../src/config/db.js';

async function main() {
  await pool.query(`alter table sessions add column if not exists impersonated_by text`);
  console.log('Migration complete: sessions.impersonated_by added.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it against local dev DB**

Run: `cd lautan-academy-backend && node scripts/migrate-add-impersonated-by.js`
Expected output: `Migration complete: sessions.impersonated_by added.`

- [ ] **Step 3: Verify the column exists**

```bash
node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  const { rows } = await pool.query(\"select column_name, data_type from information_schema.columns where table_name = 'sessions' and column_name = 'impersonated_by'\");
  console.log(rows);
  await pool.end();
});
"
```

Expected: one row, `column_name: 'impersonated_by'`, `data_type: 'text'`.

- [ ] **Step 4: Add the column to `sql/schema.sql`**

In the existing `sessions` table block (`sql/schema.sql:189-199`), add `impersonated_by text,` right after `revoked_by text,` (line 196):

```sql
create table if not exists sessions (
  id bigserial primary key,
  scope_type text not null,
  scope_key text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text,
  impersonated_by text,
  ip text,
  user_agent text
);
```

- [ ] **Step 5: Commit**

```bash
cd lautan-academy-backend
git add scripts/migrate-add-impersonated-by.js sql/schema.sql
git commit -m "feat: add sessions.impersonated_by column for Master Subsystem H"
```

---

## Task 2: Backend — `issueToken` opts param + view-only enforcement in `requireAuth`

**Files:**
- Modify: `C:\Users\Hafiz\projects\lautan-academy-backend\src\middleware\auth.js`

**Interfaces:**
- Consumes: nothing new (same imports already in this file).
- Produces: `issueToken(scopeType, scopeKey, opts?: { expiresInMinutes?: number, impersonatedBy?: string }): Promise<string>` — existing 3 call sites in `routes/auth.js` are unaffected (opts defaults to `{}`, same 12h/no-`impersonated`-claim behavior as today, no changes needed there). `requireAuth` now also 403s a non-GET request carrying an `impersonated: true` claim — consumed implicitly by every existing authenticated route.

- [ ] **Step 1: Replace `issueToken` (current lines 6-23)**

Current:

```js
// 12h matches this project's existing staff/manager JWT lifetime — kept as
// one constant so the DB row's expires_at and the JWT's own expiresIn can
// never drift apart.
const SESSION_TTL_HOURS = 12;

export async function issueToken(scopeType, scopeKey) {
  const { rows } = await pool.query(
    `insert into sessions (scope_type, scope_key, expires_at)
     values ($1, $2, now() + interval '${SESSION_TTL_HOURS} hours')
     returning id`,
    [scopeType, scopeKey]
  );
  // bigserial comes back as a JS string from node-pg — keep it a string all
  // the way through (JWT claim, revocation cache, revoke-route params). See
  // this file's Global Constraints note on the standard_questions.id bug.
  const sid = rows[0].id;
  return jwt.sign({ scopeType, scopeKey, sid }, env.jwtSecret, { expiresIn: `${SESSION_TTL_HOURS}h` });
}
```

Replace with:

```js
// 12h matches this project's existing staff/manager JWT lifetime — kept as
// one constant so the DB row's expires_at and the JWT's own expiresIn can
// never drift apart. Expressed in minutes (not hours) so Master Subsystem
// H's shorter 30-minute impersonation lifetime uses the exact same
// interval/expiresIn construction — jsonwebtoken's expiresIn string is
// parsed by the `ms` package, which does not reliably parse a fractional-
// hour string like "0.5h".
const SESSION_TTL_MINUTES = 12 * 60;

// opts.expiresInMinutes / opts.impersonatedBy are used only by Master
// Subsystem H's impersonation flow (routes/masterImpersonate.js) — every
// existing caller passes neither and gets the same 12h/untagged behavior
// as before. See docs/superpowers/specs/2026-08-11-master-subsystem-h-design.md.
export async function issueToken(scopeType, scopeKey, opts = {}) {
  const ttlMinutes = opts.expiresInMinutes || SESSION_TTL_MINUTES;
  const impersonatedBy = opts.impersonatedBy || null;
  const { rows } = await pool.query(
    `insert into sessions (scope_type, scope_key, expires_at, impersonated_by)
     values ($1, $2, now() + interval '${ttlMinutes} minutes', $3)
     returning id`,
    [scopeType, scopeKey, impersonatedBy]
  );
  // bigserial comes back as a JS string from node-pg — keep it a string all
  // the way through (JWT claim, revocation cache, revoke-route params). See
  // this file's Global Constraints note on the standard_questions.id bug.
  const sid = rows[0].id;
  const claims = { scopeType, scopeKey, sid };
  if (impersonatedBy) claims.impersonated = true;
  return jwt.sign(claims, env.jwtSecret, { expiresIn: `${ttlMinutes}m` });
}
```

- [ ] **Step 2: Add the view-only check to `requireAuth`**

Current (lines 32-48):

```js
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.body.token;
  if (!token) return res.status(401).json({ authorized: false, error: 'No session token.' });
  try {
    req.session = jwt.verify(token, env.jwtSecret);
    // Master tokens carry no sid and are never tracked/revocable (see
    // Global Constraints) — same 401 shape as natural expiry, so a
    // force-logged-out client needs no new frontend error handling.
    if (req.session.scopeType !== 'master' && isRevoked(req.session.sid)) {
      return res.status(401).json({ authorized: false, error: 'Your session has expired — please log in again.' });
    }
    next();
  } catch (e) {
    res.status(401).json({ authorized: false, error: 'Your session has expired — please log in again.' });
  }
}
```

Replace with:

```js
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.body.token;
  if (!token) return res.status(401).json({ authorized: false, error: 'No session token.' });
  try {
    req.session = jwt.verify(token, env.jwtSecret);
    // Master tokens carry no sid and are never tracked/revocable (see
    // Global Constraints) — same 401 shape as natural expiry, so a
    // force-logged-out client needs no new frontend error handling.
    if (req.session.scopeType !== 'master' && isRevoked(req.session.sid)) {
      return res.status(401).json({ authorized: false, error: 'Your session has expired — please log in again.' });
    }
    // Master Subsystem H: impersonation tokens are view-only. This is the
    // single enforcement point — every authenticated route already runs
    // through requireAuth, so no per-route edits are needed. See
    // docs/superpowers/specs/2026-08-11-master-subsystem-h-design.md.
    if (req.session.impersonated && req.method !== 'GET') {
      return res.status(403).json({ authorized: false, error: 'View-only — action not permitted while impersonating.' });
    }
    next();
  } catch (e) {
    res.status(401).json({ authorized: false, error: 'Your session has expired — please log in again.' });
  }
}
```

- [ ] **Step 3: Sanity-check with a normal login (no regression)**

Run: `cd lautan-academy-backend && node src/index.js`, then in a second terminal:

```bash
curl -s -X POST http://localhost:3000/auth/staff-login -H "Content-Type: application/json" -d '{"division":"retail","outlet":"<real outlet>","name":"<real staff name>","pin":"<real pin>"}'
```

Expected: `{"authorized":true,"token":"..."}` as before. Decode the payload and confirm `impersonated` is **absent** (not `false` — the claim is only added when `impersonatedBy` is set):

```bash
node -e "console.log(JSON.parse(Buffer.from('<token middle segment>', 'base64url').toString()))"
```

Expected: `{ scopeType: 'staff_retail', scopeKey: '...', sid: '...', iat: ..., exp: ... }` — no `impersonated` key. Confirm a normal mutating call still works: `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/data/results -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{}'` — expected any non-403 status (400/500 is fine, this is just proving the new check doesn't fire for a non-impersonated token; the empty body will fail validation further in, that's expected and not what's being tested here).

- [ ] **Step 4: Commit**

```bash
git add src/middleware/auth.js
git commit -m "feat: add impersonation opts to issueToken, view-only enforcement in requireAuth"
```

---

## Task 3: Backend — `/master/impersonate/start` + `/master/impersonate/end` routes

**Files:**
- Create: `C:\Users\Hafiz\projects\lautan-academy-backend\src\routes\masterImpersonate.js`
- Modify: `C:\Users\Hafiz\projects\lautan-academy-backend\src\index.js`

**Interfaces:**
- Consumes: `issueToken`, `requireAuth`, `requireMaster` from `../middleware/auth.js` (Task 2); `outletsForArea`, `AREAS` from `../config/areas.js` (existing); `logAudit`, `logAuditSafe` from `../services/auditLog.js` (existing); `addRevokedSid` from `../services/sessionRevocationCache.js` (existing, Subsystem G).
- Produces: `masterImpersonateRouter` (Express `Router`, exported), mounted at `/master/impersonate`. `POST /start` responds `{authorized, token, sessionId, scopeType, scopeKey}`; `POST /end` responds `{status: 'ok'}`. Consumed by Task 5's frontend API client methods.

- [ ] **Step 1: Write `src/routes/masterImpersonate.js`**

```js
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';
import { issueToken, requireAuth, requireMaster } from '../middleware/auth.js';
import { outletsForArea, AREAS } from '../config/areas.js';
import { logAudit, logAuditSafe } from '../services/auditLog.js';
import { addRevokedSid } from '../services/sessionRevocationCache.js';

export const masterImpersonateRouter = Router();

// Master Subsystem H — outlet/role impersonation switcher. A target is
// {scopeType, scopeKey}, the exact shape issueToken() already accepts — no
// new identity concept. Supervisor and Master are deliberately excluded
// (Supervisor has no narrower account to view as; Master-as-Master is
// meaningless). See
// docs/superpowers/specs/2026-08-11-master-subsystem-h-design.md.
const VALID_SCOPE_TYPES = ['staff_retail', 'staff_warehouse', 'outlet_manager', 'warehouse_manager', 'area_manager'];
const RETAIL_OUTLETS = new Set(AREAS.flatMap((a) => a.outlets));
// Local duplication, not a shared constant — matches this codebase's
// existing per-file convention for this exact list (see e.g.
// routes/masterSessions.js is dropdown-sourced client-side; here it's
// server-side validation of the same 4 values).
const WAREHOUSE_LOCATIONS = new Set(['Taskforce', 'Warehouse', 'Inventory', 'Logistic']);
const IMPERSONATION_TTL_MINUTES = 30;

masterImpersonateRouter.post('/start', requireAuth, requireMaster, async (req, res) => {
  const scopeType = (req.body.scopeType || '').toString();
  const scopeKey = (req.body.scopeKey || '').toString().trim();
  if (!VALID_SCOPE_TYPES.includes(scopeType) || !scopeKey) {
    return res.status(400).json({ authorized: false, error: 'Invalid target.' });
  }

  if (scopeType === 'staff_retail' || scopeType === 'staff_warehouse') {
    const [outlet, name] = scopeKey.split('|');
    if (!outlet || !name) {
      return res.status(400).json({ authorized: false, error: 'Invalid staff target.' });
    }
    const division = scopeType === 'staff_warehouse' ? 'warehouse' : 'retail';
    const { rows } = await pool.query(
      'select 1 from staff_roster where division = $1 and outlet = $2 and name = $3',
      [division, outlet, name]
    );
    if (!rows.length) return res.status(400).json({ authorized: false, error: 'Staff member not found.' });
  } else if (scopeType === 'outlet_manager') {
    if (!RETAIL_OUTLETS.has(scopeKey)) return res.status(400).json({ authorized: false, error: 'Unknown outlet.' });
  } else if (scopeType === 'warehouse_manager') {
    if (!WAREHOUSE_LOCATIONS.has(scopeKey)) return res.status(400).json({ authorized: false, error: 'Unknown location.' });
  } else if (scopeType === 'area_manager') {
    if (!outletsForArea(scopeKey)) return res.status(400).json({ authorized: false, error: 'Unknown area.' });
  }

  const token = await issueToken(scopeType, scopeKey, {
    expiresInMinutes: IMPERSONATION_TTL_MINUTES,
    impersonatedBy: req.session.scopeKey,
  });
  const sessionId = jwt.decode(token).sid;

  await logAuditSafe({
    actorType: 'master',
    actorKey: req.session.scopeKey,
    action: 'impersonation.start',
    summary: `Started viewing as ${scopeType}/${scopeKey}`,
  });

  res.json({ authorized: true, token, sessionId, scopeType, scopeKey });
});

masterImpersonateRouter.post('/end', requireAuth, requireMaster, async (req, res) => {
  const sessionId = (req.body.sessionId || '').toString();
  if (!sessionId) return res.status(400).json({ status: 'error', error: 'No session specified.' });

  const { rows } = await pool.query(
    `update sessions set revoked_at = now(), revoked_by = $1
     where id = $2 and revoked_at is null
     returning id, scope_type, scope_key`,
    [req.session.scopeKey, sessionId]
  );
  if (!rows.length) return res.status(404).json({ status: 'error', error: 'Session not found or already ended.' });

  addRevokedSid(rows[0].id);
  await logAudit(pool, {
    actorType: 'master',
    actorKey: req.session.scopeKey,
    action: 'impersonation.end',
    summary: `Ended impersonation of ${rows[0].scope_type}/${rows[0].scope_key}`,
  });

  res.json({ status: 'ok' });
});
```

- [ ] **Step 2: Mount the router in `src/index.js`**

Add the import next to the other route imports (after `import { masterSessionsRouter } from './routes/masterSessions.js';`):

```js
import { masterImpersonateRouter } from './routes/masterImpersonate.js';
```

Add the mount next to the other `/master/*` mounts (after `app.use('/master/sessions', masterSessionsRouter);`):

```js
app.use('/master/impersonate', masterImpersonateRouter);
```

- [ ] **Step 3: Restart the backend and verify the full start/enforce/end flow**

Restart: `cd lautan-academy-backend && node src/index.js`

Log in as Master, then start impersonation of a real staff account:

```bash
curl -s -X POST http://localhost:3000/auth/master-login -H "Content-Type: application/json" -d '{"username":"<real master username>","password":"<real master password>"}'
curl -s -X POST http://localhost:3000/master/impersonate/start -H "Authorization: Bearer <master token>" -H "Content-Type: application/json" -d '{"scopeType":"staff_retail","scopeKey":"<REAL OUTLET>|<REAL STAFF NAME UPPERCASE>"}'
```

Expected: `{"authorized":true,"token":"...","sessionId":"<numeric string>","scopeType":"staff_retail","scopeKey":"..."}`. Decode the token payload — expect `impersonated: true`, `exp` roughly 30 minutes ahead of `iat`.

Confirm a GET still works, a mutating call is blocked:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/data/scoped-data -H "Authorization: Bearer <impersonation token>"
curl -s http://localhost:3000/data/results -X POST -H "Authorization: Bearer <impersonation token>" -H "Content-Type: application/json" -d '{}'
```

Expected: first `200`; second `403` with `{"authorized":false,"error":"View-only — action not permitted while impersonating."}`.

End it:

```bash
curl -s -X POST http://localhost:3000/master/impersonate/end -H "Authorization: Bearer <master token>" -H "Content-Type: application/json" -d '{"sessionId":"<sessionId from start>"}'
```

Expected: `{"status":"ok"}`. Immediately re-check the impersonation token:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/data/scoped-data -H "Authorization: Bearer <impersonation token>"
```

Expected: `401`, immediately (proves the direct `addRevokedSid` path).

Confirm both audit rows exist:

```bash
curl -s "http://localhost:3000/master/audit-log/search?action=impersonation.start" -H "Authorization: Bearer <master token>"
curl -s "http://localhost:3000/master/audit-log/search?action=impersonation.end" -H "Authorization: Bearer <master token>"
```

Expected: one matching entry each, with the correct summary.

- [ ] **Step 4: Verify validation and role-exclusion rejections**

```bash
curl -s -X POST http://localhost:3000/master/impersonate/start -H "Authorization: Bearer <master token>" -H "Content-Type: application/json" -d '{"scopeType":"staff_retail","scopeKey":"NOTAREALOUTLET|NOBODY"}'
curl -s -X POST http://localhost:3000/master/impersonate/start -H "Authorization: Bearer <master token>" -H "Content-Type: application/json" -d '{"scopeType":"outlet_manager","scopeKey":"NOTAREALOUTLET"}'
curl -s -X POST http://localhost:3000/master/impersonate/start -H "Authorization: Bearer <master token>" -H "Content-Type: application/json" -d '{"scopeType":"area_manager","scopeKey":"NOT A REAL AREA"}'
curl -s -X POST http://localhost:3000/master/impersonate/start -H "Authorization: Bearer <master token>" -H "Content-Type: application/json" -d '{"scopeType":"supervisor","scopeKey":"ALL"}'
curl -s -X POST http://localhost:3000/master/impersonate/start -H "Authorization: Bearer <master token>" -H "Content-Type: application/json" -d '{"scopeType":"master","scopeKey":"whoever"}'
```

Expected: all five `400` with `{"authorized":false,"error":"..."}` (the last two rejected by the `VALID_SCOPE_TYPES` check, since `supervisor`/`master` aren't in that list).

- [ ] **Step 5: Verify auth gating**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/master/impersonate/start -H "Content-Type: application/json" -d '{"scopeType":"outlet_manager","scopeKey":"<real outlet>"}'
```

Expected: `401` (no token).

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/master/impersonate/start -H "Authorization: Bearer <a real staff token>" -H "Content-Type: application/json" -d '{"scopeType":"outlet_manager","scopeKey":"<real outlet>"}'
```

Expected: `403` (wrong scopeType).

- [ ] **Step 6: Commit**

```bash
git add src/routes/masterImpersonate.js src/index.js
git commit -m "feat: add master impersonation start/end routes"
```

---

## Task 4: Frontend — session stash/restore in `store/auth.js`

**Files:**
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\store\auth.js`

**Interfaces:**
- Consumes: `api.masterImpersonateEnd` (Task 5 — but this action tolerates it not existing yet mid-implementation since it's wrapped in try/catch); `useMasterAuthStore` from `./masterAuth` (existing).
- Produces: new state `impersonating: boolean`, `impersonationSessionId: string | null`; new actions `startImpersonation(token, staff, manager, sessionId)` and `exitImpersonation()`. Consumed by Task 6 (`MasterImpersonation.vue`), Task 7 (`ImpersonationBanner.vue`, `App.vue`), Task 5 (`api/client.js`'s 401 handler), Task 8 (view-level `v-if="!auth.impersonating"` gates).

- [ ] **Step 1: Add the new imports, state, and actions**

Add the import at the top (after `import { api } from '../api/client'`):

```js
import { useMasterAuthStore } from './masterAuth'
```

Add to `state()` (after the existing `manager` line):

```js
    impersonating: localStorage.getItem('lautan_impersonating') === '1',
    impersonationSessionId: localStorage.getItem('lautan_impersonation_session_id') || null,
```

Add two new actions, right before the existing `logout()` action:

```js
    // Master Subsystem H. Stashes whatever real session is currently live
    // (if any) into a separate key before overwriting the shared
    // lautan_token/staff/manager keys api/client.js and every existing view
    // already read directly — this is what lets every dashboard/history
    // view work unmodified under an impersonated identity, without
    // clobbering a real concurrent session in the same browser. See
    // docs/superpowers/specs/2026-08-11-master-subsystem-h-design.md.
    startImpersonation(token, staff, manager, sessionId) {
      const stash = { token: this.token, staff: this.staff, manager: this.manager }
      localStorage.setItem('lautan_stash', JSON.stringify(stash))
      this.token = token
      this.staff = staff
      this.manager = manager
      this.impersonating = true
      this.impersonationSessionId = sessionId
      localStorage.setItem('lautan_token', token)
      localStorage.setItem('lautan_staff', JSON.stringify(staff))
      localStorage.setItem('lautan_manager', JSON.stringify(manager))
      localStorage.setItem('lautan_impersonating', '1')
      localStorage.setItem('lautan_impersonation_session_id', sessionId)
    },

    // Called manually (Exit button) or automatically (api/client.js's 401
    // handler, on the 30-minute expiry or a Master force-logout via Active
    // Sessions). Best-effort backend call — if it fails (e.g. Master's own
    // token has also expired), the local restore still happens so the user
    // is never stuck impersonating with no way out.
    async exitImpersonation() {
      if (this.impersonationSessionId) {
        try {
          const masterAuth = useMasterAuthStore()
          if (masterAuth.token) await api.masterImpersonateEnd(this.impersonationSessionId, masterAuth.token)
        } catch (e) {
          console.error('exitImpersonation: backend end call failed:', e.message)
        }
      }
      const stash = JSON.parse(localStorage.getItem('lautan_stash') || 'null')
      this.token = stash?.token || null
      this.staff = stash?.staff || null
      this.manager = stash?.manager || null
      this.impersonating = false
      this.impersonationSessionId = null
      if (stash?.token) {
        localStorage.setItem('lautan_token', stash.token)
        localStorage.setItem('lautan_staff', JSON.stringify(stash.staff))
        localStorage.setItem('lautan_manager', JSON.stringify(stash.manager))
      } else {
        localStorage.removeItem('lautan_token')
        localStorage.removeItem('lautan_staff')
        localStorage.removeItem('lautan_manager')
      }
      localStorage.removeItem('lautan_stash')
      localStorage.removeItem('lautan_impersonating')
      localStorage.removeItem('lautan_impersonation_session_id')
    },
```

- [ ] **Step 2: Sanity-check in isolation**

No test framework exists — verify by reading the diff: `logout()` (unchanged, right after these two new actions) still only clears the 3 original keys and is untouched; the new actions don't reference anything outside this file except `useMasterAuthStore` and `api.masterImpersonateEnd` (added in Task 5). Exercised for real once Task 6/7 wire it into the UI.

- [ ] **Step 3: Commit**

```bash
git add lautan-academy-frontend/src/store/auth.js
git commit -m "feat: add impersonation session stash/restore to auth store"
```

---

## Task 5: Frontend — API client methods + 401 auto-exit handling

**Files:**
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\api\client.js`

**Interfaces:**
- Consumes: `request()` helper (existing, `client.js:12-45`).
- Produces: `api.masterImpersonateStart(scopeType, scopeKey, masterToken)` and `api.masterImpersonateEnd(sessionId, masterToken)`, both async, same throw-on-failure contract as every other `master*` method. `request()` gains an automatic impersonation-exit-and-redirect on any 401 received while impersonating. Consumed by Task 4 (`exitImpersonation`), Task 6 (`MasterImpersonation.vue`).

- [ ] **Step 1: Add the two new API methods**

Add as the last two entries in the `api` object, right after `masterRevokeSessions` (`client.js:150-151`):

```js
  masterImpersonateStart: (scopeType, scopeKey, masterToken) =>
    request('/master/impersonate/start', { method: 'POST', body: JSON.stringify({ scopeType, scopeKey }), headers: { Authorization: `Bearer ${masterToken}` } }),
  masterImpersonateEnd: (sessionId, masterToken) =>
    request('/master/impersonate/end', { method: 'POST', body: JSON.stringify({ sessionId }), headers: { Authorization: `Bearer ${masterToken}` } }),
```

- [ ] **Step 2: Add the 401-while-impersonating auto-exit branch to `request()`**

Current (`client.js:26-44`):

```js
  if (res.status === 503 && data.maintenance === true) {
    // Dynamic import, not a static top-of-file import: store/maintenance.js
    // imports `api` from this same file, so a static import here would be a
    // circular module reference — client.js could reach this line before
    // its own `export const api = {...}` (further down this file) has run,
    // leaving the store's `api` binding uninitialized. The dynamic import
    // only resolves once this function actually runs, by which point this
    // module has already finished loading, so the cycle never bites.
    const { useMaintenanceStore } = await import('../store/maintenance')
    const maintenance = useMaintenanceStore()
    maintenance.active = true
    maintenance.message = data.message || ''
    throw new Error(data.error || 'Maintenance')
  }

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`)
  }
  return data
}
```

Replace with:

```js
  if (res.status === 503 && data.maintenance === true) {
    // Dynamic import, not a static top-of-file import: store/maintenance.js
    // imports `api` from this same file, so a static import here would be a
    // circular module reference — client.js could reach this line before
    // its own `export const api = {...}` (further down this file) has run,
    // leaving the store's `api` binding uninitialized. The dynamic import
    // only resolves once this function actually runs, by which point this
    // module has already finished loading, so the cycle never bites.
    const { useMaintenanceStore } = await import('../store/maintenance')
    const maintenance = useMaintenanceStore()
    maintenance.active = true
    maintenance.message = data.message || ''
    throw new Error(data.error || 'Maintenance')
  }

  // Master Subsystem H: a 401 while impersonating means the 30-minute
  // token expired (or Master force-revoked it via Active Sessions) —
  // restore the stashed real session and bounce home instead of leaving
  // the user stuck on a dead impersonated view. Same circular-import
  // reasoning as the maintenance branch above: store/auth.js imports `api`
  // from this file, so this import must be dynamic.
  if (res.status === 401) {
    const { useAuthStore } = await import('../store/auth')
    const auth = useAuthStore()
    if (auth.impersonating) {
      await auth.exitImpersonation()
      window.location.href = '/'
      throw new Error(data.error || 'Impersonation session expired.')
    }
  }

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`)
  }
  return data
}
```

- [ ] **Step 3: Sanity-check in isolation**

No test framework exists — verify by reading the diff: confirm the new branch is placed after the maintenance check and before the generic `!res.ok` throw, confirm it only triggers `exitImpersonation`/redirect when `auth.impersonating` is true (a normal expired staff/manager token still just throws, unaffected — same as before this change). Exercised for real once Task 3's backend routes exist and Task 6/7 wire the frontend flow.

- [ ] **Step 4: Commit**

```bash
git add lautan-academy-frontend/src/api/client.js
git commit -m "feat: add impersonation API methods, auto-exit on 401 while impersonating"
```

---

## Task 6: Frontend — `MasterImpersonation.vue` picker + i18n + `MasterPanel.vue` wiring

**Files:**
- Create: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\components\MasterImpersonation.vue`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\components\MasterPanel.vue`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\i18n\locales\en.json`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\i18n\locales\ms.json`

**Interfaces:**
- Consumes: `api.masterSearchStaffForPurge` (existing, Subsystem C), `api.masterImpersonateStart` (Task 5); `useAuthStore().startImpersonation` (Task 4); `useMasterAuthStore()` (existing); `AREAS` from `../config/areas` (existing).
- Produces: `MasterImpersonation.vue`, emits `close` and `started` (the latter tells `MasterPanel.vue` to close the whole panel, since the impersonation banner takes over from there).

- [ ] **Step 1: Write `src/components/MasterImpersonation.vue`**

```vue
<script setup>
// Master-only: pick a staff/manager target and start viewing the app as
// them (Subsystem H). Target = {scopeType, scopeKey}, the exact shape a
// real login already produces — no new identity concept. Supervisor and
// Master are not offered (see design spec). See
// docs/superpowers/specs/2026-08-11-master-subsystem-h-design.md.
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { useMasterAuthStore } from '../store/masterAuth'
import { AREAS } from '../config/areas'

const emit = defineEmits(['close', 'started'])
const { t } = useI18n()
const auth = useAuthStore()
const masterAuth = useMasterAuthStore()

const RETAIL_OUTLETS = [...new Set(AREAS.flatMap(a => a.outlets))].sort()
const WAREHOUSE_LOCATIONS = ['Taskforce', 'Warehouse', 'Inventory', 'Logistic']
const AREA_IDS = AREAS.map(a => a.id)

const targetType = ref('staff_retail')
const outlet = ref('')
const nameQuery = ref('')
const staffResults = ref([])
const picked = ref(null)
const searching = ref(false)
const starting = ref(false)
const error = ref('')

const isStaffType = computed(() => targetType.value === 'staff_retail' || targetType.value === 'staff_warehouse')
const outletOptions = computed(() => {
  if (targetType.value === 'staff_warehouse' || targetType.value === 'warehouse_manager') return WAREHOUSE_LOCATIONS
  if (targetType.value === 'area_manager') return AREA_IDS
  return RETAIL_OUTLETS
})

function resetPick() {
  outlet.value = ''
  nameQuery.value = ''
  staffResults.value = []
  picked.value = null
  error.value = ''
}

async function searchStaff() {
  if (!outlet.value) return
  searching.value = true
  picked.value = null
  try {
    const division = targetType.value === 'staff_warehouse' ? 'warehouse' : 'retail'
    const data = await api.masterSearchStaffForPurge({ outlet: outlet.value, name: nameQuery.value }, masterAuth.token)
    staffResults.value = (data.staff || []).filter(s => s.division === division)
  } catch (err) {
    error.value = err.message || t('masterPanel.impersonation.errorStartFailed')
  } finally {
    searching.value = false
  }
}

function scopeKeyFor() {
  if (isStaffType.value) return picked.value ? `${picked.value.outlet}|${picked.value.name}` : ''
  return outlet.value
}

async function start() {
  error.value = ''
  const scopeKey = scopeKeyFor()
  if (!scopeKey) {
    error.value = t('masterPanel.impersonation.errorSelectTarget')
    return
  }
  starting.value = true
  try {
    const data = await api.masterImpersonateStart(targetType.value, scopeKey, masterAuth.token)
    const staff = isStaffType.value
      ? { name: picked.value.name, outlet: picked.value.outlet, division: targetType.value === 'staff_warehouse' ? 'warehouse' : 'retail' }
      : null
    const manager = !isStaffType.value
      ? { role: targetType.value, outlet: scopeKey, label: scopeKey }
      : null
    auth.startImpersonation(data.token, staff, manager, data.sessionId)
    emit('started')
  } catch (err) {
    error.value = err.message || t('masterPanel.impersonation.errorStartFailed')
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <div class="px-5 py-4 space-y-4 overflow-y-auto flex-1">
    <button type="button" @click="emit('close')" class="text-sm text-slate hover:text-ink flex items-center gap-1">
      &larr; {{ t('masterPanel.impersonation.back') }}
    </button>
    <div>
      <h3 class="font-display font-semibold text-ink text-base mb-1">{{ t('masterPanel.impersonation.title') }}</h3>
      <p class="text-slate text-xs">{{ t('masterPanel.impersonation.intro') }}</p>
    </div>

    <div>
      <label class="block text-sm font-medium text-ink mb-1">{{ t('masterPanel.impersonation.targetType') }}</label>
      <select v-model="targetType" @change="resetPick" class="w-full border border-slate/30 rounded-lg py-2 px-3 text-sm">
        <option value="staff_retail">{{ t('masterPanel.impersonation.targetTypeStaffRetail') }}</option>
        <option value="staff_warehouse">{{ t('masterPanel.impersonation.targetTypeStaffWarehouse') }}</option>
        <option value="outlet_manager">{{ t('masterPanel.impersonation.targetTypeOutletManager') }}</option>
        <option value="warehouse_manager">{{ t('masterPanel.impersonation.targetTypeWarehouseManager') }}</option>
        <option value="area_manager">{{ t('masterPanel.impersonation.targetTypeAreaManager') }}</option>
      </select>
    </div>

    <div>
      <label class="block text-sm font-medium text-ink mb-1">
        {{ targetType === 'area_manager' ? t('masterPanel.impersonation.areaLabel') : t('masterPanel.impersonation.outletLabel') }}
      </label>
      <select v-model="outlet" @change="picked = null; staffResults = []" class="w-full border border-slate/30 rounded-lg py-2 px-3 text-sm">
        <option value="">{{ t('masterPanel.impersonation.selectOutlet') }}</option>
        <option v-for="o in outletOptions" :key="o" :value="o">{{ o }}</option>
      </select>
    </div>

    <template v-if="isStaffType">
      <form @submit.prevent="searchStaff" class="flex items-center gap-2">
        <input v-model="nameQuery" type="text" :placeholder="t('masterPanel.impersonation.staffSearchPlaceholder')" class="flex-1 border border-slate/30 rounded-lg py-2 px-3 text-sm" />
        <button type="submit" :disabled="!outlet || searching" class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
          {{ searching ? t('masterPanel.impersonation.searching') : t('masterPanel.impersonation.search') }}
        </button>
      </form>
      <p v-if="!searching && outlet && staffResults.length === 0" class="text-slate text-xs">{{ t('masterPanel.impersonation.noStaffResults') }}</p>
      <div v-if="staffResults.length" class="border border-seafoam rounded-lg divide-y divide-seafoam max-h-48 overflow-y-auto">
        <label v-for="s in staffResults" :key="s.id" class="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
          <input type="radio" :checked="picked && picked.name === s.name && picked.outlet === s.outlet" @change="picked = { outlet: s.outlet, name: s.name }" />
          {{ s.name }} <span class="text-slate text-xs">({{ s.outlet }})</span>
        </label>
      </div>
    </template>

    <p v-if="error" class="text-coral text-sm">{{ error }}</p>

    <button type="button" @click="start" :disabled="starting" class="w-full bg-aqua text-white font-medium py-3 rounded-lg disabled:opacity-60">
      {{ starting ? t('masterPanel.impersonation.starting') : t('masterPanel.impersonation.start') }}
    </button>
  </div>
</template>
```

- [ ] **Step 2: Add i18n keys to `src/i18n/locales/en.json`**

Insert a new `"impersonation"` object right after the `"sessions"` block closes and before `"dataPurge"` starts (`en.json:607-608`):

```json
    "sessions": {
      ...
      "errorRevokeFailed": "Could not force logout."
    },
    "impersonation": {
      "title": "View As",
      "intro": "View the app exactly as a specific staff member or manager sees it. View-only — no changes are saved. Ends automatically after 30 minutes.",
      "back": "Back",
      "targetType": "Type",
      "targetTypeStaffRetail": "Staff (Retail)",
      "targetTypeStaffWarehouse": "Staff (Warehouse)",
      "targetTypeOutletManager": "Outlet Manager",
      "targetTypeWarehouseManager": "Warehouse Manager",
      "targetTypeAreaManager": "Area Manager",
      "outletLabel": "Outlet",
      "areaLabel": "Area",
      "selectOutlet": "Select...",
      "staffSearchPlaceholder": "Search by name",
      "search": "Search",
      "searching": "Searching...",
      "noStaffResults": "No matching staff found.",
      "start": "Start Viewing As",
      "starting": "Starting...",
      "errorSelectTarget": "Pick a target first.",
      "errorStartFailed": "Could not start."
    },
    "dataPurge": {
```

(Only the new `"impersonation"` block is an actual change — `"sessions"` and `"dataPurge"` are shown for placement context, do not modify their contents.)

- [ ] **Step 3: Add the matching block to `src/i18n/locales/ms.json`**

Same insertion point (right after `"sessions"` closes, before `"dataPurge"`):

```json
    "impersonation": {
      "title": "Lihat Sebagai",
      "intro": "Lihat aplikasi sepertimana staf atau pengurus tertentu melihatnya. Lihat sahaja — tiada perubahan disimpan. Tamat secara automatik selepas 30 minit.",
      "back": "Kembali",
      "targetType": "Jenis",
      "targetTypeStaffRetail": "Staf (Retail)",
      "targetTypeStaffWarehouse": "Staf (Gudang)",
      "targetTypeOutletManager": "Pengurus Outlet",
      "targetTypeWarehouseManager": "Pengurus Gudang",
      "targetTypeAreaManager": "Pengurus Kawasan",
      "outletLabel": "Outlet",
      "areaLabel": "Kawasan",
      "selectOutlet": "Pilih...",
      "staffSearchPlaceholder": "Cari mengikut nama",
      "search": "Cari",
      "searching": "Mencari...",
      "noStaffResults": "Tiada staf dijumpai.",
      "start": "Mula Lihat Sebagai",
      "starting": "Memulakan...",
      "errorSelectTarget": "Pilih sasaran dahulu.",
      "errorStartFailed": "Gagal memulakan."
    },
```

- [ ] **Step 4: Wire into `MasterPanel.vue`**

Add the import next to the other panel imports (after `import MasterActiveSessions from './MasterActiveSessions.vue'`):

```js
import MasterImpersonation from './MasterImpersonation.vue'
```

Add `'impersonation'` to `ENABLED_TABS`:

```js
const TABS = ['pinReset', 'overrides', 'dataPurge', 'maintenanceMode', 'auditLogs', 'backupExport', 'sessions', 'impersonation']
const ENABLED_TABS = ['pinReset', 'dataPurge', 'maintenanceMode', 'auditLogs', 'backupExport', 'sessions', 'impersonation']
```

Add the render branch next to the other panel components (after `MasterActiveSessions`). Note the `@started` handler closes the **whole panel** (not just this tab) — once impersonation starts, the banner (Task 7) takes over and there's nothing left to do inside the Master Panel drawer:

```html
<MasterImpersonation v-else-if="activeTab === 'impersonation'" @close="activeTab = null" @started="emit('close')" />
```

- [ ] **Step 5: Build check**

Run: `cd lautan-academy-frontend && npm run build`
Expected: clean build, no errors, no warnings about the new files.

- [ ] **Step 6: EN/MS key-parity check**

Run (from `lautan-academy-frontend`):

```bash
node -e "
const en = require('./src/i18n/locales/en.json');
const ms = require('./src/i18n/locales/ms.json');
function keys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, prefix + k + '.') : [prefix + k]
  );
}
const enKeys = new Set(keys(en));
const msKeys = new Set(keys(ms));
console.log('Missing in ms:', [...enKeys].filter((k) => !msKeys.has(k)));
console.log('Missing in en:', [...msKeys].filter((k) => !enKeys.has(k)));
"
```

Expected: both arrays empty.

- [ ] **Step 7: Commit**

```bash
git add lautan-academy-frontend/src/components/MasterImpersonation.vue lautan-academy-frontend/src/components/MasterPanel.vue lautan-academy-frontend/src/i18n/locales/en.json lautan-academy-frontend/src/i18n/locales/ms.json
git commit -m "feat: add MasterImpersonation target picker, wire into impersonation tab"
```

---

## Task 7: Frontend — `ImpersonationBanner.vue` + `App.vue` wiring + i18n

**Files:**
- Create: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\components\ImpersonationBanner.vue`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\App.vue`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\i18n\locales\en.json`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\i18n\locales\ms.json`

**Interfaces:**
- Consumes: `useAuthStore()` (`.impersonating`, `.staff`, `.manager`, `.exitImpersonation()` — all from Task 4).
- Produces: `ImpersonationBanner.vue`, no props/emits (self-contained, reads the store directly like `MaintenanceOverlay.vue` already does).

- [ ] **Step 1: Write `src/components/ImpersonationBanner.vue`**

```vue
<script setup>
// Master Subsystem H. Shown for the whole time auth.impersonating is true
// (set by store/auth.js's startImpersonation). Placed in normal document
// flow above the sidebar/content row in App.vue, not fixed — matches this
// codebase's existing MaintenanceOverlay in being store-driven and
// self-contained, but simpler since this doesn't need to block anything,
// only announce it and offer a way out.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../store/auth'

const { t } = useI18n()
const auth = useAuthStore()

const label = computed(() => {
  if (auth.staff) return `${auth.staff.name} (${auth.staff.outlet})`
  if (auth.manager) return `${auth.manager.role} / ${auth.manager.outlet}`
  return ''
})
</script>

<template>
  <div class="bg-coral text-white text-sm px-4 py-2 flex items-center justify-between gap-3">
    <span>{{ t('impersonationBanner.viewingAs', { label }) }}</span>
    <button type="button" @click="auth.exitImpersonation()" class="underline font-medium shrink-0">
      {{ t('impersonationBanner.exit') }}
    </button>
  </div>
</template>
```

- [ ] **Step 2: Wire into `App.vue`**

Current:

```vue
<script setup>
import { computed, onMounted } from 'vue'
import { useAuthStore } from './store/auth'
import { useMaintenanceStore } from './store/maintenance'
import AppSidebar from './components/AppSidebar.vue'
import MaintenanceOverlay from './components/MaintenanceOverlay.vue'

const auth = useAuthStore()
const maintenance = useMaintenanceStore()
const hasSession = computed(() => auth.isStaff || auth.isManager)

onMounted(() => {
  maintenance.check()
})
</script>

<template>
  <div v-if="hasSession" class="flex">
    <AppSidebar />
    <div class="flex-1 min-w-0 pb-20 md:pb-0">
      <router-view />
    </div>
  </div>
  <router-view v-else />
  <MaintenanceOverlay v-if="maintenance.active && hasSession" />
</template>
```

Replace with:

```vue
<script setup>
import { computed, onMounted } from 'vue'
import { useAuthStore } from './store/auth'
import { useMaintenanceStore } from './store/maintenance'
import AppSidebar from './components/AppSidebar.vue'
import MaintenanceOverlay from './components/MaintenanceOverlay.vue'
import ImpersonationBanner from './components/ImpersonationBanner.vue'

const auth = useAuthStore()
const maintenance = useMaintenanceStore()
const hasSession = computed(() => auth.isStaff || auth.isManager)

onMounted(() => {
  maintenance.check()
})
</script>

<template>
  <div v-if="hasSession">
    <ImpersonationBanner v-if="auth.impersonating" />
    <div class="flex">
      <AppSidebar />
      <div class="flex-1 min-w-0 pb-20 md:pb-0">
        <router-view />
      </div>
    </div>
  </div>
  <router-view v-else />
  <MaintenanceOverlay v-if="maintenance.active && hasSession" />
</template>
```

- [ ] **Step 3: Add i18n keys**

Add a new top-level `"impersonationBanner"` key to `src/i18n/locales/en.json` (as a sibling of the existing top-level `"masterPanel"` key — insert it right before or after `"masterPanel"`'s closing brace, matching how other top-level view namespaces like `"dashboardView"` are already siblings of `"masterPanel"`):

```json
  "impersonationBanner": {
    "viewingAs": "Viewing as {label} — view-only",
    "exit": "Exit"
  },
```

And to `src/i18n/locales/ms.json`, same placement:

```json
  "impersonationBanner": {
    "viewingAs": "Melihat sebagai {label} — lihat sahaja",
    "exit": "Keluar"
  },
```

- [ ] **Step 4: Build check + key-parity check**

Run: `cd lautan-academy-frontend && npm run build` — expect clean.

Run the same key-parity script from Task 6, Step 6 — expect both arrays empty.

- [ ] **Step 5: Commit**

```bash
git add lautan-academy-frontend/src/components/ImpersonationBanner.vue lautan-academy-frontend/src/App.vue lautan-academy-frontend/src/i18n/locales/en.json lautan-academy-frontend/src/i18n/locales/ms.json
git commit -m "feat: add impersonation banner, wire into App.vue"
```

---

## Task 8: Frontend — hide primary mutating actions while impersonating

**Files:**
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\views\DashboardView.vue`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\views\ModuleQuizView.vue`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\components\ManageStaffPanel.vue`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\views\OutletManagerDashboard.vue`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\views\WarehouseManagerDashboard.vue`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\views\AreaManagerReviewsView.vue`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\i18n\locales\en.json`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\i18n\locales\ms.json`

**Interfaces:**
- Consumes: `auth.impersonating` (Task 4) — `useAuthStore` is already imported in all 6 files except `ManageStaffPanel.vue`, which gains its first import of it here.
- Produces: no new exports — this task only gates existing UI, backend enforcement (Task 2) is the real boundary.

- [ ] **Step 1: `DashboardView.vue` — hide the "Join a Quiz" hero button and the join-code form**

Replace the hero button (current):

```html
          <button type="button" @click="scrollToJoin" class="mt-4 bg-aqua text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:opacity-90 transition-opacity">
            {{ t('dashboardView.joinQuizBtn') }}
          </button>
```

with:

```html
          <button v-if="!auth.impersonating" type="button" @click="scrollToJoin" class="mt-4 bg-aqua text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:opacity-90 transition-opacity">
            {{ t('dashboardView.joinQuizBtn') }}
          </button>
```

Replace the join-code section (current):

```html
      <!-- Join a Practice Quiz: unchanged existing feature, just relocated. -->
      <section ref="joinSection" class="area-join">
        <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('dashboardView.joinPracticeQuiz') }}</h2>
        <form @submit.prevent="joinQuiz" class="bg-white rounded-xl2 p-5 shadow-sm">
```

with:

```html
      <!-- Join a Practice Quiz: unchanged existing feature, just relocated. -->
      <section v-if="!auth.impersonating" ref="joinSection" class="area-join">
        <h2 class="font-display text-base font-semibold text-ink mb-3">{{ t('dashboardView.joinPracticeQuiz') }}</h2>
        <form @submit.prevent="joinQuiz" class="bg-white rounded-xl2 p-5 shadow-sm">
```

(the closing `</section>` on the line after the form's closing `</form>` needs no change — `v-if` on the opening tag is all that's required). Add a short note right after that `</section>` closing tag:

```html
      <p v-else class="text-slate text-sm text-center py-4">{{ t('dashboardView.impersonatingNotice') }}</p>
```

- [ ] **Step 2: `ModuleQuizView.vue` — hide the "Start Quiz" button**

Replace (current):

```html
        <button @click="start" :disabled="!selectedTopic" class="w-full bg-aqua text-white font-medium py-3 rounded-lg disabled:opacity-60">
          {{ t('moduleQuizView.startQuiz') }}
        </button>
```

with:

```html
        <button v-if="!auth.impersonating" @click="start" :disabled="!selectedTopic" class="w-full bg-aqua text-white font-medium py-3 rounded-lg disabled:opacity-60">
          {{ t('moduleQuizView.startQuiz') }}
        </button>
        <p v-else class="text-slate text-sm text-center">{{ t('moduleQuizView.impersonatingNotice') }}</p>
```

- [ ] **Step 3: `ManageStaffPanel.vue` — hide Reset PIN / Remove / Add**

Add the import and store instance (this file doesn't use `useAuthStore` today). Add after `import { api } from '../api/client'`:

```js
import { useAuthStore } from '../store/auth'
```

Add right after `const { t } = useI18n()`:

```js
const auth = useAuthStore()
```

Replace the per-row action buttons (current):

```html
            <div class="flex items-center gap-3 shrink-0">
              <button @click="startReset(s.Name)" class="text-aqua text-xs font-medium underline">{{ t('manageStaffPanel.resetPin') }}</button>
              <button @click="removeStaff(s.Name)" class="text-coral text-xs font-medium underline">{{ t('manageStaffPanel.remove') }}</button>
            </div>
```

with:

```html
            <div v-if="!auth.impersonating" class="flex items-center gap-3 shrink-0">
              <button @click="startReset(s.Name)" class="text-aqua text-xs font-medium underline">{{ t('manageStaffPanel.resetPin') }}</button>
              <button @click="removeStaff(s.Name)" class="text-coral text-xs font-medium underline">{{ t('manageStaffPanel.remove') }}</button>
            </div>
```

Replace the add-staff form (current):

```html
    <form @submit.prevent="addStaff" class="border-t border-seafoam p-5 flex items-center gap-2">
      <input v-model="addName" type="text" :placeholder="t('manageStaffPanel.namePlaceholder')" class="flex-1 min-w-0 border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <input v-model="addPin" type="password" inputmode="numeric" maxlength="4" :placeholder="t('manageStaffPanel.pinPlaceholder')" class="w-32 border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <button type="submit" :disabled="adding" class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60 shrink-0">
        {{ adding ? t('manageStaffPanel.adding') : t('manageStaffPanel.add') }}
      </button>
    </form>
    <p v-if="addError" class="text-coral text-xs px-5 pb-4 -mt-3">{{ addError }}</p>
```

with:

```html
    <form v-if="!auth.impersonating" @submit.prevent="addStaff" class="border-t border-seafoam p-5 flex items-center gap-2">
      <input v-model="addName" type="text" :placeholder="t('manageStaffPanel.namePlaceholder')" class="flex-1 min-w-0 border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <input v-model="addPin" type="password" inputmode="numeric" maxlength="4" :placeholder="t('manageStaffPanel.pinPlaceholder')" class="w-32 border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <button type="submit" :disabled="adding" class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60 shrink-0">
        {{ adding ? t('manageStaffPanel.adding') : t('manageStaffPanel.add') }}
      </button>
    </form>
    <p v-else class="text-slate text-xs px-5 py-4 border-t border-seafoam">{{ t('manageStaffPanel.impersonatingNotice') }}</p>
    <p v-if="addError" class="text-coral text-xs px-5 pb-4 -mt-3">{{ addError }}</p>
```

- [ ] **Step 4: `OutletManagerDashboard.vue` — hide the Create Quiz form**

Replace the form's opening tag (current):

```html
        <form @submit.prevent="createQuiz" class="bg-white rounded-xl2 p-5 shadow-sm space-y-3">
```

with:

```html
        <form v-if="!auth.impersonating" @submit.prevent="createQuiz" class="bg-white rounded-xl2 p-5 shadow-sm space-y-3">
```

Find that form's closing `</form>` tag further down the file and add immediately after it:

```html
        <p v-else class="text-slate text-sm bg-white rounded-xl2 p-5 shadow-sm">{{ t('outletManagerDashboard.impersonatingNotice') }}</p>
```

- [ ] **Step 5: `WarehouseManagerDashboard.vue` — hide the Create Quiz form**

Same edit as Step 4, in this file's own copy of the same form:

```html
        <form v-if="!auth.impersonating" @submit.prevent="createQuiz" class="bg-white rounded-xl2 p-5 shadow-sm space-y-3">
```

...with, immediately after that form's closing `</form>`:

```html
        <p v-else class="text-slate text-sm bg-white rounded-xl2 p-5 shadow-sm">{{ t('warehouseManagerDashboard.impersonatingNotice') }}</p>
```

- [ ] **Step 6: `AreaManagerReviewsView.vue` — hide the file/edit report form**

Replace the form's opening tag (current):

```html
        <form @submit.prevent="submitReport" class="bg-white rounded-xl2 p-5 shadow-sm space-y-4">
```

with:

```html
        <form v-if="!auth.impersonating" @submit.prevent="submitReport" class="bg-white rounded-xl2 p-5 shadow-sm space-y-4">
```

Find that form's closing `</form>` tag further down the file and add immediately after it:

```html
        <p v-else class="text-slate text-sm bg-white rounded-xl2 p-5 shadow-sm">{{ t('areaManagerReviewsView.impersonatingNotice') }}</p>
```

- [ ] **Step 7: Add `impersonatingNotice` i18n keys**

Add one new key to each of these 6 existing namespaces in `src/i18n/locales/en.json` (insert as the last key inside each namespace's closing brace, comma-separated with the existing last key):

```json
    "dashboardView": { ..., "impersonatingNotice": "Quiz-taking is hidden while viewing as someone else." },
    "moduleQuizView": { ..., "impersonatingNotice": "Quiz-taking is hidden while viewing as someone else." },
    "manageStaffPanel": { ..., "impersonatingNotice": "Staff management is hidden while viewing as someone else." },
    "outletManagerDashboard": { ..., "impersonatingNotice": "Quiz creation is hidden while viewing as someone else." },
    "warehouseManagerDashboard": { ..., "impersonatingNotice": "Quiz creation is hidden while viewing as someone else." },
    "areaManagerReviewsView": { ..., "impersonatingNotice": "Filing reports is hidden while viewing as someone else." }
```

(Shown compressed here for clarity — in the actual file, add each `"impersonatingNotice": "..."` line as a normal new line inside that namespace's existing object, not literally on one line with `{ ..., }`.)

Add the matching 6 keys to `src/i18n/locales/ms.json`:

```json
    "dashboardView": { "impersonatingNotice": "Mengambil kuiz disembunyikan semasa melihat sebagai orang lain." },
    "moduleQuizView": { "impersonatingNotice": "Mengambil kuiz disembunyikan semasa melihat sebagai orang lain." },
    "manageStaffPanel": { "impersonatingNotice": "Pengurusan staf disembunyikan semasa melihat sebagai orang lain." },
    "outletManagerDashboard": { "impersonatingNotice": "Penciptaan kuiz disembunyikan semasa melihat sebagai orang lain." },
    "warehouseManagerDashboard": { "impersonatingNotice": "Penciptaan kuiz disembunyikan semasa melihat sebagai orang lain." },
    "areaManagerReviewsView": { "impersonatingNotice": "Memfailkan laporan disembunyikan semasa melihat sebagai orang lain." }
```

- [ ] **Step 8: Build check + key-parity check**

Run: `cd lautan-academy-frontend && npm run build` — expect clean.

Run the same key-parity script from Task 6, Step 6 — expect both arrays empty.

- [ ] **Step 9: Commit**

```bash
git add lautan-academy-frontend/src/views/DashboardView.vue lautan-academy-frontend/src/views/ModuleQuizView.vue lautan-academy-frontend/src/components/ManageStaffPanel.vue lautan-academy-frontend/src/views/OutletManagerDashboard.vue lautan-academy-frontend/src/views/WarehouseManagerDashboard.vue lautan-academy-frontend/src/views/AreaManagerReviewsView.vue lautan-academy-frontend/src/i18n/locales/en.json lautan-academy-frontend/src/i18n/locales/ms.json
git commit -m "feat: hide primary mutating actions across all views while impersonating"
```

---

## Task 9: End-to-end live verification

No new files — this task is a full click-through of everything built in Tasks 1-8 together, using disposable test accounts only (never real production credentials — same caution as every prior Master subsystem).

- [ ] **Step 1: Start both dev servers**

`cd lautan-academy-backend && node src/index.js` and, in a second terminal, `cd lautan-academy-frontend && npm run dev`.

- [ ] **Step 2: Full staff impersonation flow**

Log in as Master in the browser, open the Master Panel, click "View As" (no longer "Coming Soon"). Pick Staff (Retail), pick a real outlet, search a real disposable test staff name, select it, click "Start Viewing As". Confirm: the Master Panel closes, the coral banner appears at the top showing the staff name/outlet, the dashboard renders as that staff member (real avg score, real history). Confirm the "Join a Quiz" button and Join form are gone, replaced by the impersonating notice. Navigate to Module Quiz — confirm the "Start Quiz" button is replaced by its notice too. Click "Exit" on the banner — confirm it returns to wherever Master's own session was (Master Panel closed / dashboard, matching whatever was active before impersonation started), banner disappears.

- [ ] **Step 3: Manager impersonation flow (Outlet Manager)**

Repeat via "View As" → Outlet Manager → pick a real outlet → Start. Confirm the Outlet Manager dashboard renders (staff results, history) with the Create Quiz form replaced by its notice, and the Manage Staff tab's Reset PIN/Remove/Add all replaced by their notice. Exit.

- [ ] **Step 4: Area Manager impersonation flow**

Repeat via "View As" → Area Manager → pick a real area → Start. Confirm the region-wide dashboard renders, the Assessment/Reviews page's report form is replaced by its notice. Exit.

- [ ] **Step 5: Backend-enforcement proof (not just UI hiding)**

While impersonating any role, open the browser's dev tools Network tab and manually re-trigger any hidden action's underlying request isn't possible from the UI anymore — instead, confirm via a direct `curl` (reusing the impersonation token copied from `localStorage.lautan_token` in dev tools) that a POST to that role's mutating endpoint still 403s, proving the UI hiding in Task 8 isn't the only thing standing between an impersonated session and a real write.

- [ ] **Step 6: Concurrent real session survives the stash/restore round-trip**

In a separate browser tab, log in as a different real disposable staff/manager test account and leave it open. In the Master Panel tab, start and then exit an impersonation session for a *different* target. Confirm the separate tab's session was never disturbed (still logged in, unaffected) throughout — proving the stash correctly isolated the two.

- [ ] **Step 7: Auto-expiry path**

Start an impersonation session. Force-revoke it from the Active Sessions tab (Subsystem G, using the `impersonatedBy` tag if visible, or by matching scopeType/scopeKey) instead of waiting the full 30 minutes. Confirm the impersonated view auto-redirects home and the banner disappears without the user clicking Exit — proving the 401 auto-exit path in `api/client.js` works, not just the manual Exit button.

- [ ] **Step 8: Bahasa Malaysia pass**

Toggle to BM and repeat a shortened version of Step 2 (View As picker, banner text, one impersonatingNotice) — confirm every new string renders correctly in BM.

- [ ] **Step 9: No commit for this task** — it's verification only. If any step surfaces a real bug, fix it as a small follow-up commit referencing which task's code it belongs to, then re-run the affected step.

---

## Post-implementation: update MEMORY.md / SCOPE_TRACKER.md

Per `CLAUDE.md` rule 5: once all 9 tasks are verified (curl round-trips including the immediate-revocation and view-only-403 proofs, build clean after every frontend task, EN/MS parity clean, full live browser click-through across staff + both manager types + the auto-expiry path + the concurrent-session survival check, both languages), add a Subsystem H entry to `MEMORY.md`'s Master Subsystem list (same format as A-G: what was built, backend/frontend commit hashes, spec/plan links, what was verified and how, any real issues found during verification). Note explicitly: Supervisor and Master are excluded from impersonation, the 30-minute TTL and its minutes-not-hours implementation detail, and that `requireAuth` (not a separate middleware) is the single view-only enforcement point. This closes out the full 8-subsystem Master User / Super Admin Control Panel initiative (A-H) — say so explicitly if true once verified. Then prompt the user to `/clear`.
