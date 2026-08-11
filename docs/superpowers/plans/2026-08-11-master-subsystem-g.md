# Master Subsystem G: Active Sessions + Force-Logout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Master can see active staff/manager sessions and force-logout one or several on demand — a real architecture change, since today's auth is fully stateless JWT with zero session tracking.

**Architecture:** New `sessions` table (one row per staff/manager login). `issueToken()` now writes a row and embeds its id as a `sid` JWT claim. `requireAuth` checks `sid` against an in-memory revoked-set (no DB call on the request path) refreshed by a ~25s background poller; the revoke route also writes directly into that set so force-logout is instant for the process handling it. Master's own tokens are untouched — no `sid`, no tracking, no revocation check.

**Tech Stack:** Node.js/Express/`pg` (backend), Vue 3 + `vue-i18n` (frontend). No new dependencies either side.

## Global Constraints

- Scope is staff (`staff_retail`, `staff_warehouse`) + 4 manager roles (`outlet_manager`, `warehouse_manager`, `area_manager`, `supervisor`) only. **Master excluded** — decided during brainstorming (too few Master accounts to justify self-lockout risk).
- Revocation check is an **in-memory cache**, not a live DB query per request — decided during brainstorming as the lighter-weight alternative. Single Railway instance, no cross-instance sync concern.
- `sessions.id` is `bigserial`. node-pg returns bigint columns as JS **strings**, not numbers — keep the session id a string everywhere it flows (JWT `sid` claim, in-memory cache `Set`, revoke-route params). This project has a logged past bug (`standard_questions.id`, see `SCOPE_TRACKER.md`) from exactly this kind of string/number mismatch — do not `parseInt`/`Number()` it anywhere in this feature.
- Revoke uses the codebase's established **`{ids: [...]}` bulk-array convention** (same shape as every existing purge route: `/master/purge/staff/delete`, `/master/purge/manager-accounts/delete`, etc.) rather than a separate filter-based bulk endpoint — one route handles both single and multi revoke, matching how every other Master subsystem already does bulk actions. This is a deliberate implementation choice, not a scope change from the design spec — the spec's "kill one or a filtered group" behavior is unchanged, just implemented via the existing ids-array pattern instead of a bespoke filter-match endpoint.
- Retention: session rows older than 30 days are pruned by the same background interval that refreshes the revocation cache — no separate cron mechanism exists in this app.
- Bilingual EN/MS strings required for all new UI text, following the exact key-nesting pattern already used under `masterPanel.*` in `src/i18n/locales/{en,ms}.json`. The tab label itself (`masterPanel.tab.sessions`) already exists (seeded when Subsystem A built the tab shell) — only the panel-body strings are new.
- No test framework exists in either repo — verification is `curl` + `npm run build` + live browser click-through, matching every prior Master subsystem (A–F).
- This project is a single git repo rooted at `C:\Users\Hafiz\projects\lautan-academy`; the backend lives in the sibling directory `C:\Users\Hafiz\projects\lautan-academy-backend` (separate repo, independent commits), the frontend lives in `lautan-academy-frontend/` inside this repo.
- Every new/changed Master route stays gated `requireAuth` + `requireMaster`, matching every prior subsystem.

---

## Task 1: Backend — `sessions` table migration

**Files:**
- Create: `C:\Users\Hafiz\projects\lautan-academy-backend\scripts\migrate-add-sessions.js`
- Modify: `C:\Users\Hafiz\projects\lautan-academy-backend\sql\schema.sql`

**Interfaces:**
- Consumes: `pool` from `../src/config/db.js` (existing, same import every migration script in `scripts/` uses).
- Produces: `sessions` table (columns: `id bigserial primary key`, `scope_type text not null`, `scope_key text not null`, `issued_at timestamptz not null default now()`, `expires_at timestamptz not null`, `revoked_at timestamptz`, `revoked_by text`, `ip text`, `user_agent text`), consumed by Task 2 (revocation cache query), Task 3 (`issueToken` insert), Task 4 (search/revoke routes).

- [ ] **Step 1: Write `scripts/migrate-add-sessions.js`**

```js
// One-off: creates sessions (Master Subsystem G) — one row per staff/manager
// login, tracked so Master can view active sessions and force-logout one or
// several. Master's own tokens are never written here (untracked by design).
// See docs/superpowers/specs/2026-08-11-master-subsystem-g-design.md.
// Safe to re-run (create-if-not-exists).
import { pool } from '../src/config/db.js';

async function main() {
  await pool.query(`
    create table if not exists sessions (
      id bigserial primary key,
      scope_type text not null,
      scope_key text not null,
      issued_at timestamptz not null default now(),
      expires_at timestamptz not null,
      revoked_at timestamptz,
      revoked_by text,
      ip text,
      user_agent text
    )
  `);
  await pool.query(`
    create index if not exists sessions_active_idx on sessions (revoked_at, expires_at)
  `);
  await pool.query(`
    create index if not exists sessions_scope_idx on sessions (scope_type, scope_key)
  `);
  console.log('Migration complete: sessions table created.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it against local dev DB**

Run: `cd lautan-academy-backend && node scripts/migrate-add-sessions.js`
Expected output: `Migration complete: sessions table created.`

- [ ] **Step 3: Verify the table exists**

```bash
node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  const { rows } = await pool.query(\"select column_name, data_type from information_schema.columns where table_name = 'sessions' order by ordinal_position\");
  console.log(rows);
  await pool.end();
});
"
```

Expected: 9 rows listing `id`/`bigint`, `scope_type`/`text`, `scope_key`/`text`, `issued_at`/`timestamp with time zone`, `expires_at`/`timestamp with time zone`, `revoked_at`/`timestamp with time zone`, `revoked_by`/`text`, `ip`/`text`, `user_agent`/`text`.

- [ ] **Step 4: Add the table to `sql/schema.sql`**

Append after the existing `system_settings` block (`sql/schema.sql:177-182`, right before the trailing indexes at line 184):

```sql
create table if not exists sessions (
  id bigserial primary key,
  scope_type text not null,
  scope_key text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text,
  ip text,
  user_agent text
);
create index if not exists sessions_active_idx on sessions (revoked_at, expires_at);
create index if not exists sessions_scope_idx on sessions (scope_type, scope_key);
```

- [ ] **Step 5: Commit**

```bash
cd lautan-academy-backend
git add scripts/migrate-add-sessions.js sql/schema.sql
git commit -m "feat: add sessions table for Master Subsystem G"
```

---

## Task 2: Backend — in-memory session revocation cache

**Files:**
- Create: `C:\Users\Hafiz\projects\lautan-academy-backend\src\services\sessionRevocationCache.js`

**Interfaces:**
- Consumes: `pool` from `../config/db.js`; the `sessions` table from Task 1.
- Produces: `isRevoked(sid: string): boolean` (consumed by Task 3's `requireAuth`), `addRevokedSid(sid: string): void` (consumed by Task 4's revoke route), `refreshRevocationCache(): Promise<void>`, `startSessionMaintenanceLoop(): void` (consumed by Task 4's `index.js` startup).

- [ ] **Step 1: Write `src/services/sessionRevocationCache.js`**

```js
import { pool } from '../config/db.js';

// In-memory cache of currently-revoked, not-yet-naturally-expired session
// ids. requireAuth checks against this instead of hitting the DB on every
// authenticated request — decided during brainstorming as the lighter-
// weight alternative to a live per-request DB check. Single Railway
// instance, so no cross-instance sync concern. See
// docs/superpowers/specs/2026-08-11-master-subsystem-g-design.md.
let revokedSids = new Set();

export function isRevoked(sid) {
  return revokedSids.has(sid);
}

// Called directly by the revoke route so the process handling the revoke
// enforces it immediately, not after the next poll tick. The periodic
// refresh below remains the source of truth (handles restarts, and prunes
// ids once they age past their own expires_at, keeping the Set bounded).
export function addRevokedSid(sid) {
  revokedSids.add(sid);
}

export async function refreshRevocationCache() {
  const { rows } = await pool.query(
    `select id from sessions where revoked_at is not null and expires_at > now()`
  );
  revokedSids = new Set(rows.map((r) => r.id));
}

const POLL_INTERVAL_MS = 25000;
const RETENTION_DAYS = 30;

// Prunes session rows older than the retention window. Piggybacks on the
// same interval as the cache refresh — no separate cron mechanism exists in
// this app (see Subsystem F's retention approach for the same pattern).
async function pruneOldSessions() {
  await pool.query(`delete from sessions where expires_at < now() - interval '${RETENTION_DAYS} days'`);
}

// Call once at server startup. Runs refreshRevocationCache() immediately
// (no blind window on a fresh deploy where a revoked-but-not-yet-expired
// session exists), then every POLL_INTERVAL_MS after that.
export function startSessionMaintenanceLoop() {
  refreshRevocationCache().catch((err) => console.error('refreshRevocationCache failed:', err.message));
  setInterval(() => {
    refreshRevocationCache().catch((err) => console.error('refreshRevocationCache failed:', err.message));
    pruneOldSessions().catch((err) => console.error('pruneOldSessions failed:', err.message));
  }, POLL_INTERVAL_MS);
}
```

- [ ] **Step 2: Verify it runs cleanly against the local DB**

```bash
cd lautan-academy-backend
node -e "
import('./src/services/sessionRevocationCache.js').then(async (m) => {
  await m.refreshRevocationCache();
  console.log('refreshRevocationCache ok, isRevoked(\"1\") =', m.isRevoked('1'));
  process.exit(0);
});
"
```

Expected: `refreshRevocationCache ok, isRevoked("1") = false` (table is empty right after Task 1's migration, so nothing is revoked yet — this just confirms the query runs without error).

- [ ] **Step 3: Commit**

```bash
git add src/services/sessionRevocationCache.js
git commit -m "feat: add in-memory session revocation cache service"
```

---

## Task 3: Backend — session issuance + revocation check in `middleware/auth.js`

**Files:**
- Modify: `C:\Users\Hafiz\projects\lautan-academy-backend\src\middleware\auth.js`
- Modify: `C:\Users\Hafiz\projects\lautan-academy-backend\src\routes\auth.js`

**Interfaces:**
- Consumes: `isRevoked` from `../services/sessionRevocationCache.js` (Task 2).
- Produces: `issueToken(scopeType, scopeKey)` becomes `async`, returns `Promise<string>` (JWT with an added `sid` string claim) — every existing caller must now `await` it. `requireAuth` unchanged in signature, but now 401s revoked non-master sessions.

- [ ] **Step 1: Modify `issueToken` in `middleware/auth.js`**

Replace the current `issueToken` (lines 5-7):

```js
export function issueToken(scopeType, scopeKey) {
  return jwt.sign({ scopeType, scopeKey }, env.jwtSecret, { expiresIn: '12h' });
}
```

with:

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

`pool` is already imported at the top of this file (line 3, used by `checkMaintenance`) — no new import needed for this part.

- [ ] **Step 2: Add the revocation check to `requireAuth`**

Add the import at the top of `middleware/auth.js` (after the existing `pool` import, line 3):

```js
import { isRevoked } from '../services/sessionRevocationCache.js';
```

Replace `requireAuth` (lines 16-26):

```js
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.body.token;
  if (!token) return res.status(401).json({ authorized: false, error: 'No session token.' });
  try {
    req.session = jwt.verify(token, env.jwtSecret);
    next();
  } catch (e) {
    res.status(401).json({ authorized: false, error: 'Your session has expired — please log in again.' });
  }
}
```

with:

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

- [ ] **Step 3: Update the 3 call sites in `routes/auth.js`**

`staff-login` (line 52):

```js
  const token = issueToken(scopeType, scopeKey);
```

becomes:

```js
  const token = await issueToken(scopeType, scopeKey);
```

`manager-login` (line 120):

```js
  const token = issueToken(role, scopeKey);
```

becomes:

```js
  const token = await issueToken(role, scopeKey);
```

`manager-register` (line 189):

```js
  const token = issueToken(role, scopeKey);
```

becomes:

```js
  const token = await issueToken(role, scopeKey);
```

All three call sites are already inside `async` route handlers, so this is mechanical — no other changes needed on this file. `issueMasterToken` (lines 12-14) and `/master-login` (line 333) are untouched.

- [ ] **Step 4: Start the backend and verify session creation + `sid` claim**

Run: `cd lautan-academy-backend && node src/index.js`

In a second terminal, log in as a real staff account:

```bash
curl -s -X POST http://localhost:3000/auth/staff-login -H "Content-Type: application/json" -d '{"division":"retail","outlet":"<real outlet>","name":"<real staff name>","pin":"<real pin>"}'
```

Copy the `token`, decode its payload (JWT payload is the middle base64url segment):

```bash
node -e "console.log(JSON.parse(Buffer.from('<token middle segment>', 'base64url').toString()))"
```

Expected: `{ scopeType: 'staff_retail', scopeKey: '<OUTLET|NAME>', sid: '<some numeric string>', iat: ..., exp: ... }` — `sid` must be a string (quoted), not a bare number.

Then confirm the row exists:

```bash
node -e "
import('./src/config/db.js').then(async ({ pool }) => {
  const { rows } = await pool.query('select * from sessions order by id desc limit 1');
  console.log(rows[0]);
  await pool.end();
});
"
```

Expected: one row with `scope_type = 'staff_retail'`, `scope_key` matching the outlet/name, `expires_at` roughly 12h ahead of `issued_at`, `revoked_at` null. Confirm the request the token was used for (a normal authenticated call, e.g. `GET /questions` — public, so instead try `GET /data/scoped-data` with the token) still succeeds normally (revocation check should pass through since nothing is revoked yet).

- [ ] **Step 5: Commit**

```bash
git add src/middleware/auth.js src/routes/auth.js
git commit -m "feat: track staff/manager sessions, add revocation check to requireAuth"
```

---

## Task 4: Backend — `/master/sessions` search + revoke routes

**Files:**
- Create: `C:\Users\Hafiz\projects\lautan-academy-backend\src\routes\masterSessions.js`
- Modify: `C:\Users\Hafiz\projects\lautan-academy-backend\src\index.js`

**Interfaces:**
- Consumes: `pool` from `../config/db.js`; `requireAuth`, `requireMaster` from `../middleware/auth.js` (Task 3); `logAudit` from `../services/auditLog.js` (existing); `addRevokedSid` from `../services/sessionRevocationCache.js` (Task 2).
- Produces: `masterSessionsRouter` (Express `Router`, exported), mounted at `/master/sessions`. Live endpoints: `GET /master/sessions/search`, `POST /master/sessions/revoke`. Consumed by Task 5's frontend API client methods.

- [ ] **Step 1: Write `src/routes/masterSessions.js`**

```js
import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth, requireMaster } from '../middleware/auth.js';
import { logAudit } from '../services/auditLog.js';
import { addRevokedSid } from '../services/sessionRevocationCache.js';

export const masterSessionsRouter = Router();

// Same pattern as masterPurge.js's withTransaction — file-local, not
// shared, matching this codebase's existing convention of small per-file
// helpers over a shared utility module.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

masterSessionsRouter.get('/search', requireAuth, requireMaster, async (req, res) => {
  const scopeType = (req.query.scopeType || '').toString().trim();
  const scopeKey = (req.query.scopeKey || '').toString().trim();
  const activeOnly = req.query.activeOnly !== 'false';

  const conditions = [];
  const params = [];
  if (scopeType) { params.push(scopeType); conditions.push(`scope_type = $${params.length}`); }
  if (scopeKey) { params.push(`%${scopeKey}%`); conditions.push(`scope_key ilike $${params.length}`); }
  if (activeOnly) { conditions.push(`revoked_at is null and expires_at > now()`); }
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';

  const { rows } = await pool.query(
    `select id, scope_type, scope_key, issued_at, expires_at, revoked_at from sessions ${where} order by issued_at desc limit 200`,
    params
  );
  res.json({
    sessions: rows.map(r => ({
      id: r.id, scopeType: r.scope_type, scopeKey: r.scope_key,
      issuedAt: r.issued_at, expiresAt: r.expires_at, revokedAt: r.revoked_at,
    })),
  });
});

// Single {ids: [...]} bulk endpoint covers both single-session and
// filtered-multi-select force-logout — matches every other Master
// subsystem's bulk-delete shape (see Global Constraints).
masterSessionsRouter.post('/revoke', requireAuth, requireMaster, async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ status: 'error', error: 'No sessions selected.' });

  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `update sessions set revoked_at = now(), revoked_by = $1
         where id = ANY($2::bigint[]) and revoked_at is null
         returning id, scope_type, scope_key`,
        [req.session.scopeKey, ids]
      );
      if (!rows.length) throw new Error('No matching active sessions found.');

      for (const r of rows) addRevokedSid(r.id);

      const summary = `Force-logged-out ${rows.length} session(s): ${rows.map(r => `${r.scope_type}/${r.scope_key}`).join(', ')}`;
      await logAudit(client, { actorType: 'master', actorKey: req.session.scopeKey, action: 'session.force_logout', summary, affectedCount: rows.length });
      return { revokedCount: rows.length };
    });
    res.json({ status: 'ok', revokedCount: result.revokedCount });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message || 'Revoke failed.' });
  }
});
```

- [ ] **Step 2: Mount the router and start the maintenance loop in `src/index.js`**

Add the imports next to the other route imports (after `import { masterBackupRouter } from './routes/masterBackup.js';`, line 15):

```js
import { masterSessionsRouter } from './routes/masterSessions.js';
import { startSessionMaintenanceLoop } from './services/sessionRevocationCache.js';
```

Add the mount next to the other `/master/*` mounts (after `app.use('/master/audit-log', auditLogRouter);`, line 32):

```js
app.use('/master/sessions', masterSessionsRouter);
```

Start the maintenance loop right before `app.listen` (currently lines 37-39):

```js
startSessionMaintenanceLoop();

app.listen(env.port, () => {
  console.log(`lautan-academy-backend listening on :${env.port}`);
});
```

Not wrapped in `checkMaintenance` — matches every other `/master/*` route.

- [ ] **Step 3: Restart the backend and verify the full force-logout flow end-to-end**

Restart: `cd lautan-academy-backend && node src/index.js`

Log in as a real staff account and as Master:

```bash
curl -s -X POST http://localhost:3000/auth/staff-login -H "Content-Type: application/json" -d '{"division":"retail","outlet":"<real outlet>","name":"<real staff name>","pin":"<real pin>"}'
curl -s -X POST http://localhost:3000/auth/master-login -H "Content-Type: application/json" -d '{"username":"<real master username>","password":"<real master password>"}'
```

Confirm the staff token currently works:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/data/scoped-data -H "Authorization: Bearer <staff token>"
```

Expected: `200`.

Search for it as Master:

```bash
curl -s "http://localhost:3000/master/sessions/search?scopeType=staff_retail" -H "Authorization: Bearer <master token>"
```

Expected: JSON with a `sessions` array containing that session's `id`, `scopeType: "staff_retail"`, `scopeKey` matching outlet/name, `revokedAt: null`. Copy its `id`.

Revoke it:

```bash
curl -s -X POST http://localhost:3000/master/sessions/revoke -H "Authorization: Bearer <master token>" -H "Content-Type: application/json" -d '{"ids":["<session id>"]}'
```

Expected: `{"status":"ok","revokedCount":1}`.

Immediately re-check the staff token (proves the direct `addRevokedSid` path, not just eventual poll-driven consistency):

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/data/scoped-data -H "Authorization: Bearer <staff token>"
```

Expected: `401`, immediately — no waiting for the poll interval.

Confirm the Master token itself is unaffected throughout:

```bash
curl -s "http://localhost:3000/master/sessions/search?scopeType=staff_retail" -H "Authorization: Bearer <master token>"
```

Expected: still `200`, works fine.

Confirm the audit trail:

```bash
curl -s "http://localhost:3000/master/audit-log/search?action=session.force_logout" -H "Authorization: Bearer <master token>"
```

Expected: one entry with the right `summary` and `affectedCount: 1`.

- [ ] **Step 4: Verify multi-revoke and the no-filter/empty-ids guard**

Log in as the same staff account twice more (2 fresh sessions), confirm both appear in a search, revoke both in one call (`{"ids": ["<id1>", "<id2>"]}`), confirm `revokedCount: 2` and both staff tokens now 401.

```bash
curl -s -X POST http://localhost:3000/master/sessions/revoke -H "Authorization: Bearer <master token>" -H "Content-Type: application/json" -d '{"ids":[]}'
```

Expected: `400`, `{"status":"error","error":"No sessions selected."}`.

- [ ] **Step 5: Verify auth gating**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/master/sessions/search
```

Expected: `401` (no token).

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/master/sessions/search" -H "Authorization: Bearer <staff token>"
```

Expected: `403` (wrong scopeType — use a fresh staff login here since the earlier one is now revoked/401 for a different reason).

- [ ] **Step 6: Commit**

```bash
git add src/routes/masterSessions.js src/index.js
git commit -m "feat: add master active-sessions search + force-logout routes"
```

---

## Task 5: Frontend — API client methods

**Files:**
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\api\client.js`

**Interfaces:**
- Consumes: `request()` helper (existing, `client.js:12-45`).
- Produces: `api.masterSearchSessions(params, masterToken)` and `api.masterRevokeSessions(ids, masterToken)`, both async, resolving to the parsed JSON body or throwing `Error` on failure (same contract as every other `master*` method in this file). Consumed by Task 6's `MasterActiveSessions.vue`.

- [ ] **Step 1: Add both methods to the `api` object**

Add as the last two entries, right after `masterBackupExport` (`client.js:134-147`):

```js
  masterSearchSessions: (params, masterToken) =>
    request(`/master/sessions/search?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${masterToken}` } }),
  masterRevokeSessions: (ids, masterToken) =>
    request('/master/sessions/revoke', { method: 'POST', body: JSON.stringify({ ids }), headers: { Authorization: `Bearer ${masterToken}` } }),
```

- [ ] **Step 2: Sanity-check in isolation**

No test framework exists — verify by reading the diff: confirm both methods follow the exact same shape as `searchAuditLog`/`masterDeleteManagerAccounts` (`client.js:123-124`, `113-114`), confirm no stray comma/bracket broke the `api` object literal. Exercised for real once Task 6 wires it into the UI.

- [ ] **Step 3: Commit**

```bash
git add lautan-academy-frontend/src/api/client.js
git commit -m "feat: add masterSearchSessions/masterRevokeSessions API client methods"
```

---

## Task 6: Frontend — Active Sessions panel + i18n + wiring

**Files:**
- Create: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\components\MasterActiveSessions.vue`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\components\MasterPanel.vue`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\i18n\locales\en.json`
- Modify: `C:\Users\Hafiz\projects\lautan-academy\lautan-academy-frontend\src\i18n\locales\ms.json`

**Interfaces:**
- Consumes: `api.masterSearchSessions`/`api.masterRevokeSessions` (Task 5); `useMasterAuthStore()` (existing, exposes `.token`); `AREAS` from `../config/areas` (existing); `MasterDeleteConfirmModal.vue` (existing, generic `title`/`breakdown`/`warning`/`loading` props, `confirm`/`cancel` emits — reused as-is, not renamed, matching this codebase's existing reuse of it across Data Purge sub-panels).
- Produces: `MasterActiveSessions.vue`, emits `close` (matches every sibling panel).

- [ ] **Step 1: Write `src/components/MasterActiveSessions.vue`**

```vue
<script setup>
// Master-only: view active staff/manager sessions and force-logout one or
// several (Subsystem G). Filter/table shape mirrors MasterAuditLog.vue;
// checkbox-select + confirm-modal bulk action mirrors
// PurgeManagerAccountsPanel.vue. See
// docs/superpowers/specs/2026-08-11-master-subsystem-g-design.md.
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api/client'
import { useMasterAuthStore } from '../store/masterAuth'
import { AREAS } from '../config/areas'
import MasterDeleteConfirmModal from './MasterDeleteConfirmModal.vue'

const emit = defineEmits(['close'])
const { t } = useI18n()
const masterAuth = useMasterAuthStore()

// Master itself is never tracked (see Global Constraints) — not in this list.
const SCOPE_TYPES = ['staff_retail', 'staff_warehouse', 'outlet_manager', 'warehouse_manager', 'area_manager', 'supervisor']

const RETAIL_OUTLETS = [...new Set(AREAS.flatMap(a => a.outlets))].sort()
const WAREHOUSE_LOCATIONS = ['Taskforce', 'Warehouse', 'Inventory', 'Logistic']
const AREA_IDS = AREAS.map(a => a.id)

const scopeType = ref('')
const scopeKey = ref('')
const activeOnly = ref(true)

// staff_retail/staff_warehouse/supervisor have no clean dropdown list
// (scope_key is OUTLET|NAME for staff, always 'ALL' for supervisor) — those
// fall back to free text, same pattern MasterAuditLog.vue already uses.
const scopeKeyOptions = computed(() => {
  if (scopeType.value === 'outlet_manager') return RETAIL_OUTLETS
  if (scopeType.value === 'warehouse_manager') return WAREHOUSE_LOCATIONS
  if (scopeType.value === 'area_manager') return AREA_IDS
  return null
})
watch(scopeType, () => { scopeKey.value = '' })

const sessions = ref([])
const selected = ref(new Set())
const searching = ref(false)
const searchError = ref('')
const searched = ref(false)
const showConfirm = ref(false)
const revoking = ref(false)
const status = ref('')
const statusOk = ref(false)

async function search() {
  searchError.value = ''
  searching.value = true
  selected.value = new Set()
  try {
    const params = { activeOnly: activeOnly.value ? 'true' : 'false' }
    if (scopeType.value) params.scopeType = scopeType.value
    if (scopeKey.value.trim()) params.scopeKey = scopeKey.value.trim()
    const data = await api.masterSearchSessions(params, masterAuth.token)
    sessions.value = data.sessions || []
    searched.value = true
  } catch (err) {
    searchError.value = err.message || t('masterPanel.sessions.errorSearchFailed')
  } finally {
    searching.value = false
  }
}

function toggle(id) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function breakdown() {
  return [{ label: t('masterPanel.sessions.breakdownSessions'), count: selected.value.size }]
}

async function revokeIds(ids) {
  revoking.value = true
  status.value = ''
  try {
    const data = await api.masterRevokeSessions(ids, masterAuth.token)
    status.value = t('masterPanel.sessions.successRevoked', { count: data.revokedCount })
    statusOk.value = true
    showConfirm.value = false
    await search()
  } catch (err) {
    status.value = err.message || t('masterPanel.sessions.errorRevokeFailed')
    statusOk.value = false
  } finally {
    revoking.value = false
  }
}

// Single-session revoke is reversible (the person just logs back in), so it
// gets a lightweight native confirm instead of the full typed-confirm modal
// — that modal is reserved for the higher-blast-radius bulk action below.
function revokeOne(session) {
  if (!window.confirm(t('masterPanel.sessions.confirmOne', { scope: `${session.scopeType}/${session.scopeKey}` }))) return
  revokeIds([session.id])
}

function revokeSelected() {
  revokeIds(Array.from(selected.value))
}

search()
</script>

<template>
  <div class="px-5 py-4 space-y-4 overflow-y-auto flex-1">
    <button type="button" @click="emit('close')" class="text-sm text-slate hover:text-ink flex items-center gap-1">
      &larr; {{ t('masterPanel.sessions.back') }}
    </button>
    <div>
      <h3 class="font-display font-semibold text-ink text-base mb-1">{{ t('masterPanel.sessions.title') }}</h3>
      <p class="text-slate text-xs">{{ t('masterPanel.sessions.intro') }}</p>
    </div>

    <form @submit.prevent="search" class="flex flex-wrap items-center gap-2">
      <select v-model="scopeType" class="border border-slate/30 rounded-lg py-2 px-3 text-sm">
        <option value="">{{ t('masterPanel.sessions.filterScopeTypeAll') }}</option>
        <option v-for="opt in SCOPE_TYPES" :key="opt" :value="opt">{{ opt }}</option>
      </select>
      <select v-if="scopeKeyOptions" v-model="scopeKey" class="flex-1 min-w-[8rem] border border-slate/30 rounded-lg py-2 px-3 text-sm">
        <option value="">{{ t('masterPanel.sessions.filterScopeKeyAll') }}</option>
        <option v-for="o in scopeKeyOptions" :key="o" :value="o">{{ o }}</option>
      </select>
      <input v-else v-model="scopeKey" type="text" :placeholder="t('masterPanel.sessions.filterScopeKeyPlaceholder')" class="flex-1 min-w-[8rem] border border-slate/30 rounded-lg py-2 px-3 text-sm" />
      <label class="flex items-center gap-1.5 text-xs text-slate">
        <input v-model="activeOnly" type="checkbox" />
        {{ t('masterPanel.sessions.filterActiveOnly') }}
      </label>
      <button type="submit" :disabled="searching" class="bg-aqua text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {{ searching ? t('masterPanel.sessions.searching') : t('masterPanel.sessions.search') }}
      </button>
    </form>
    <p v-if="searchError" class="text-coral text-xs">{{ searchError }}</p>

    <div v-if="sessions.length" class="border border-seafoam rounded-lg overflow-x-auto">
      <table class="w-full text-sm min-w-[44rem]">
        <thead>
          <tr class="text-left text-slate text-xs border-b border-seafoam">
            <th class="p-2"></th>
            <th class="p-2">{{ t('masterPanel.sessions.colScopeType') }}</th>
            <th class="p-2">{{ t('masterPanel.sessions.colScopeKey') }}</th>
            <th class="p-2">{{ t('masterPanel.sessions.colIssued') }}</th>
            <th class="p-2">{{ t('masterPanel.sessions.colExpires') }}</th>
            <th class="p-2">{{ t('masterPanel.sessions.colStatus') }}</th>
            <th class="p-2"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in sessions" :key="s.id" class="border-b border-seafoam last:border-0">
            <td class="p-2"><input type="checkbox" :checked="selected.has(s.id)" @change="toggle(s.id)" /></td>
            <td class="p-2 text-ink text-xs whitespace-nowrap">{{ s.scopeType }}</td>
            <td class="p-2 text-ink text-xs whitespace-nowrap">{{ s.scopeKey }}</td>
            <td class="p-2 text-slate text-xs whitespace-nowrap">{{ new Date(s.issuedAt).toLocaleString() }}</td>
            <td class="p-2 text-slate text-xs whitespace-nowrap">{{ new Date(s.expiresAt).toLocaleString() }}</td>
            <td class="p-2 text-xs whitespace-nowrap" :class="s.revokedAt ? 'text-coral' : 'text-aqua'">
              {{ s.revokedAt ? t('masterPanel.sessions.statusRevoked') : t('masterPanel.sessions.statusActive') }}
            </td>
            <td class="p-2">
              <button
                v-if="!s.revokedAt"
                type="button"
                @click="revokeOne(s)"
                class="text-coral text-xs font-medium hover:underline"
              >
                {{ t('masterPanel.sessions.forceLogout') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="searched && !searching" class="text-slate text-xs">{{ t('masterPanel.sessions.noResults') }}</p>

    <button
      v-if="sessions.length"
      type="button"
      :disabled="selected.size === 0"
      @click="showConfirm = true"
      class="bg-coral text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
    >
      {{ t('masterPanel.sessions.revokeSelected', { count: selected.size }) }}
    </button>
    <p v-if="status" class="text-xs" :class="statusOk ? 'text-aqua' : 'text-coral'">{{ status }}</p>

    <MasterDeleteConfirmModal
      v-if="showConfirm"
      :title="t('masterPanel.sessions.confirmTitle')"
      :breakdown="breakdown()"
      :loading="revoking"
      @confirm="revokeSelected"
      @cancel="showConfirm = false"
    />
  </div>
</template>
```

- [ ] **Step 2: Add i18n keys to `src/i18n/locales/en.json`**

Insert a new `"sessions"` object right after the `"backupExport"` block closes and before `"dataPurge"` starts (`en.json:580-581`):

```json
    "backupExport": {
      ...
      "errorFailed": "Could not export backup."
    },
    "sessions": {
      "title": "Active Sessions",
      "intro": "View active staff and manager sessions, and force-logout one or several — e.g. a lost phone or a leaked shared PIN.",
      "back": "Back",
      "filterScopeTypeAll": "All roles",
      "filterScopeKeyAll": "All",
      "filterScopeKeyPlaceholder": "Outlet or name",
      "filterActiveOnly": "Active only",
      "search": "Search",
      "searching": "Searching...",
      "colScopeType": "Role",
      "colScopeKey": "Scope",
      "colIssued": "Logged in",
      "colExpires": "Expires",
      "colStatus": "Status",
      "statusActive": "Active",
      "statusRevoked": "Revoked",
      "forceLogout": "Force Logout",
      "noResults": "No sessions found.",
      "revokeSelected": "Force Logout Selected ({count})",
      "confirmTitle": "Force Logout Selected Sessions",
      "confirmOne": "Force logout this session ({scope})?",
      "breakdownSessions": "Sessions",
      "successRevoked": "Force-logged-out {count} session(s).",
      "errorSearchFailed": "Could not load sessions.",
      "errorRevokeFailed": "Could not force logout."
    },
    "dataPurge": {
```

(Only the new `"sessions"` block is an actual change — `"backupExport"` and `"dataPurge"` are shown for placement context, do not modify their contents.)

- [ ] **Step 3: Add the matching block to `src/i18n/locales/ms.json`**

Same insertion point (`ms.json:580-581`, right after `"backupExport"` closes, before `"dataPurge"`):

```json
    "sessions": {
      "title": "Sesi Aktif",
      "intro": "Lihat sesi staf dan pengurus yang aktif, dan log keluar paksa satu atau beberapa — contohnya telefon hilang atau PIN kongsi bocor.",
      "back": "Kembali",
      "filterScopeTypeAll": "Semua peranan",
      "filterScopeKeyAll": "Semua",
      "filterScopeKeyPlaceholder": "Outlet atau nama",
      "filterActiveOnly": "Aktif sahaja",
      "search": "Cari",
      "searching": "Mencari...",
      "colScopeType": "Peranan",
      "colScopeKey": "Skop",
      "colIssued": "Log masuk",
      "colExpires": "Tamat tempoh",
      "colStatus": "Status",
      "statusActive": "Aktif",
      "statusRevoked": "Dibatalkan",
      "forceLogout": "Log Keluar Paksa",
      "noResults": "Tiada sesi dijumpai.",
      "revokeSelected": "Log Keluar Paksa Yang Dipilih ({count})",
      "confirmTitle": "Log Keluar Paksa Sesi Terpilih",
      "confirmOne": "Log keluar paksa sesi ini ({scope})?",
      "breakdownSessions": "Sesi",
      "successRevoked": "{count} sesi telah dilog keluar paksa.",
      "errorSearchFailed": "Gagal memuatkan sesi.",
      "errorRevokeFailed": "Gagal log keluar paksa."
    },
```

- [ ] **Step 4: Wire into `MasterPanel.vue`**

Add the import next to the other panel imports (`MasterPanel.vue:5-9`, after `MasterBackupExport`):

```js
import MasterActiveSessions from './MasterActiveSessions.vue'
```

Add `'sessions'` to `ENABLED_TABS` (`MasterPanel.vue:18-19`):

```js
const TABS = ['pinReset', 'overrides', 'dataPurge', 'maintenanceMode', 'auditLogs', 'backupExport', 'sessions', 'impersonation']
const ENABLED_TABS = ['pinReset', 'dataPurge', 'maintenanceMode', 'auditLogs', 'backupExport', 'sessions']
```

Add `'sessions'` to the wide-drawer class list (`MasterPanel.vue:32`, the table view needs the same extra width Data Purge/Audit Log already get):

```html
<div class="w-full h-full bg-white shadow-lg flex flex-col" :class="['dataPurge', 'auditLogs', 'sessions'].includes(activeTab) ? 'max-w-3xl' : 'max-w-sm'">
```

Add the render branch next to the other panel components (`MasterPanel.vue:38-42`, after `MasterBackupExport`):

```html
<MasterActiveSessions v-else-if="activeTab === 'sessions'" @close="activeTab = null" />
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
const missingInMs = [...enKeys].filter((k) => !msKeys.has(k));
const missingInEn = [...msKeys].filter((k) => !enKeys.has(k));
console.log('Missing in ms:', missingInMs);
console.log('Missing in en:', missingInEn);
"
```

Expected: both arrays empty.

- [ ] **Step 7: Live browser click-through**

Start both dev servers (`cd lautan-academy-backend && node src/index.js`, `cd lautan-academy-frontend && npm run dev`). Create or use a disposable test staff account (not real production credentials — same caution as Subsystems B/C/D/E) and log in as that account **in a separate browser tab**, keeping it open.

In the Master Panel tab: log in as Master, open the panel, click "Active Sessions" (no longer "Coming Soon"), filter by that account's role/outlet, confirm the test session appears with status "Active", click "Force Logout" on it (confirm the native prompt), confirm status flips to "Revoked" after the search refreshes.

Switch to the test staff account's browser tab, trigger any authenticated action (e.g. navigate to a page that calls `/data/scoped-data`) — confirm it gets logged out (redirected to login / session-expired behavior, same as natural expiry).

Back in the Master Panel: search again with a couple more fresh disposable test sessions, select 2+ via checkboxes, click "Force Logout Selected", type `DELETE` in the confirm modal, confirm both flip to revoked and the status message shows the right count.

Toggle to Bahasa Malaysia and repeat the search/filter/single-revoke flow — confirm all new strings render in BM (title, filters, table headers, buttons, confirm prompt, status messages).

- [ ] **Step 8: Commit**

```bash
git add lautan-academy-frontend/src/components/MasterActiveSessions.vue lautan-academy-frontend/src/components/MasterPanel.vue lautan-academy-frontend/src/i18n/locales/en.json lautan-academy-frontend/src/i18n/locales/ms.json
git commit -m "feat: wire MasterActiveSessions into Master Panel's sessions tab"
```

---

## Post-implementation: update MEMORY.md / SCOPE_TRACKER.md

Per `CLAUDE.md` rule 5: once all 6 tasks are verified (curl round-trips including the immediate-revocation proof, build clean, EN/MS parity clean, live browser click-through both languages with a real disposable test session actually getting logged out), add a Subsystem G entry to `MEMORY.md`'s Master Subsystem list (same format as A–F: what was built, backend/frontend commit hashes, spec/plan links, what was verified and how). Note explicitly that Master's own sessions remain untracked/untouched throughout, and that the revocation check is a ~25s-refreshed in-memory cache (not a live DB check) with instant enforcement for the process that issued the revoke. Then prompt the user to `/clear`.
